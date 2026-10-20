-- =====================================================
-- MOVIMENTOS DO PARQUE NUMA SÓ GRAVAÇÃO (auditoria 2026-10-20)
-- Correr uma vez no SQL Editor do Supabase (projeto mtg1-picking), antes do
-- sql/picking_baixa.sql do picking (que passa a usar as funções daqui).
--
-- Até agora a app do parque gravava cada movimento em vários pedidos soltos
-- (ler a cesta, escrever a quantidade, registar o movimento) e não via se
-- algum falhava: com o Wi-Fi a falhar mostrava "sucesso" sem ter gravado, ou
-- descontava a origem de uma transferência sem pôr o material no destino.
-- E escrevia a quantidade lida um instante antes, por isso um movimento feito
-- ao mesmo tempo noutro aparelho perdia-se.
--
-- Agora cada movimento (e cada estorno) é uma só função: ou grava tudo ou
-- nada, soma e desconta sobre o que está na base de dados nesse momento, e um
-- reenvio do mesmo pedido (resposta perdida na rede, duplo toque) não conta
-- duas vezes.
--
-- Várias linhas com o mesmo modelo na mesma cesta e fiada são paletes: contam
-- pelo total. Uma saída acaba primeiro a palete mais pequena.
-- =====================================================

-- Pedidos já processados (só as funções leem e escrevem)
create table if not exists parque_pedidos (
  pedido_id  uuid primary key,
  resultado  json not null,
  criado_em  timestamptz not null default now()
);
alter table parque_pedidos enable row level security;

-- Cada movimento só pode ser estornado uma vez
alter table movements add column if not exists estorno_de uuid references movements(id) on delete set null;
create unique index if not exists movements_estorno_de_unico on movements (estorno_de) where estorno_de is not null;

-- Garante que só uma gravação de cada vez mexe no mesmo modelo/cesta/fiada e
-- devolve o total que lá está (todas as paletes)
create or replace function public.parque_bloquear(p_modelo text, p_cesta text, p_fiada text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('stock|' || p_modelo || '|' || p_cesta || '|' || coalesce(p_fiada, ''), 0));
  select coalesce(sum(quantidade), 0) into v_total
    from stock_items
   where modelo = p_modelo and cesta = p_cesta and fiada is not distinct from p_fiada;
  return v_total;
end;
$$;

