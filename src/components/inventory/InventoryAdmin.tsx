import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  Adjustment,
  AuditRow,
  compareByCesta,
  countedQty,
  isCounted,
  isSpecialCesta,
  kindOf,
  liveQty,
  progressOf,
  proposeAdjustments,
  rowCesta,
  rowFiada,
  rowModelo,
  selectedByDefault,
} from '@/lib/inventory';
import { InventoryData } from '@/hooks/useInventory';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const fiadaLabel = (f: string) => f || 'sem fiada';

const KIND_LABEL: Record<string, string> = {
  pending: 'Por contar',
  ok: 'Confere',
  qty: 'Outra quantidade',
  zero: 'Não encontrado',
  moved: 'Noutro sítio',
  new: 'Item encontrado',
};

function describe(a: Adjustment): string {
  const r = a.row;
  const q = countedQty(r);
  if (a.type === 'entrada') return `Entrada de ${q} un. em ${r.real_cesta} · ${fiadaLabel(r.real_fiada)} (item encontrado).`;
  if (a.type === 'saida') return `Não encontrado: sai o stock todo (${a.live} un.).`;
  if (a.type === 'transferencia') {
    const model = r.real_modelo.toLowerCase() !== r.system_modelo.toLowerCase() ? ` como ${r.real_modelo}` : '';
    const qty = q !== a.live ? `, e o stock passa de ${a.live} para ${q}` : '';
    return `Encontrado${model} em ${r.real_cesta} · ${fiadaLabel(r.real_fiada)}${qty}.`;
  }
  return `O stock passa de ${a.live} para ${q} (${signed(a.delta)}).`;
}

type Confirm = 'apply' | 'new' | null;

