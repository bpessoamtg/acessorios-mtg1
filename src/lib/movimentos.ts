import { supabase } from '@/integrations/supabase/client';

// As funções parque_movimento e parque_estorno (supabase/parque_movimento.sql)
// gravam tudo de uma vez ou nada. Ainda não estão nos tipos gerados.
const db = supabase as any;

export type ErroMovimento = 'sem_rede' | 'stock_insuficiente' | 'ja_estornado' | 'sem_permissao' | 'outro';

// O supabase-js não lança exceção quando a rede falha: devolve um error com a
// mensagem do browser. As recusas da base de dados trazem o código na mensagem.
export const tipoDeErro = (error: { message?: string } | null | undefined, online = true): ErroMovimento => {
  const msg = error?.message || '';
  if (msg.includes('stock_insuficiente')) return 'stock_insuficiente';
  if (msg.includes('ja_estornado') || msg.includes('movements_estorno_de_unico')) return 'ja_estornado';
  if (msg.includes('sem_permissao') || msg.includes('JWT')) return 'sem_permissao';
  if (!online || /failed to fetch|network|load failed|fetch failed|timeout/i.test(msg)) return 'sem_rede';
  return 'outro';
};

export interface Movimento {
  tipo: string;
  modelo: string;
  cesta: string;
  fiada: string;
  quantidade: number;
  cestaDestino?: string;
  fiadaDestino?: string;
  notas?: string | null;
  corrigido?: number;
}

export const gravarMovimento = async (pedidoId: string, m: Movimento) => {
  const { data, error } = await db.rpc('parque_movimento', {
    p_pedido_id: pedidoId,
    p_tipo: m.tipo,
    p_modelo: m.modelo,
    p_cesta: m.cesta,
    p_fiada: m.fiada,
    p_quantidade: m.quantidade,
    p_cesta_destino: m.cestaDestino ?? null,
    p_fiada_destino: m.fiadaDestino ?? null,
    p_notas: m.notas ?? null,
    p_corrigido: m.corrigido ?? null,
  });
  if (error) return { ok: false as const, erro: tipoDeErro(error, navigator.onLine), error };
  return { ok: true as const, data };
};

export const estornarMovimento = async (pedidoId: string, movimentoId: string) => {
  const { data, error } = await db.rpc('parque_estorno', { p_pedido_id: pedidoId, p_movimento_id: movimentoId });
  if (error) return { ok: false as const, erro: tipoDeErro(error, navigator.onLine), error };
  return { ok: true as const, data };
};

// Várias linhas do mesmo modelo na mesma cesta e fiada são paletes: conta o total
export const totalNaCesta = (conteudo: { modelo: string; fiada: string | null; quantidade: number }[], modelo: string, fiada: string) =>
  conteudo.filter((c) => c.modelo === modelo && c.fiada === fiada).reduce((s, c) => s + (c.quantidade || 0), 0);
