// Generate basket IDs
export const CESTAS: string[] = [];
for (let i = 1; i <= 500; i++) {
  CESTAS.push(`MTG1_CB${String(i).padStart(3, '0')}`);
}
CESTAS.push('Solo', 'Caixa', 'Palete', 'Lote');

// Generate row IDs
export const FIADAS: string[] = [];
const fiadaRanges: [string, number][] = [['A', 26], ['B', 11], ['C', 26], ['D', 5]];
for (const [letter, max] of fiadaRanges) {
  for (let i = 1; i <= max; i++) {
    FIADAS.push(`${letter}${String(i).padStart(2, '0')}`);
  }
}
// Extra locations seen in data
FIADAS.push('RAMPA', 'CORREDOR', 'COBERTO');

export const MOVEMENT_TYPES = [
  { value: 'entrada', label: 'Entrada', icon: '📥', color: 'text-success' },
  { value: 'saida', label: 'Saída', icon: '📤', color: 'text-destructive' },
  { value: 'transferencia', label: 'Transferência', icon: '🔄', color: 'text-primary' },
] as const;
