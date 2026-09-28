import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  AuditRow,
  CountPatch,
  enqueue,
  isCounted,
  OutboxOp,
  overlay,
  pendingIds,
  StockLine,
  stockMap,
} from '@/lib/inventory';

// inventories and the new inventory_audit columns are not in the generated
// Supabase types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface OpenInventory {
  id: string;
  started_at: string;
  started_by: string;
}

const OUTBOX_KEY = 'inventory-outbox-v1';
const RETRY_MS = 8000;

function readOutbox(): OutboxOp[] {
  try {
    const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeOutbox(q: OutboxOp[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(q));
  } catch {
    // Storage full or blocked: the queue still lives in memory for this session.
  }
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

type SendResult = 'ok' | 'rejected' | 'network';

// A PostgREST error carries a code; a dropped connection does not.
const classify = (error: { code?: string; message?: string } | null): SendResult => {
  if (!error) return 'ok';
  if (!error.code || /fetch|network|timeout|load failed/i.test(error.message || '')) return 'network';
  return 'rejected';
};

async function send(op: OutboxOp): Promise<SendResult> {
  try {
    if (op.kind === 'count') {
      const { data, error } = await db.from('inventory_audit').update(op.patch).eq('id', op.id).select('id');
      if (error) return classify(error);
      // Zero rows back: the line was applied or the count closed in the meantime.
      return data && data.length ? 'ok' : 'rejected';
    }
    if (op.kind === 'add') {
      const r = op.row;
      const { error } = await db.from('inventory_audit').upsert(
        {
          id: r.id,
          inventory_id: r.inventory_id,
          stock_item_id: null,
          system_modelo: '',
          system_cesta: '',
          system_fiada: '',
          system_qty: 0,
          real_modelo: r.real_modelo,
          real_cesta: r.real_cesta,
          real_fiada: r.real_fiada,
          real_qty: r.real_qty,
          counted_by: r.counted_by,
        },
        { onConflict: 'id' },
      );
      return classify(error);
    }
    const { error } = await db.from('inventory_audit').delete().eq('id', op.id);
    return classify(error);
  } catch {
    return 'network';
  }
}

export function useInventory() {
  const qc = useQueryClient();

  const invQ = useQuery({
    queryKey: ['inv', 'open'],
    queryFn: async () => {
      const { data, error } = await db.from('inventories').select('id, started_at, started_by').is('closed_at', null).maybeSingle();
      if (error) throw error;
      return (data ?? null) as OpenInventory | null;
    },
    refetchInterval: 30000,
  });
  const invId = invQ.data?.id;

  const rowsQ = useQuery({
    queryKey: ['inv', 'rows', invId],
    enabled: !!invId,
    queryFn: async () => {
      const { data, error } = await db
        .from('inventory_audit')
        .select('*')
        .eq('inventory_id', invId)
        .order('created_at')
        .order('id')
        .range(0, 4999);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    // Other phones counting at the same time show up within seconds.
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const stockQ = useQuery({
    queryKey: ['inv', 'stock'],
    queryFn: async () => {
      const { data, error } = await db.from('stock_items').select('id, modelo, cesta, fiada, quantidade').range(0, 9999);
      if (error) throw error;
      return (data ?? []) as StockLine[];
    },
    refetchInterval: 30000,
  });

  const modelsQ = useQuery({
    queryKey: ['inv', 'models'],
    queryFn: async () => {
      const { data, error } = await db.from('model_sap_lookup').select('modelo, cod_sap').order('modelo').range(0, 4999);
      if (error) throw error;
      return (data ?? []) as { modelo: string; cod_sap: string }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // ── Outbox ────────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<OutboxOp[]>(readOutbox);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [rejectedTick, setRejectedTick] = useState(0);
  const flushing = useRef(false);

  const updateQueue = useCallback((fn: (q: OutboxOp[]) => OutboxOp[]) => {
    setQueue((prev) => {
      const next = fn(prev);
      writeOutbox(next);
      queueRef.current = next;
      return next;
    });
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || !queueRef.current.length) return;
    flushing.current = true;
    setSending(true);
    let sentAny = false;
    try {
      while (queueRef.current.length) {
        const op = queueRef.current[0];
        const res = await send(op);
        if (res === 'network') {
          setOffline(true);
          return;
        }
        if (res === 'rejected') setRejectedTick((n) => n + 1);
        // A newer count for the same line replaced this op while it was in
        // flight; that newer one stays queued and goes next.
        updateQueue((q) => q.filter((o) => o !== op));
        sentAny = true;
      }
      setOffline(false);
      setLastSaved(Date.now());
    } finally {
      flushing.current = false;
      setSending(false);
      if (sentAny) qc.invalidateQueries({ queryKey: ['inv', 'rows'] });
    }
  }, [qc, updateQueue]);

  useEffect(() => {
    if (queue.length) flush();
  }, [queue, flush]);

  useEffect(() => {
    const onOnline = () => flush();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => {
      if (queueRef.current.length) flush();
    }, RETRY_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [flush]);

  // ── Counts from other phones ─────────────────────────────────────────
  const mine = useRef(new Set<string>());
  const seenCounted = useRef<Set<string> | null>(null);
  const [otherTick, setOtherTick] = useState<{ n: number; at: number } | null>(null);
  useEffect(() => {
    const data = rowsQ.data;
    if (!data) return;
    const counted = new Set(data.filter(isCounted).map((r) => r.id));
    const prev = seenCounted.current;
    if (prev) {
      let n = 0;
      counted.forEach((id) => {
        if (!prev.has(id) && !mine.current.has(id)) n += 1;
      });
      if (n) setOtherTick({ n, at: Date.now() });
    }
    seenCounted.current = counted;
  }, [rowsQ.data]);

  // ── Actions ───────────────────────────────────────────────────────────
  const count = useCallback(
    (row: AuditRow, patch: CountPatch) => {
      mine.current.add(row.id);
      updateQueue((q) => enqueue(q, { kind: 'count', id: row.id, patch, at: Date.now() }));
    },
    [updateQueue],
  );

  const redo = useCallback(
    (row: AuditRow) => {
      mine.current.add(row.id);
      updateQueue((q) =>
        enqueue(q, {
          kind: 'count',
          id: row.id,
          at: Date.now(),
          patch: {
            real_qty: '',
            real_modelo: row.system_modelo,
            real_cesta: row.system_cesta,
            real_fiada: row.system_fiada,
            counted_by: null,
          },
        }),
      );
    },
    [updateQueue],
  );

  const addFound = useCallback(
    (f: { modelo: string; cesta: string; fiada: string; qty: number; by: string }) => {
      if (!invId) return;
      const now = new Date().toISOString();
      const row: AuditRow = {
        id: newId(),
        inventory_id: invId,
        stock_item_id: null,
        system_modelo: '',
        system_cesta: '',
        system_fiada: '',
        system_qty: 0,
        real_modelo: f.modelo,
        real_cesta: f.cesta,
        real_fiada: f.fiada,
        real_qty: String(f.qty),
        counted_by: f.by,
        counted_at: now,
        applied_at: null,
        applied_by: null,
        created_at: now,
      };
      mine.current.add(row.id);
      updateQueue((q) => enqueue(q, { kind: 'add', row, at: Date.now() }));
    },
    [invId, updateQueue],
  );

  const removeFound = useCallback(
    (id: string) => updateQueue((q) => enqueue(q, { kind: 'remove', id, at: Date.now() })),
    [updateQueue],
  );

  const rows = useMemo(() => overlay(rowsQ.data ?? [], queue), [rowsQ.data, queue]);
  const stock = useMemo(() => stockMap(stockQ.data ?? []), [stockQ.data]);
  const models = useMemo(() => {
    const set = new Set((modelsQ.data ?? []).map((m) => m.modelo));
    (rowsQ.data ?? []).forEach((r) => r.system_modelo && set.add(r.system_modelo));
    return [...set].sort();
  }, [modelsQ.data, rowsQ.data]);
  const sap = useMemo(() => {
    const m: Record<string, string> = {};
    (modelsQ.data ?? []).forEach((x) => {
      m[x.modelo] = x.cod_sap;
    });
    return m;
  }, [modelsQ.data]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['inv'] }), [qc]);

  return {
    inventory: invQ.data ?? null,
    isLoading: invQ.isLoading || (!!invId && rowsQ.isLoading),
    loadError: invQ.error || rowsQ.error,
    refresh,
    rows,
    stock,
    models,
    sap,
    pending: pendingIds(queue),
    queueLength: queue.length,
    sending,
    offline,
    lastSaved: lastSaved ?? (rowsQ.dataUpdatedAt || null),
    rejectedTick,
    otherTick,
    count,
    redo,
    addFound,
    removeFound,
  };
}

export type InventoryData = ReturnType<typeof useInventory>;
