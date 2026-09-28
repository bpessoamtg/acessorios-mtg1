import { describe, expect, it } from 'vitest';
import {
  AuditRow,
  compareByCesta,
  compareFiada,
  enqueue,
  groupByFiada,
  hasDifference,
  isStale,
  kindOf,
  matchesSearch,
  normalizeCesta,
  normalizeFiada,
  overlay,
  OutboxOp,
  passesFilter,
  progressOf,
  proposeAdjustments,
  selectedByDefault,
  stockMap,
} from './inventory';

let seq = 0;
const row = (over: Partial<AuditRow> = {}): AuditRow => {
  seq += 1;
  const base: AuditRow = {
    id: `r${seq}`,
    inventory_id: 'inv',
    stock_item_id: `s${seq}`,
    system_modelo: 'R60FR050S4',
    system_cesta: 'MTG1_CB182',
    system_fiada: 'A05',
    system_qty: 46,
    real_modelo: 'R60FR050S4',
    real_cesta: 'MTG1_CB182',
    real_fiada: 'A05',
    real_qty: '',
    counted_by: null,
    counted_at: null,
    applied_at: null,
    applied_by: null,
    created_at: '2026-09-29T08:00:00Z',
  };
  return { ...base, ...over };
};
const baseRow = row;
const found = (over: Partial<AuditRow> = {}) =>
  row({ stock_item_id: null, system_modelo: '', system_cesta: '', system_fiada: '', system_qty: 0, ...over });

describe('normalizar o que o operador escreve', () => {
  it('cestas: número, cb ou código completo dão o mesmo', () => {
    expect(normalizeCesta('7')).toBe('MTG1_CB007');
    expect(normalizeCesta('cb 72')).toBe('MTG1_CB072');
    expect(normalizeCesta('mtg1_cb182')).toBe('MTG1_CB182');
    expect(normalizeCesta(' PALETE ')).toBe('Palete');
    expect(normalizeCesta('caixa')).toBe('Caixa');
    expect(normalizeCesta('')).toBe('');
  });
  it('fiadas: a5 passa a A05, texto fica em maiúsculas, ? fica vazio', () => {
    expect(normalizeFiada('a5')).toBe('A05');
    expect(normalizeFiada('D 1')).toBe('D01');
    expect(normalizeFiada('rampa')).toBe('RAMPA');
    expect(normalizeFiada('?')).toBe('');
    expect(normalizeFiada('B20')).toBe('B20');
  });
});

describe('ordenação', () => {
  it('fiadas pela ordem do parque, sem fiada no fim', () => {
    const f = ['RAMPA', 'B02', '', 'A10', 'A02', 'D01', 'C26'];
    expect([...f].sort(compareFiada)).toEqual(['A02', 'A10', 'B02', 'C26', 'D01', 'RAMPA', '']);
  });
  it('cestas pelo número; paletes, caixas e lotes no fim, pelo modelo da etiqueta', () => {
    const rows = [
      row({ system_cesta: 'Palete', system_modelo: 'ZZZ' }),
      row({ system_cesta: 'MTG1_CB100' }),
      row({ system_cesta: 'MTG1_CB007' }),
      row({ system_cesta: 'Caixa', system_modelo: 'AAA' }),
      row({ system_cesta: 'MTG1_CB072' }),
    ];
    expect(rows.sort(compareByCesta).map((r) => r.system_cesta)).toEqual([
      'MTG1_CB007', 'MTG1_CB072', 'MTG1_CB100', 'Caixa', 'Palete',
    ]);
  });
});

describe('estado de cada linha', () => {
  it('por contar enquanto a quantidade estiver vazia', () => {
    expect(kindOf(row())).toBe('pending');
    expect(hasDifference(row())).toBe(false);
  });
  it('confere, outra quantidade e não encontrado', () => {
    expect(kindOf(row({ real_qty: '46' }))).toBe('ok');
    expect(kindOf(row({ real_qty: '44' }))).toBe('qty');
    expect(kindOf(row({ real_qty: '0' }))).toBe('zero');
    expect(hasDifference(row({ real_qty: '46' }))).toBe(false);
    expect(hasDifference(row({ real_qty: '44' }))).toBe(true);
  });
  it('zero numa linha que já estava a zero confere', () => {
    expect(kindOf(row({ system_qty: 0, real_qty: '0' }))).toBe('ok');
  });
  it('noutro sítio quando a cesta ou a fiada mudam', () => {
    expect(kindOf(row({ real_qty: '46', real_cesta: 'MTG1_CB210' }))).toBe('moved');
    expect(kindOf(row({ real_qty: '46', real_fiada: 'A06' }))).toBe('moved');
  });
  it('maiúsculas e minúsculas não contam como mudança de sítio', () => {
    expect(kindOf(row({ real_qty: '46', real_cesta: 'mtg1_cb182' }))).toBe('ok');
  });
  it('item encontrado é sempre diferença', () => {
    expect(kindOf(found({ real_qty: '12' }))).toBe('new');
    expect(hasDifference(found({ real_qty: '12' }))).toBe(true);
  });
});

