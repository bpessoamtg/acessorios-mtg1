import {
  AuditRow,
  compareByCesta,
  countedQty,
  isCounted,
  kindOf,
  liveQty,
} from './inventory';

export const KIND_LABEL: Record<string, string> = {
  pending: 'Por contar',
  ok: 'Confere',
  qty: 'Outra quantidade',
  zero: 'Não encontrado',
  moved: 'Noutro sítio',
  new: 'Item encontrado',
};

/** Model name → SAP code. Empty when the model has none anywhere. */
export type SapMap = Record<string, string>;

/**
 * The SAP code for each model: the model table first, and for models missing
 * from it the code carried by the stock lines (eight models in the current
 * count are only known to the stock).
 */
export function buildSapMap(
  lookup: { modelo: string; cod_sap: string | null }[],
  stockLines: { modelo: string; cod_sap?: string | null }[],
): SapMap {
  const map: SapMap = {};
  for (const l of lookup) if (l.cod_sap && l.cod_sap.trim()) map[l.modelo] = l.cod_sap.trim();
  for (const s of stockLines) {
    const code = s.cod_sap?.trim();
    if (code && !(s.modelo in map)) map[s.modelo] = code;
  }
  return map;
}

/** One spreadsheet row per inventory line, in cesta order. */
export function inventoryExportRows(
  rows: AuditRow[],
  stock: Map<string, number>,
  sap: SapMap,
  formatDate: (iso: string | null) => string,
) {
  return [...rows].sort(compareByCesta).map((r) => {
    const counted = isCounted(r);
    const hasSystem = r.system_modelo !== '';
    return {
      'Modelo (Sistema)': r.system_modelo,
      'Cod SAP (Sistema)': hasSystem ? sap[r.system_modelo] ?? '' : '',
      'Cesta (Sistema)': r.system_cesta,
      'Fiada (Sistema)': r.system_fiada,
      'Qtd (Sistema, início)': hasSystem ? r.system_qty : '',
      'Qtd (Stock agora)': hasSystem ? liveQty(r, stock) : '',
      'Modelo (Real)': r.real_modelo,
      'Cod SAP (Real)': sap[r.real_modelo] ?? '',
      'Cesta (Real)': r.real_cesta,
      'Fiada (Real)': r.real_fiada,
      'Qtd (Real)': counted ? countedQty(r) : '',
      'Diferença Qtd': counted ? countedQty(r) - (hasSystem ? r.system_qty : 0) : '',
      Estado: KIND_LABEL[kindOf(r)],
      'Contado por': r.counted_by || '',
      'Contado em': formatDate(r.counted_at),
      'Aplicado em': formatDate(r.applied_at),
    };
  });
}
