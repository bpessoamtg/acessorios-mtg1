// Inventory logic with no UI and no network, so it can be unit-tested.
//
// An inventory row is a snapshot of one stock line ("system_*") plus what was
// found in the yard ("real_*"). real_qty === '' means "not counted yet".
// Rows with an empty system_modelo were added on the spot ("item encontrado").

export interface AuditRow {
  id: string;
  inventory_id: string;
  stock_item_id: string | null;
  system_modelo: string;
  system_cesta: string;
  system_fiada: string;
  system_qty: number;
  real_modelo: string;
  real_cesta: string;
  real_fiada: string;
  real_qty: string;
  counted_by: string | null;
  counted_at: string | null;
  applied_at: string | null;
  applied_by: string | null;
  created_at: string;
}

export interface StockLine {
  id: string;
  modelo: string;
  cesta: string;
  fiada: string | null;
  quantidade: number;
}

export type CountKind = 'pending' | 'ok' | 'qty' | 'zero' | 'moved' | 'new';

const SPECIAL_CESTAS: Record<string, string> = { palete: 'Palete', caixa: 'Caixa', lote: 'Lote', solo: 'Solo' };

export const isSpecialCesta = (cesta: string) => !/^MTG1_CB\d+$/i.test(cesta.trim());

export const cestaNumber = (cesta: string) => {
  const m = /^MTG1_CB(\d+)$/i.exec(cesta.trim());
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};

/** "cb7", "7", "mtg1_cb007" → "MTG1_CB007"; "PALETE" → "Palete". */
export function normalizeCesta(input: string): string {
  const s = input.trim();
  if (!s) return '';
  const special = SPECIAL_CESTAS[s.toLowerCase()];
  if (special) return special;
  const m = /^(?:mtg1_?)?(?:cb)?\s*0*(\d{1,3})$/i.exec(s);
  if (m && Number(m[1]) >= 1) return `MTG1_CB${m[1].padStart(3, '0')}`;
  return s.toUpperCase();
}

/** "a5" → "A05"; "rampa" → "RAMPA"; "?" → "". */
export function normalizeFiada(input: string): string {
  const s = input.trim();
  if (!s || s === '?') return '';
  const m = /^([A-Da-d])\s*0*(\d{1,2})$/.exec(s);
  if (m) return `${m[1].toUpperCase()}${m[2].padStart(2, '0')}`;
  return s.toUpperCase();
}

export const normalizeModelo = (input: string) => input.trim().toUpperCase();

const fiadaKey = (f: string): [number, number, string] => {
  if (!f) return [9, 0, ''];
  const m = /^([A-D])(\d+)$/.exec(f);
  return m ? ['ABCD'.indexOf(m[1]), Number(m[2]), ''] : [5, 0, f];
};