describe('filtros, pesquisa e progresso', () => {
  const rows = [row(), row({ real_qty: '46' }), row({ real_qty: '40' }), found({ real_modelo: 'CAO3B05S075', real_cesta: 'MTG1_CB430', real_fiada: 'A05', real_qty: '12' })];
  it('filtros', () => {
    expect(rows.filter((r) => passesFilter(r, 'pending'))).toHaveLength(1);
    expect(rows.filter((r) => passesFilter(r, 'diff'))).toHaveLength(2);
    expect(rows.filter((r) => passesFilter(r, 'all'))).toHaveLength(4);
  });
  it('pesquisa por cesta, modelo ou código SAP da etiqueta', () => {
    const sap = { CAO3B05S075: 'CI11CB2DG' };
    expect(matchesSearch(rows[3], '430', sap)).toBe(true);
    expect(matchesSearch(rows[3], '3b05', sap)).toBe(true);
    expect(matchesSearch(rows[3], 'cb2dg', sap)).toBe(true);
    expect(matchesSearch(rows[3], 'xyz', sap)).toBe(false);
  });
  it('progresso e agrupamento por fiada', () => {
    expect(progressOf(rows)).toEqual({ total: 4, counted: 3, pending: 1, diffs: 2 });
    const g = groupByFiada([...rows, row({ system_fiada: 'A01' }), row({ system_fiada: '?' })]);
    expect(g.map((x) => x.fiada)).toEqual(['A01', 'A05', '']);
    expect(g[1]).toMatchObject({ total: 4, counted: 3 });
  });
});

describe('stock por linha, não por posição', () => {
  // Caso real: 5 caixas de TOVM0435 na C23, cada uma com a sua linha de stock
  // de 150. Contar uma caixa não pode ser comparado com a soma das cinco.
  const caixas = [1, 2, 3, 4, 5].map((i) => ({ id: `cx${i}`, modelo: 'TOVM0435', cesta: 'Caixa', fiada: 'C23', quantidade: 150 }));
  const linha = (i: number, over: Partial<AuditRow> = {}) =>
    row({ stock_item_id: `cx${i}`, system_modelo: 'TOVM0435', system_cesta: 'Caixa', system_fiada: 'C23', system_qty: 150,
      real_modelo: 'TOVM0435', real_cesta: 'Caixa', real_fiada: 'C23', ...over });

  it('uma caixa contada certa não gera ajuste nem aviso de stock mexido', () => {
    const r = linha(1, { real_qty: '150' });
    expect(isStale(r, stockMap(caixas))).toBe(false);
    expect(proposeAdjustments([r], stockMap(caixas))).toEqual([]);
  });
  it('a diferença numa caixa é só dessa caixa', () => {
    const [a] = proposeAdjustments([linha(2, { real_qty: '140' })], stockMap(caixas));
    expect(a).toMatchObject({ delta: -10, live: 150, stale: false });
  });
  it('linha de stock apagada entretanto conta como zero', () => {
    const r = linha(3, { stock_item_id: null, real_qty: '150' });
    expect(isStale(r, stockMap(caixas))).toBe(true);
    expect(proposeAdjustments([r], stockMap(caixas))[0]).toMatchObject({ live: 0, delta: 150 });
  });
});