-- Soma (delta > 0) ou desconta (delta < 0) num modelo/cesta/fiada já bloqueado.
-- Sem stock suficiente para descontar, falha e nada fica gravado.
create or replace function public.parque_ajustar(p_modelo text, p_cod_sap text, p_cesta text, p_fiada text, p_delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_id    uuid;
  v_falta integer := -p_delta;
begin
  if p_delta > 0 then
    select id into v_id from stock_items
     where modelo = p_modelo and cesta = p_cesta and fiada is not distinct from p_fiada
     order by created_at, id
     limit 1;
    if v_id is null then
      insert into stock_items (modelo, cod_sap, cesta, fiada, quantidade)
      values (p_modelo, p_cod_sap, p_cesta, p_fiada, p_delta);
    else
      update stock_items set quantidade = quantidade + p_delta where id = v_id;
    end if;
  elsif p_delta < 0 then
    for r in select id, quantidade from stock_items
              where modelo = p_modelo and cesta = p_cesta and fiada is not distinct from p_fiada
              order by quantidade, created_at, id
    loop
      exit when v_falta <= 0;
      if r.quantidade <= v_falta then
        delete from stock_items where id = r.id;
        v_falta := v_falta - greatest(r.quantidade, 0);
      else
        update stock_items set quantidade = quantidade - v_falta where id = r.id;
        v_falta := 0;
      end if;
    end loop;
    if v_falta > 0 then
      raise exception 'stock_insuficiente';
    end if;
  end if;
end;
$$;

-- Entrada, saída ou transferência registada no separador Movimento.
-- p_corrigido: o operador disse que o que fica na cesta (de origem) não é o
-- que o sistema dizia; a cesta fica com esse valor e o admin é avisado.
create or replace function public.parque_movimento(
  p_pedido_id     uuid,
  p_tipo          text,
  p_modelo        text,
  p_cesta         text,
  p_fiada         text,
  p_quantidade    integer,
  p_cesta_destino text    default null,
  p_fiada_destino text    default null,
  p_notas         text    default null,
  p_corrigido     integer default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res      json;
  v_papel    text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_quem     text := coalesce(nullif(auth.jwt() -> 'user_metadata' ->> 'username', ''), 'Unknown');
  v_cod_sap  text;
  v_total    integer;
  v_esperado integer;
  v_final    integer;
  v_mov_id   uuid;
  v_chave_o  text;
  v_chave_d  text;
begin
  if v_papel is null or v_papel not in ('admin', 'operator') then
    raise exception 'sem_permissao';
  end if;
  if p_pedido_id is null then
    raise exception 'pedido_id obrigatorio';
  end if;
  if p_tipo is null or p_tipo not in ('entrada', 'saida', 'transferencia') then
    raise exception 'tipo invalido';
  end if;
  if coalesce(btrim(p_modelo), '') = '' or coalesce(btrim(p_cesta), '') = '' or coalesce(btrim(p_fiada), '') = '' then
    raise exception 'modelo, cesta e fiada sao obrigatorios';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'quantidade tem de ser um inteiro maior que zero';
  end if;
  if p_corrigido is not null and p_corrigido < 0 then
    raise exception 'quantidade corrigida nao pode ser negativa';
  end if;
  if p_tipo = 'transferencia' then
    if coalesce(btrim(p_cesta_destino), '') = '' or coalesce(btrim(p_fiada_destino), '') = '' then
      raise exception 'destino obrigatorio';
    end if;
    if p_cesta_destino = p_cesta and p_fiada_destino = p_fiada then
      raise exception 'mesmo_sitio';
    end if;
  end if;

  -- O mesmo pedido outra vez: devolve o resultado da primeira vez
  insert into parque_pedidos (pedido_id, resultado)
  values (p_pedido_id, '{"ok": true, "estado": "em_curso"}')
  on conflict (pedido_id) do nothing;
  if not found then
    select resultado into v_res from parque_pedidos where pedido_id = p_pedido_id;
    return v_res;
  end if;

  select cod_sap into v_cod_sap from model_sap_lookup where modelo = p_modelo limit 1;

  -- Numa transferência bloqueiam-se as duas cestas, sempre pela mesma ordem
  -- (duas transferências cruzadas não ficam à espera uma da outra)
  v_chave_o := p_cesta || '|' || p_fiada;
  v_chave_d := coalesce(p_cesta_destino, '') || '|' || coalesce(p_fiada_destino, '');
  if p_tipo = 'transferencia' and v_chave_d < v_chave_o then
    perform parque_bloquear(p_modelo, p_cesta_destino, p_fiada_destino);
  end if;
  v_total := parque_bloquear(p_modelo, p_cesta, p_fiada);
  if p_tipo = 'transferencia' and v_chave_d > v_chave_o then
    perform parque_bloquear(p_modelo, p_cesta_destino, p_fiada_destino);
  end if;

  v_esperado := case when p_tipo = 'entrada' then v_total + p_quantidade else v_total - p_quantidade end;

  if p_corrigido is not null then
    perform parque_ajustar(p_modelo, v_cod_sap, p_cesta, p_fiada, p_corrigido - v_total);
    v_final := p_corrigido;
  elsif p_tipo = 'entrada' then
    perform parque_ajustar(p_modelo, v_cod_sap, p_cesta, p_fiada, p_quantidade);
    v_final := v_esperado;
  else
    if v_total < p_quantidade then
      raise exception 'stock_insuficiente';
    end if;
    perform parque_ajustar(p_modelo, v_cod_sap, p_cesta, p_fiada, -p_quantidade);
    v_final := v_esperado;
  end if;

  if p_tipo = 'transferencia' then
    perform parque_ajustar(p_modelo, v_cod_sap, p_cesta_destino, p_fiada_destino, p_quantidade);
  end if;

  insert into movements (tipo, modelo, cod_sap, cesta_origem, fiada_origem,
                         cesta_destino, fiada_destino, quantidade, utilizador, notas)
  values (p_tipo, p_modelo, v_cod_sap, p_cesta, p_fiada,
          case when p_tipo = 'transferencia' then p_cesta_destino else p_cesta end,
          case when p_tipo = 'transferencia' then p_fiada_destino else p_fiada end,
          p_quantidade, v_quem, nullif(btrim(p_notas), ''))
  returning id into v_mov_id;

  if p_corrigido is not null then
    insert into admin_notifications (message, movimento_id, utilizador)
    values (format('Stock corrigido por %s: %s em %s/%s. Sistema: %s un. → Corrigido: %s un. (%s)',
                   v_quem, p_modelo, p_cesta, p_fiada, v_esperado, p_corrigido, p_tipo),
            v_mov_id, v_quem);
  end if;

  v_res := json_build_object('ok', true, 'movimento_id', v_mov_id, 'stock_final', v_final,
                             'corrigido', p_corrigido is not null);
  update parque_pedidos set resultado = v_res where pedido_id = p_pedido_id;
  return v_res;
end;
$$;

-- Estorno de um movimento (quem já o podia fazer na app: Admin e operadores).
-- Cada movimento só se estorna uma vez, e não se estorna o que já não está na
-- cesta.
create or replace function public.parque_estorno(p_pedido_id uuid, p_movimento_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res     json;
  v_papel   text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_quem    text := coalesce(nullif(auth.jwt() -> 'user_metadata' ->> 'username', ''), 'Unknown');
  m         movements%rowtype;
  v_total   integer;
  v_mov_id  uuid;
begin
  if v_papel is null or v_papel not in ('admin', 'operator') then
    raise exception 'sem_permissao';
  end if;
  if p_pedido_id is null or p_movimento_id is null then
    raise exception 'pedido_id e movimento_id obrigatorios';
  end if;

  insert into parque_pedidos (pedido_id, resultado)
  values (p_pedido_id, '{"ok": true, "estado": "em_curso"}')
  on conflict (pedido_id) do nothing;
  if not found then
    select resultado into v_res from parque_pedidos where pedido_id = p_pedido_id;
    return v_res;
  end if;

  select * into m from movements where id = p_movimento_id for update;
  if not found then
    raise exception 'movimento_nao_existe';
  end if;
  if m.tipo not in ('entrada', 'saida', 'transferencia') then
    raise exception 'nao_estornavel';
  end if;
  if exists (select 1 from movements where estorno_de = m.id) then
    raise exception 'ja_estornado';
  end if;

  if m.tipo = 'entrada' then
    v_total := parque_bloquear(m.modelo, m.cesta_origem, m.fiada_origem);
    if v_total < m.quantidade then raise exception 'stock_insuficiente'; end if;
    perform parque_ajustar(m.modelo, m.cod_sap, m.cesta_origem, m.fiada_origem, -m.quantidade);
  elsif m.tipo = 'saida' then
    perform parque_bloquear(m.modelo, m.cesta_origem, m.fiada_origem);
    perform parque_ajustar(m.modelo, m.cod_sap, m.cesta_origem, m.fiada_origem, m.quantidade);
  else
    if (m.cesta_destino || '|' || m.fiada_destino) < (m.cesta_origem || '|' || m.fiada_origem) then
      v_total := parque_bloquear(m.modelo, m.cesta_destino, m.fiada_destino);
      perform parque_bloquear(m.modelo, m.cesta_origem, m.fiada_origem);
    else
      perform parque_bloquear(m.modelo, m.cesta_origem, m.fiada_origem);
      v_total := parque_bloquear(m.modelo, m.cesta_destino, m.fiada_destino);
    end if;
    if v_total < m.quantidade then raise exception 'stock_insuficiente'; end if;
    perform parque_ajustar(m.modelo, m.cod_sap, m.cesta_destino, m.fiada_destino, -m.quantidade);
    perform parque_ajustar(m.modelo, m.cod_sap, m.cesta_origem, m.fiada_origem, m.quantidade);
  end if;

  insert into movements (tipo, modelo, cod_sap, cesta_origem, fiada_origem,
                         cesta_destino, fiada_destino, quantidade, utilizador, notas, estorno_de)
  values ('estorno', m.modelo, m.cod_sap, m.cesta_origem, m.fiada_origem,
          m.cesta_destino, m.fiada_destino, m.quantidade, v_quem,
          format('Estorno de %s (%s)', m.tipo, to_char(m.created_at at time zone 'Europe/Lisbon', 'DD/MM HH24:MI')),
          m.id)
  returning id into v_mov_id;

  v_res := json_build_object('ok', true, 'movimento_id', v_mov_id);
  update parque_pedidos set resultado = v_res where pedido_id = p_pedido_id;
  return v_res;
end;
$$;

-- As duas primeiras só se usam por dentro das outras funções
revoke all on function public.parque_bloquear(text,text,text) from public, anon, authenticated;
revoke all on function public.parque_ajustar(text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.parque_movimento(uuid,text,text,text,text,integer,text,text,text,integer) from public, anon;
revoke all on function public.parque_estorno(uuid,uuid) from public, anon;
grant execute on function public.parque_movimento(uuid,text,text,text,text,integer,text,text,text,integer) to authenticated;
grant execute on function public.parque_estorno(uuid,uuid) to authenticated;
