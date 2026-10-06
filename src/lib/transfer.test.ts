import { describe, expect, it } from 'vitest';
import { isSameLocation, wholeCestaQuantity } from './transfer';

describe('quantidade pré-preenchida na transferência', () => {
  const cesta = [{ modelo: 'CLO1B05S075', fiada: 'C18', quantidade: 46 }];

  it('usa a quantidade da linha quando o modelo e a fiada identificam uma só', () => {
    expect(wholeCestaQuantity(cesta, 'CLO1B05S075', 'C18')).toBe(46);
  });
  it('sem modelo escolhido não sugere nada', () => {
    expect(wholeCestaQuantity(cesta, '', 'C18')).toBeNull();
  });
  it('outro modelo ou outra fiada não sugere nada', () => {
    expect(wholeCestaQuantity(cesta, 'OUTRO', 'C18')).toBeNull();
    expect(wholeCestaQuantity(cesta, 'CLO1B05S075', 'C19')).toBeNull();
  });
  it('cesta com dois modelos: cada um dá a sua quantidade', () => {
    const duas = [...cesta, { modelo: 'CLO1B05S100', fiada: 'C18', quantidade: 12 }];
    expect(wholeCestaQuantity(duas, 'CLO1B05S100', 'C18')).toBe(12);
  });
  it('caixas repetidas (várias linhas iguais): não adivinha', () => {
    const caixas = [1, 2, 3].map(() => ({ modelo: 'TOVM0435', fiada: 'C23', quantidade: 150 }));
    expect(wholeCestaQuantity(caixas, 'TOVM0435', 'C23')).toBeNull();
  });
  it('fiada em falta na base de dados conta como vazia', () => {
    expect(wholeCestaQuantity([{ modelo: 'X', fiada: null, quantidade: 5 }], 'X', '')).toBe(5);
  });
});

describe('transferência para o mesmo sítio', () => {
  it('mesma cesta e mesma fiada é a mesma localização', () => {
    expect(isSameLocation({ cesta: 'MTG1_CB136', fiada: 'C18' }, { cesta: 'mtg1_cb136', fiada: 'c18' })).toBe(true);
  });
  it('mudar só a fiada, ou só a cesta, já é uma transferência', () => {
    expect(isSameLocation({ cesta: 'MTG1_CB136', fiada: 'C18' }, { cesta: 'MTG1_CB136', fiada: 'C19' })).toBe(false);
    expect(isSameLocation({ cesta: 'MTG1_CB136', fiada: 'C18' }, { cesta: 'MTG1_CB137', fiada: 'C18' })).toBe(false);
  });
});
