import { describe, expect, it } from 'vitest';
import { AuditRow, stockMap } from './inventory';
import { buildSapMap, inventoryExportRows } from './inventoryExport';

let n = 0;
const row = (over: Partial<AuditRow> = {}): AuditRow => {
  n += 1;
  return {
    id: `r${n}`, inventory_id: 'inv', stock_item_id: `s${n}`,
    system_modelo: 'TOVM0442', system_cesta: 'MTG1_CB010', system_fiada: 'C10', system_qty: 27,
    real_modelo: 'TOVM0442', real_cesta: 'MTG1_CB010', real_fiada: 'C10', real_qty: '27',
    counted_by: 'Deepak', counted_at: '2026-10-12T10:42:00Z', applied_at: null, applied_by: null,
    created_at: '2026-10-09T22:54:00Z', ...over,
  };
};
const found = (over: Partial<AuditRow> = {}) =>
  row({ stock_item_id: null, system_modelo: '', system_cesta: '', system_fiada: '', system_qty: 0, ...over });
const fmt = (iso: string | null) => (iso ? 'data' : '');

describe('mapa de códigos SAP', () => {
  it('usa a tabela de modelos', () => {
    expect(buildSapMap([{ modelo: 'TOVM0442', cod_sap: 'CCABT011G' }], [])).toEqual({ TOVM0442: 'CCABT011G' });
  });
  it('um modelo que só o stock conhece fica com o código das linhas de stock', () => {
    const m = buildSapMap([], [{ modelo: 'ERW4260', cod_sap: 'CCABN011G' }, { modelo: 'ERW4260', cod_sap: 'CCABN011G' }]);
    expect(m.ERW4260).toBe('CCABN011G');
  });
  it('a tabela de modelos tem prioridade sobre o stock', () => {
    const m = buildSapMap([{ modelo: 'X', cod_sap: 'DA-TABELA' }], [{ modelo: 'X', cod_sap: 'DO-STOCK' }]);
    expect(m.X).toBe('DA-TABELA');
  });
  it('código vazio ou só espaços conta como sem código', () => {
    const m = buildSapMap([{ modelo: 'TR76KC080D1', cod_sap: '' }, { modelo: 'Y', cod_sap: null }], [{ modelo: 'Z', cod_sap: '  ' }]);
    expect(m).toEqual({});
  });
  it('sem código na tabela, usa o do stock em vez de deixar em branco', () => {
    expect(buildSapMap([{ modelo: 'TR76KC080D1', cod_sap: '' }], [{ modelo: 'TR76KC080D1', cod_sap: 'ABC' }]).TR76KC080D1).toBe('ABC');
  });
});

describe('linhas do Excel do inventário', () => {
  const sap = { TOVM0442: 'CCABT011G', TOVM0430: 'CCABT013G' };
  const linhas = (rows: AuditRow[]) => inventoryExportRows(rows, stockMap([]), sap, fmt);

  it('traz o código SAP junto ao modelo do sistema e ao modelo real', () => {
    const [l] = linhas([row()]);
    expect(l['Cod SAP (Sistema)']).toBe('CCABT011G');
    expect(l['Cod SAP (Real)']).toBe('CCABT011G');
  });
  it('as colunas de SAP ficam ao lado do modelo', () => {
    const cols = Object.keys(linhas([row()])[0]);
    expect(cols.indexOf('Cod SAP (Sistema)')).toBe(cols.indexOf('Modelo (Sistema)') + 1);
    expect(cols.indexOf('Cod SAP (Real)')).toBe(cols.indexOf('Modelo (Real)') + 1);
  });
  it('item encontrado: sem sistema, mas com o SAP do modelo que lhe foi dado', () => {
    const [l] = linhas([found({ real_modelo: 'TOVM0430', real_qty: '40', real_cesta: 'Palete' })]);
    expect(l['Modelo (Sistema)']).toBe('');
    expect(l['Cod SAP (Sistema)']).toBe('');
    expect(l['Cod SAP (Real)']).toBe('CCABT013G');
    expect(l['Estado']).toBe('Item encontrado');
    expect(l['Diferença Qtd']).toBe(40);
  });
  it('modelo sem código em lado nenhum sai em branco, não como "undefined"', () => {
    const [l] = linhas([found({ real_modelo: 'TRAVESSA 1800', real_qty: '6' })]);
    expect(l['Cod SAP (Real)']).toBe('');
  });
  it('modelo diferente do contado: cada coluna com o seu código', () => {
    const [l] = linhas([row({ real_modelo: 'TOVM0430' })]);
    expect(l['Cod SAP (Sistema)']).toBe('CCABT011G');
    expect(l['Cod SAP (Real)']).toBe('CCABT013G');
  });
  it('por contar: quantidades e diferença em branco, SAP do sistema presente', () => {
    const [l] = linhas([row({ real_qty: '', counted_at: null, counted_by: null })]);
    expect(l['Qtd (Real)']).toBe('');
    expect(l['Diferença Qtd']).toBe('');
    expect(l['Cod SAP (Sistema)']).toBe('CCABT011G');
    expect(l['Estado']).toBe('Por contar');
  });
  it('mantém a ordem por cesta e o resto das colunas', () => {
    const r = linhas([row({ system_cesta: 'MTG1_CB020', real_cesta: 'MTG1_CB020' }), row({ system_cesta: 'MTG1_CB005', real_cesta: 'MTG1_CB005' })]);
    expect(r.map((x) => x['Cesta (Sistema)'])).toEqual(['MTG1_CB005', 'MTG1_CB020']);
    expect(Object.keys(r[0])).toEqual([
      'Modelo (Sistema)', 'Cod SAP (Sistema)', 'Cesta (Sistema)', 'Fiada (Sistema)', 'Qtd (Sistema, início)', 'Qtd (Stock agora)',
      'Modelo (Real)', 'Cod SAP (Real)', 'Cesta (Real)', 'Fiada (Real)', 'Qtd (Real)', 'Diferença Qtd', 'Estado',
      'Contado por', 'Contado em', 'Aplicado em',
    ]);
  });
});