const InventoryAdmin = ({ inv }: { inv: InventoryData }) => {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const { rows, stock, inventory } = inv;
  const prog = progressOf(rows);
  const adjustments = useMemo(
    () => proposeAdjustments(rows, stock).sort((a, b) => compareByCesta(a.row, b.row)),
    [rows, stock],
  );
  const isPicked = (a: Adjustment) => picked[a.row.id] ?? selectedByDefault(a);
  const selected = adjustments.filter(isPicked);
  const net = selected.reduce((s, a) => s + a.delta, 0);
  const staleCount = adjustments.filter((a) => a.stale).length;
  const appliedCount = rows.filter((r) => r.applied_at).length;

  const byOperator = useMemo(() => {
    const m = new Map<string, number>();
    rows.filter(isCounted).forEach((r) => m.set(r.counted_by || '—', (m.get(r.counted_by || '—') ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const unsent = inv.queueLength > 0;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const apply = () =>
    run(async () => {
      const ids = selected.map((a) => a.row.id);
      const { data, error } = await db.rpc('inventory_apply', { p_ids: ids });
      if (error) {
        toast.error(error.message || 'Não foi possível aplicar os ajustes.');
        return;
      }
      setPicked({});
      // Stock, history and every tab reading them change at once.
      await qc.invalidateQueries();
      toast.success(`${data.rows} linhas aplicadas ao stock, ${data.movements} movimentos criados.`);
    });

  const startNew = () =>
    run(async () => {
      const { data, error } = await db.rpc('inventory_start_new');
      if (error) {
        toast.error(error.message || 'Não foi possível começar o inventário.');
        return;
      }
      setPicked({});
      await qc.invalidateQueries({ queryKey: ['inv'] });
      toast.success(`Inventário novo com ${data.rows} linhas, criado a partir do stock atual.`);
    });

  const exportExcel = () => {
    const data = [...rows].sort(compareByCesta).map((r: AuditRow) => {
      const k = kindOf(r);
      const counted = isCounted(r);
      const live = r.system_modelo ? liveQty(r, stock) : '';
      return {
        'Modelo (Sistema)': r.system_modelo,
        'Cesta (Sistema)': r.system_cesta,
        'Fiada (Sistema)': r.system_fiada,
        'Qtd (Sistema, início)': r.system_modelo ? r.system_qty : '',
        'Qtd (Stock agora)': live,
        'Modelo (Real)': r.real_modelo,
        'Cesta (Real)': r.real_cesta,
        'Fiada (Real)': r.real_fiada,
        'Qtd (Real)': counted ? countedQty(r) : '',
        'Diferença Qtd': counted ? countedQty(r) - (r.system_modelo ? r.system_qty : 0) : '',
        Estado: KIND_LABEL[k],
        'Contado por': r.counted_by || '',
        'Contado em': dateTime(r.counted_at),
        'Aplicado em': dateTime(r.applied_at),
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventário');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf]), `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (!inventory) {
    return (
      <div className="p-4 grid gap-3">
        <h2 className="text-lg font-bold">Inventário · Admin</h2>
        <p className="text-muted-foreground">Não há nenhum inventário aberto.</p>
        <Button className="h-11 font-semibold" disabled={busy} onClick={startNew}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Começar inventário
        </Button>
      </div>
    );
  }

  const tile = 'rounded-xl border border-border bg-card px-3 py-2.5 grid gap-0.5';

  return (
    <div className="p-4 grid gap-3">
      <div>
        <h2 className="text-lg font-bold">Inventário · Admin</h2>
        <p className="text-sm text-muted-foreground">
          Começado a {dateTime(inventory.started_at)} por {inventory.started_by}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 tabular-nums">
        <div className={tile}>
          <span className="text-sm text-muted-foreground">Contadas</span>
          <b className="text-2xl">{prog.counted}</b>
          <span className="text-sm text-muted-foreground">de {prog.total}</span>
        </div>
        <div className={tile}>
          <span className="text-sm text-muted-foreground">Por contar</span>
          <b className="text-2xl">{prog.pending}</b>
          <span className="text-sm text-muted-foreground">{prog.total ? Math.round((100 * prog.pending) / prog.total) : 0}% da lista</span>
        </div>
        <div className={tile}>
          <span className="text-sm text-muted-foreground">Ajustes por aplicar</span>
          <b className="text-2xl">{adjustments.length}</b>
          <span className="text-sm text-muted-foreground">{staleCount} com stock mexido</span>
        </div>
        <div className={tile}>
          <span className="text-sm text-muted-foreground">Diferença líquida</span>
          <b className={cn('text-2xl', net < 0 && 'text-destructive', net > 0 && 'text-success')}>{signed(net)}</b>
          <span className="text-sm text-muted-foreground">unidades escolhidas</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap text-sm">
        <span className="text-muted-foreground">Quem contou:</span>
        {byOperator.length ? (
          byOperator.map(([name, n]) => (
            <span key={name} className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">
              {name} · {n}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">ninguém ainda</span>
        )}
        {appliedCount > 0 && <span className="text-muted-foreground">· {appliedCount} linhas já aplicadas</span>}
      </div>

      <div className="flex items-baseline justify-between pt-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ajustes propostos</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {selected.length} de {adjustments.length} escolhidos
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Aplicar faz o stock ficar igual ao contado. Cada ajuste passa a ser uma entrada, saída ou transferência no
        Histórico, e pode ser estornado de lá. As linhas cujo stock mexeu durante a contagem vêm desmarcadas.
      </p>

      {adjustments.length ? (
        adjustments.map((a) => {
          const r = a.row;
          const special = isSpecialCesta(rowCesta(r));
          return (
            <label
              key={r.id}
              htmlFor={`pick-${r.id}`}
              className={cn(
                'grid grid-cols-[24px_1fr_auto] gap-3 items-start rounded-xl border bg-card px-3 py-2.5',
                a.stale ? 'border-amber-300' : 'border-border',
              )}
            >
              <input
                id={`pick-${r.id}`}
                type="checkbox"
                className="w-5 h-5 mt-0.5 accent-primary"
                checked={isPicked(a)}
                disabled={busy}
                onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.checked }))}
              />
              <span className="grid gap-0.5 min-w-0">
                <span className="font-mono-app font-bold break-all">
                  {special ? rowModelo(r) : rowCesta(r)} <span className="font-sans font-normal text-muted-foreground">· {rowFiada(r) || 'sem fiada'}</span>
                </span>
                <span className="font-mono-app text-sm text-muted-foreground break-all">{special ? rowCesta(r) : rowModelo(r)}</span>
                <span className="text-sm">{describe(a)}</span>
                {a.stale && (
                  <span className="flex items-start gap-1 text-sm text-amber-800">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    No início da contagem eram {r.system_qty}; o stock mexeu entretanto. Confirma antes de aplicar.
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {r.counted_by || '—'} · {dateTime(r.counted_at)}
                </span>
              </span>
              <span
                className={cn(
                  'font-bold tabular-nums',
                  a.delta < 0 ? 'text-destructive' : a.delta > 0 ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {signed(a.delta)}
              </span>
            </label>
          );
        })
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-muted-foreground">
          Ainda não há diferenças por aplicar.
        </div>
      )}

      {unsent && (
        <p className="text-sm text-amber-800 bg-amber-100 rounded-lg px-3 py-2">
          Há contagens deste telemóvel ainda por enviar. Espera que fiquem gravadas antes de aplicar.
        </p>
      )}

      {confirm === 'apply' ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 grid gap-2.5">
          <b>Aplicar {selected.length} ajustes ao stock?</b>
          <p className="text-sm">
            O stock destas linhas fica igual ao contado e são criados os movimentos correspondentes no Histórico. Ou
            passa tudo, ou não passa nada.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11 hover:bg-muted hover:text-foreground" disabled={busy} onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button className="h-11 font-semibold gap-1.5" disabled={busy} onClick={apply}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Aplicar {selected.length}
            </Button>
          </div>
        </div>
      ) : (
        <Button className="h-11 font-semibold" disabled={!selected.length || busy || unsent} onClick={() => setConfirm('apply')}>
          Aplicar {selected.length} {selected.length === 1 ? 'ajuste' : 'ajustes'} ao stock
        </Button>
      )}

      <div className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fim do inventário</div>
      <Button variant="outline" className="h-11 gap-1.5 hover:bg-muted hover:text-foreground" onClick={exportExcel}>
        <Download className="w-4 h-4" />
        Exportar para Excel
      </Button>
      {confirm === 'new' ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 grid gap-2.5">
          <b>Começar um inventário novo?</b>
          <p className="text-sm">
            Este inventário fica arquivado, com todas as contagens. A lista nova é criada a partir do stock atual, com
            tudo por contar.
            {adjustments.length > 0 && ` Ainda há ${adjustments.length} ajustes por aplicar: se começares já, ficam por aplicar.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11 hover:bg-muted hover:text-foreground" disabled={busy} onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button className="h-11 font-semibold gap-1.5" disabled={busy} onClick={startNew}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Começar novo
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="h-11 hover:bg-muted hover:text-foreground" disabled={busy} onClick={() => setConfirm('new')}>
          Começar inventário novo
        </Button>
      )}
    </div>
  );
};

export default InventoryAdmin;