describe('ajustes ao stock — tem de bater com public.inventory_apply', () => {
  const stock = (qty: number) => stockMap([{ id: 's-live', modelo: 'R60FR050S4', cesta: 'MTG1_CB182', fiada: 'A05', quantidade: qty }]);
  const row = (over: Partial<AuditRow> = {}) => baseRow({ stock_item_id: 's-live', ...over });

  it('linha que confere e cujo stock não mexeu não gera nada', () => {
    expect(proposeAdjustments([row({ real_qty: '46' })], stock(46))).toEqual([]);
  });
  it('outra quantidade: a diferença é contra o stock atual', () => {
    const [a] = proposeAdjustments([row({ real_qty: '44' })], stock(46));
    expect(a).toMatchObject({ type: 'ajuste', delta: -2, live: 46, stale: false });
    expect(selectedByDefault(a)).toBe(true);
  });
  it('não encontrado tira o stock todo', () => {
    const [a] = proposeAdjustments([row({ real_qty: '0' })], stock(46));
    expect(a).toMatchObject({ type: 'saida', delta: -46 });
  });
  it('stock mexeu durante a contagem: vem desmarcado para rever', () => {
    const r = row({ real_qty: '46' });
    expect(isStale(r, stock(40))).toBe(true);
    const [a] = proposeAdjustments([r], stock(40));
    expect(a).toMatchObject({ delta: 6, stale: true });
    expect(selectedByDefault(a)).toBe(false);
  });
  it('se o stock mexeu e já bate com o contado, não há ajuste', () => {
    expect(proposeAdjustments([row({ real_qty: '40' })], stock(40))).toEqual([]);
  });
  it('linha que desapareceu do stock conta como zero', () => {
    const [a] = proposeAdjustments([row({ real_qty: '46' })], stockMap([]));
    expect(a).toMatchObject({ delta: 46, live: 0, stale: true });
  });
  it('noutro sítio vira transferência', () => {
    const [a] = proposeAdjustments([row({ real_qty: '46', real_cesta: 'MTG1_CB210' })], stock(46));
    expect(a).toMatchObject({ type: 'transferencia', delta: 0 });
  });
  it('item encontrado vira entrada', () => {
    const [a] = proposeAdjustments([found({ real_modelo: 'X', real_cesta: 'Palete', real_fiada: 'A05', real_qty: '12' })], stockMap([]));
    expect(a).toMatchObject({ type: 'entrada', delta: 12 });
  });
  it('ignora linhas por contar, já aplicadas ou com quantidade inválida', () => {
    expect(proposeAdjustments([row(), row({ real_qty: '44', applied_at: '2026-09-29T10:00:00Z' }), row({ real_qty: 'abc' })], stock(46))).toEqual([]);
  });
});

describe('fila sem rede', () => {
  const patch = (q: string) => ({ real_qty: q, real_cesta: 'MTG1_CB182', real_fiada: 'A05', real_modelo: 'R60FR050S4', counted_by: 'Carmona' });

  it('a última contagem de uma linha substitui a anterior na fila', () => {
    let q: OutboxOp[] = [];
    q = enqueue(q, { kind: 'count', id: 'a', patch: patch('44'), at: 1 });
    q = enqueue(q, { kind: 'count', id: 'b', patch: patch('10'), at: 2 });
    q = enqueue(q, { kind: 'count', id: 'a', patch: patch('45'), at: 3 });
    expect(q).toHaveLength(2);
    expect(q.find((o) => o.kind === 'count' && o.id === 'a')).toMatchObject({ patch: { real_qty: '45' } });
  });
  it('remover um item encontrado que ainda não foi enviado não manda nada', () => {
    const r = found({ id: 'n1', real_qty: '12' });
    let q = enqueue([], { kind: 'add', row: r, at: 1 });
    q = enqueue(q, { kind: 'remove', id: 'n1', at: 2 });
    expect(q).toEqual([]);
  });
  it('corrigir um item encontrado ainda na fila altera o que vai ser enviado', () => {
    const r = found({ id: 'n1', real_qty: '12' });
    let q = enqueue([], { kind: 'add', row: r, at: 1 });
    q = enqueue(q, { kind: 'count', id: 'n1', patch: { ...patch('15'), real_modelo: 'X' }, at: 2 });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'add', row: { real_qty: '15' } });
  });
  it('o ecrã mostra a fila por cima do que veio do servidor', () => {
    const server = [row({ id: 'a' }), row({ id: 'b', real_qty: '46' })];
    const q: OutboxOp[] = [
      { kind: 'count', id: 'a', patch: patch('44'), at: 1 },
      { kind: 'add', row: found({ id: 'n1', real_qty: '3' }), at: 2 },
    ];
    const v = overlay(server, q);
    expect(v).toHaveLength(3);
    expect(v.find((r) => r.id === 'a')?.real_qty).toBe('44');
    expect(v.find((r) => r.id === 'b')?.real_qty).toBe('46');
  });
  it('uma linha já aplicada pelo Admin não é alterada pela fila', () => {
    const server = [row({ id: 'a', real_qty: '46', applied_at: '2026-09-29T10:00:00Z' })];
    const v = overlay(server, [{ kind: 'count', id: 'a', patch: patch('10'), at: 1 }]);
    expect(v[0].real_qty).toBe('46');
  });
});
