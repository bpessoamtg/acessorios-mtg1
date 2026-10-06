export interface CestaLine {
  modelo: string;
  fiada: string | null;
  quantidade: number;
}

/**
 * Quantity to pre-fill when moving a whole cesta to another fiada.
 *
 * Only when exactly one stock line matches the model and fiada. In Caixa,
 * Palete and Lote several separate lines can share model, cesta and fiada
 * (five boxes of 150): any single number would be a guess, so the field stays
 * empty and the operator types it.
 */
export function wholeCestaQuantity(contents: CestaLine[], modelo: string, fiada: string): number | null {
  if (!modelo) return null;
  const lines = contents.filter((c) => c.modelo === modelo && (c.fiada ?? '') === fiada);
  return lines.length === 1 ? lines[0].quantidade : null;
}

export const isSameLocation = (a: { cesta: string; fiada: string }, b: { cesta: string; fiada: string }) =>
  a.cesta.trim().toLowerCase() === b.cesta.trim().toLowerCase() &&
  a.fiada.trim().toLowerCase() === b.fiada.trim().toLowerCase();
