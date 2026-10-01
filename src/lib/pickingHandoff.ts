// Ponte de login com a app de picking da expedição.
//
// As duas apps estão no mesmo domínio e no mesmo projeto Supabase, e o Carmona e
// o Deepak existem nas duas: quem entra numa tem de estar dentro da outra.
//
// Picking -> parque: o PIN só existe no momento em que o operador o escreve no
// picking, por isso é aí que o picking chama a função `login` deste projeto (que o
// verifica no servidor, como se ele tivesse entrado aqui) e deixa a sessão no
// localStorage. Ao arrancar, esta app usa-a uma vez e apaga-a.
//
// Parque -> picking: o picking lê a sessão desta app e entra com o mesmo nome.
//
// "Sair" numa sai das duas, para o próximo a pegar num telemóvel partilhado não
// abrir a outra app com a sessão de quem saiu.

/** Onde o picking guarda quem tem sessão lá. */
export const PICKING_SESSAO_KEY = 'picking_utilizador';
/** Sessão deste parque aberta pelo picking, à espera de ser usada aqui. */
export const HANDOFF_KEY = 'parque_sessao_do_picking';

/** Nome no picking -> nome aqui. Os admins ficam de fora: há dois no picking e
 *  um só "Admin" aqui, por isso não se sabe quem é quem. */
export const PICKING_PARA_PARQUE: Record<string, string> = {
  Carmona: 'Carmona',
  Deepak: 'Deepak',
};

/** Uma manhã inteira entre entrar no picking e abrir o parque tem de chegar. */
const VALIDADE_MS = 24 * 60 * 60 * 1000;

export interface Handoff {
  username: string;
  access_token: string;
  refresh_token: string;
  em: number;
}

type Leitura = Pick<Storage, 'getItem' | 'removeItem'>;

/**
 * Devolve a sessão deixada pelo picking, se houver uma válida, e apaga-a: serve
 * uma única vez. Qualquer coisa estranha (mal formada, velha, do futuro) é
 * ignorada e o parque pede o login como sempre.
 */
export function lerHandoff(storage: Leitura, agora = Date.now()): Handoff | null {
  let raw: string | null;
  try {
    raw = storage.getItem(HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    storage.removeItem(HANDOFF_KEY);
  } catch {
    /* sem acesso ao storage: não há nada a limpar */
  }

  let h: unknown;
  try {
    h = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!h || typeof h !== 'object') return null;
  const { username, access_token, refresh_token, em } = h as Record<string, unknown>;
  if (
    typeof username !== 'string' || !username ||
    typeof access_token !== 'string' || !access_token ||
    typeof refresh_token !== 'string' || !refresh_token ||
    typeof em !== 'number'
  ) return null;
  if (agora - em > VALIDADE_MS || em > agora + 60_000) return null;
  return { username, access_token, refresh_token, em };
}

/**
 * Ao sair daqui, sai também do picking -- mas só se lá estiver a mesma pessoa.
 * A sessão de outro utilizador no picking não é desta saída.
 */
export function sairTambemDoPicking(storage: Leitura, usernameParque: string | undefined): void {
  try {
    storage.removeItem(HANDOFF_KEY);
    const noPicking = storage.getItem(PICKING_SESSAO_KEY);
    if (noPicking && usernameParque && PICKING_PARA_PARQUE[noPicking] === usernameParque) {
      storage.removeItem(PICKING_SESSAO_KEY);
    }
  } catch {
    /* sem acesso ao storage: nada a fazer */
  }
}
