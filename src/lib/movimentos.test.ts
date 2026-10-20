import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { tipoDeErro, totalNaCesta } from './movimentos';

describe('tipoDeErro', () => {
  it('reconhece as recusas da base de dados', () => {
    expect(tipoDeErro({ message: 'stock_insuficiente' })).toBe('stock_insuficiente');
    expect(tipoDeErro({ message: 'ja_estornado' })).toBe('ja_estornado');
    expect(tipoDeErro({ message: 'duplicate key value violates unique constraint "movements_estorno_de_unico"' })).toBe('ja_estornado');
    expect(tipoDeErro({ message: 'sem_permissao' })).toBe('sem_permissao');
  });

  it('trata a falta de rede como sem rede, e não como sucesso', () => {
    expect(tipoDeErro({ message: 'TypeError: Failed to fetch' })).toBe('sem_rede');
    expect(tipoDeErro({ message: 'Load failed' })).toBe('sem_rede');
    expect(tipoDeErro({ message: 'qualquer coisa' }, false)).toBe('sem_rede');
  });

  it('o resto é um erro genérico', () => {
    expect(tipoDeErro({ message: 'quantidade tem de ser um inteiro maior que zero' })).toBe('outro');
    expect(tipoDeErro(null)).toBe('outro');
  });
});

describe('totalNaCesta', () => {
  it('soma as paletes do mesmo modelo e fiada', () => {
    const c = [
      { modelo: 'A', fiada: '1', quantidade: 60 },
      { modelo: 'A', fiada: '1', quantidade: 56 },
      { modelo: 'A', fiada: '2', quantidade: 5 },
      { modelo: 'B', fiada: '1', quantidade: 9 },
    ];
    expect(totalNaCesta(c, 'A', '1')).toBe(116);
    expect(totalNaCesta(c, 'C', '1')).toBe(0);
  });
});
