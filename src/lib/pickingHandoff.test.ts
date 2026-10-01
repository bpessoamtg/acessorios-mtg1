import { describe, it, expect } from 'vitest';
import { lerHandoff, sairTambemDoPicking, HANDOFF_KEY, PICKING_SESSAO_KEY } from './pickingHandoff';

const memoria = (inicial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    removeItem: (k: string) => { m.delete(k); },
    has: (k: string) => m.has(k),
  };
};

const AGORA = 1_790_000_000_000;
const handoff = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ username: 'Carmona', access_token: 'a', refresh_token: 'r', em: AGORA - 1000, ...extra });

describe('lerHandoff', () => {
  it('devolve a sessão deixada pelo picking e apaga-a', () => {
    const s = memoria({ [HANDOFF_KEY]: handoff() });
    expect(lerHandoff(s, AGORA)).toEqual({ username: 'Carmona', access_token: 'a', refresh_token: 'r', em: AGORA - 1000 });
    expect(s.has(HANDOFF_KEY)).toBe(false);
  });

  it('serve uma única vez', () => {
    const s = memoria({ [HANDOFF_KEY]: handoff() });
    lerHandoff(s, AGORA);
    expect(lerHandoff(s, AGORA)).toBeNull();
  });

  it('sem nada guardado devolve null', () => {
    expect(lerHandoff(memoria(), AGORA)).toBeNull();
  });

  it('ignora uma sessão com mais de um dia', () => {
    const s = memoria({ [HANDOFF_KEY]: handoff({ em: AGORA - 25 * 3600 * 1000 }) });
    expect(lerHandoff(s, AGORA)).toBeNull();
    expect(s.has(HANDOFF_KEY)).toBe(false);
  });

  it('aceita uma sessão aberta de manhã e usada à tarde', () => {
    const s = memoria({ [HANDOFF_KEY]: handoff({ em: AGORA - 8 * 3600 * 1000 }) });
    expect(lerHandoff(s, AGORA)?.username).toBe('Carmona');
  });

  it('ignora uma sessão com data no futuro', () => {
    const s = memoria({ [HANDOFF_KEY]: handoff({ em: AGORA + 3600 * 1000 }) });
    expect(lerHandoff(s, AGORA)).toBeNull();
  });

  it('ignora conteúdo mal formado em vez de rebentar', () => {
    for (const lixo of ['{', 'null', '42', '"texto"', handoff({ access_token: '' }), handoff({ refresh_token: 7 }), handoff({ username: '' })]) {
      expect(lerHandoff(memoria({ [HANDOFF_KEY]: lixo }), AGORA)).toBeNull();
    }
  });

  it('não rebenta se o storage estiver bloqueado', () => {
    const bloqueado = { getItem: () => { throw new Error('bloqueado'); }, removeItem: () => { throw new Error('bloqueado'); } };
    expect(lerHandoff(bloqueado, AGORA)).toBeNull();
  });
});

describe('sairTambemDoPicking', () => {
  it('sai do picking quando lá está a mesma pessoa', () => {
    const s = memoria({ [PICKING_SESSAO_KEY]: 'Deepak', [HANDOFF_KEY]: handoff() });
    sairTambemDoPicking(s, 'Deepak');
    expect(s.has(PICKING_SESSAO_KEY)).toBe(false);
    expect(s.has(HANDOFF_KEY)).toBe(false);
  });

  it('não tira do picking outra pessoa', () => {
    const s = memoria({ [PICKING_SESSAO_KEY]: 'Carmona' });
    sairTambemDoPicking(s, 'Deepak');
    expect(s.getItem(PICKING_SESSAO_KEY)).toBe('Carmona');
  });

  it('o Admin do parque não tira os admins do picking', () => {
    const s = memoria({ [PICKING_SESSAO_KEY]: 'adminbp' });
    sairTambemDoPicking(s, 'Admin');
    expect(s.getItem(PICKING_SESSAO_KEY)).toBe('adminbp');
  });
});