/** A01 < A02 < … < D05 < RAMPA … < (sem fiada). */
export function compareFiada(a: string, b: string): number {
  const x = fiadaKey(a);
  const y = fiadaKey(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
}

// Where a row is listed: the snapshot position for stock lines, the found
// position for items added on the spot.
export const isFound = (r: AuditRow) => r.system_modelo === '';
export const rowModelo = (r: AuditRow) => (isFound(r) ? r.real_modelo : r.system_modelo);
export const rowCesta = (r: AuditRow) => (isFound(r) ? r.real_cesta : r.system_cesta);
export const rowFiada = (r: AuditRow) => normalizeFiada(isFound(r) ? r.real_fiada : r.system_fiada);

/**
 * Baskets in number order, then pallets/boxes/lots. Those are told apart by
 * the material label, so they sort by model.
 */
export function compareByCesta(a: AuditRow, b: AuditRow): number {
  const ca = rowCesta(a);
  const cb = rowCesta(b);
  const sa = isSpecialCesta(ca);
  const sb = isSpecialCesta(cb);
  if (sa !== sb) return sa ? 1 : -1;
  if (!sa) return cestaNumber(ca) - cestaNumber(cb) || rowModelo(a).localeCompare(rowModelo(b));
  return (
    rowModelo(a).localeCompare(rowModelo(b)) ||
    ca.localeCompare(cb) ||
    compareFiada(rowFiada(a), rowFiada(b))
  );
}

// Same comparison as public.inventory_apply (lower() on the stored values), so
// the screen never calls "matches" what the database treats as a move.
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const samePlace = (r: AuditRow) =>
  same(r.real_modelo, r.system_modelo) && same(r.real_cesta, r.system_cesta) && same(r.real_fiada, r.system_fiada);

export const isCounted = (r: AuditRow) => r.real_qty.trim() !== '';
export const countedQty = (r: AuditRow) => Number(r.real_qty);

export function kindOf(r: AuditRow): CountKind {
  if (isFound(r)) return 'new';
  if (!isCounted(r)) return 'pending';
  if (!samePlace(r)) return 'moved';
  const q = countedQty(r);
  if (q === 0 && r.system_qty !== 0) return 'zero';
  return q === r.system_qty ? 'ok' : 'qty';
}

export const hasDifference = (r: AuditRow) => {
  const k = kindOf(r);
  return k === 'new' || k === 'moved' || k === 'zero' || k === 'qty';
};

export type Filter = 'pending' | 'diff' | 'all';

export function passesFilter(r: AuditRow, f: Filter): boolean {
  if (f === 'pending') return !isCounted(r);
  if (f === 'diff') return hasDifference(r);
  return true;
}

export function matchesSearch(r: AuditRow, query: string, sap: Record<string, string>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const m = rowModelo(r);
  return (
    rowCesta(r).toLowerCase().includes(q) ||
    m.toLowerCase().includes(q) ||
    (sap[m] || '').toLowerCase().includes(q)
  );
}

export interface Progress { total: number; counted: number; pending: number; diffs: number }

export function progressOf(rows: AuditRow[]): Progress {
  const counted = rows.filter(isCounted).length;
  return { total: rows.length, counted, pending: rows.length - counted, diffs: rows.filter(hasDifference).length };
}

export interface FiadaGroup extends Progress { fiada: string }

export function groupByFiada(rows: AuditRow[]): FiadaGroup[] {
  const map = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const f = rowFiada(r);
    const list = map.get(f);
    if (list) list.push(r);
    else map.set(f, [r]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => compareFiada(a, b))
    .map(([fiada, list]) => ({ fiada, ...progressOf(list) }));
}

// ── Live stock ─────────────────────────────────────────────────────────
// Stock keeps moving while the count runs. The snapshot quantity is what the
// counter sees; the live quantity is what applying the count will overwrite.
//
// Matched by the stock line itself, never by model + cesta + fiada: in
// "Caixa", "Palete" and "Lote" several separate lines share all three (five
// boxes of TOVM0435 in C23, 150 each). The link is cleared by the database
// when the line is deleted, so a row without it means the line is gone.

export function stockMap(lines: StockLine[]): Map<string, number> {
  return new Map(lines.map((l) => [l.id, l.quantidade]));
}

export function liveQty(r: AuditRow, stock: Map<string, number>): number {
  if (isFound(r) || !r.stock_item_id) return 0;
  return stock.get(r.stock_item_id) ?? 0;
}

/** The stock line moved after the snapshot was taken. */
export const isStale = (r: AuditRow, stock: Map<string, number>) =>
  !isFound(r) && liveQty(r, stock) !== r.system_qty;

// ── Adjustments ────────────────────────────────────────────────────────
// Mirrors public.inventory_apply: stock becomes the counted value. Keep the
// two in step — the database is what actually runs.

export type AdjustmentType = 'entrada' | 'saida' | 'ajuste' | 'transferencia';

export interface Adjustment {
  row: AuditRow;
  type: AdjustmentType;
  /** Net change in units for this model once applied. */
  delta: number;
  live: number;
  stale: boolean;
}

export function proposeAdjustments(rows: AuditRow[], stock: Map<string, number>): Adjustment[] {
  const out: Adjustment[] = [];
  for (const row of rows) {
    if (row.applied_at || !isCounted(row) || !/^\d+$/.test(row.real_qty.trim())) continue;
    const q = countedQty(row);
    const k = kindOf(row);
    if (k === 'new') {
      if (q > 0) out.push({ row, type: 'entrada', delta: q, live: 0, stale: false });
      continue;
    }
    const live = liveQty(row, stock);
    const stale = live !== row.system_qty;
    if (k === 'moved') {
      out.push({ row, type: 'transferencia', delta: q - live, live, stale });
      continue;
    }
    const delta = q - live;
    if (delta === 0) continue;
    out.push({ row, type: q === 0 ? 'saida' : 'ajuste', delta, live, stale });
  }
  return out;
}

/** Lines whose stock moved during the count need a human look first. */
export const selectedByDefault = (a: Adjustment) => !a.stale;

// ── Offline outbox ─────────────────────────────────────────────────────
// Every change is queued on the phone first and sent in order. The screen
// shows the server rows with the queue laid over them, so nothing typed is
// ever hidden by a slow network or a refresh.

export interface CountPatch {
  real_qty: string;
  real_cesta: string;
  real_fiada: string;
  real_modelo: string;
  counted_by: string | null;
}

export type OutboxOp =
  | { kind: 'count'; id: string; patch: CountPatch; at: number }
  | { kind: 'add'; row: AuditRow; at: number }
  | { kind: 'remove'; id: string; at: number };

export function enqueue(queue: OutboxOp[], op: OutboxOp): OutboxOp[] {
  if (op.kind === 'count') {
    const pendingAdd = queue.find((o) => o.kind === 'add' && o.row.id === op.id);
    if (pendingAdd && pendingAdd.kind === 'add') {
      return queue.map((o) => (o === pendingAdd ? { ...pendingAdd, row: { ...pendingAdd.row, ...op.patch } } : o));
    }
    return [...queue.filter((o) => !(o.kind === 'count' && o.id === op.id)), op];
  }
  if (op.kind === 'remove') {
    const hadAdd = queue.some((o) => o.kind === 'add' && o.row.id === op.id);
    const rest = queue.filter((o) => !((o.kind === 'add' && o.row.id === op.id) || (o.kind === 'count' && o.id === op.id)));
    return hadAdd ? rest : [...rest, op];
  }
  return [...queue, op];
}

export function overlay(serverRows: AuditRow[], queue: OutboxOp[]): AuditRow[] {
  const byId = new Map(serverRows.map((r) => [r.id, r]));
  for (const op of queue) {
    if (op.kind === 'add' && !byId.has(op.row.id)) byId.set(op.row.id, op.row);
  }
  for (const op of queue) {
    if (op.kind === 'count') {
      const r = byId.get(op.id);
      if (r && !r.applied_at) byId.set(op.id, { ...r, ...op.patch, counted_at: new Date(op.at).toISOString() });
    } else if (op.kind === 'remove') {
      byId.delete(op.id);
    }
  }
  return [...byId.values()];
}

export const pendingIds = (queue: OutboxOp[]) =>
  new Set(queue.map((o) => (o.kind === 'add' ? o.row.id : o.id)));
