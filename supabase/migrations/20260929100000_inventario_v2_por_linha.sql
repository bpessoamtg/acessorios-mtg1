-- =====================================================================
-- Inventário v2 — aplicar ajustes linha a linha
--
-- A primeira versão de inventory_apply identificava o stock por modelo +
-- cesta + fiada. Em "Caixa", "Palete" e "Lote" isso não é único: há, por
-- exemplo, 5 linhas de TOVM0435 na Caixa C23, cada uma com 150 — são 5
-- caixas. Contar uma caixa comparava 150 com 750 e retirava 600 ao stock;
-- e inv_set_stock ainda juntava as 5 linhas numa só.
--
-- Agora cada linha de inventário atua sobre a sua própria linha de stock
-- (stock_item_id). Sem essa ligação, a linha de stock já não existe (a base
-- de dados anula a ligação quando a linha é apagada) e conta como zero.
-- =====================================================================

DROP FUNCTION IF EXISTS private.inv_set_stock(text, text, text, integer);
DROP FUNCTION IF EXISTS private.inv_get_stock(text, text, text);

-- Junta a quantidade à linha dessa posição quando há exatamente uma (cestas
-- MTG1_CB, como faz um movimento normal); senão cria uma linha nova, que é o
-- que uma caixa, palete ou lote a mais é.
CREATE OR REPLACE FUNCTION private.inv_add_at(p_modelo text, p_cesta text, p_fiada text, p_qty integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_ids uuid[]; v_sap text;
BEGIN
  IF p_qty <= 0 THEN RETURN; END IF;
  SELECT array_agg(id) INTO v_ids FROM public.stock_items
  WHERE modelo = p_modelo AND cesta = p_cesta AND coalesce(fiada, '') = coalesce(p_fiada, '');
  IF coalesce(array_length(v_ids, 1), 0) = 1 THEN
    UPDATE public.stock_items SET quantidade = quantidade + p_qty WHERE id = v_ids[1];
  ELSE
    SELECT cod_sap INTO v_sap FROM public.model_sap_lookup WHERE modelo = p_modelo;
    INSERT INTO public.stock_items (modelo, cod_sap, cesta, fiada, quantidade)
    VALUES (p_modelo, v_sap, p_cesta, nullif(p_fiada, ''), p_qty);
  END IF;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.inventory_apply(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
  v_user text := coalesce(auth.jwt() -> 'user_metadata' ->> 'username', 'Admin');
  v_inv uuid;
  v_note text;
  r record;
  v_line uuid; v_cur int; v_q int; v_d int;
  v_same boolean; v_same_model boolean;
  v_rows int := 0; v_moves int := 0;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Só o Admin pode aplicar diferenças ao stock.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.inventory_rpc', 'on', true);

  SELECT id INTO v_inv FROM public.inventories WHERE closed_at IS NULL;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'Não há nenhum inventário aberto.'; END IF;
  v_note := 'Inventário ' || to_char(now() AT TIME ZONE 'Europe/Lisbon', 'DD/MM/YYYY') || ' — ajuste';

  FOR r IN
    SELECT * FROM public.inventory_audit
    WHERE id = ANY(p_ids) AND inventory_id = v_inv AND applied_at IS NULL AND real_qty <> ''
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    IF r.real_qty !~ '^\d+$' THEN
      RAISE EXCEPTION 'Quantidade inválida (%) em % / %.', r.real_qty, r.real_cesta, r.real_modelo;
    END IF;
    v_q := r.real_qty::int;

    -- Item encontrado: entra no sítio onde foi encontrado.
    IF r.system_modelo = '' THEN
      PERFORM private.inv_add_at(r.real_modelo, r.real_cesta, r.real_fiada, v_q);
      IF v_q > 0 THEN
        PERFORM private.inv_move('entrada', r.real_modelo, r.real_cesta, r.real_fiada, r.real_cesta, r.real_fiada, v_q, v_user, v_note);
        v_moves := v_moves + 1;
      END IF;
      UPDATE public.inventory_audit SET applied_at = now(), applied_by = v_user WHERE id = r.id;
      v_rows := v_rows + 1;
      CONTINUE;
    END IF;

    -- A linha de stock desta linha de inventário, e só essa.
    v_line := NULL;
    v_cur := 0;
    IF r.stock_item_id IS NOT NULL THEN
      SELECT id, quantidade INTO v_line, v_cur FROM public.stock_items WHERE id = r.stock_item_id FOR UPDATE;
      v_cur := coalesce(v_cur, 0);
    END IF;

    v_same_model := lower(r.real_modelo) = lower(r.system_modelo);
    v_same := v_same_model
              AND lower(r.real_cesta) = lower(r.system_cesta)
              AND lower(r.real_fiada) = lower(r.system_fiada);

    IF v_same THEN
      v_d := v_q - v_cur;
      IF v_line IS NOT NULL THEN
        IF v_q = 0 THEN
          DELETE FROM public.stock_items WHERE id = v_line;
        ELSE
          UPDATE public.stock_items SET quantidade = v_q WHERE id = v_line;
        END IF;
      ELSE
        -- A linha desapareceu do stock mas o material está lá.
        PERFORM private.inv_add_at(r.system_modelo, r.system_cesta, r.system_fiada, v_q);
      END IF;
      IF v_d <> 0 THEN
        PERFORM private.inv_move(CASE WHEN v_d > 0 THEN 'entrada' ELSE 'saida' END, r.system_modelo,
          r.system_cesta, r.system_fiada, r.system_cesta, r.system_fiada, abs(v_d), v_user, v_note);
        v_moves := v_moves + 1;
      END IF;

    ELSE
      -- Noutro sítio: esta linha sai de onde o sistema a tinha e fica onde foi encontrada.
      IF v_line IS NOT NULL THEN
        DELETE FROM public.stock_items WHERE id = v_line;
      END IF;
      PERFORM private.inv_add_at(r.real_modelo, r.real_cesta, r.real_fiada, v_q);
      IF v_same_model THEN
        IF v_cur > 0 THEN
          PERFORM private.inv_move('transferencia', r.system_modelo, r.system_cesta, r.system_fiada,
            r.real_cesta, r.real_fiada, least(v_cur, v_q), v_user, v_note);
          v_moves := v_moves + 1;
        END IF;
        v_d := v_q - v_cur;
        IF v_d > 0 THEN
          PERFORM private.inv_move('entrada', r.real_modelo, r.real_cesta, r.real_fiada,
            r.real_cesta, r.real_fiada, v_d, v_user, v_note);
          v_moves := v_moves + 1;
        ELSIF v_d < 0 THEN
          PERFORM private.inv_move('saida', r.system_modelo, r.system_cesta, r.system_fiada,
            r.system_cesta, r.system_fiada, -v_d, v_user, v_note);
          v_moves := v_moves + 1;
        END IF;
      ELSE
        IF v_cur > 0 THEN
          PERFORM private.inv_move('saida', r.system_modelo, r.system_cesta, r.system_fiada,
            r.system_cesta, r.system_fiada, v_cur, v_user, v_note);
          v_moves := v_moves + 1;
        END IF;
        IF v_q > 0 THEN
          PERFORM private.inv_move('entrada', r.real_modelo, r.real_cesta, r.real_fiada,
            r.real_cesta, r.real_fiada, v_q, v_user, v_note);
          v_moves := v_moves + 1;
        END IF;
      END IF;
    END IF;

    UPDATE public.inventory_audit SET applied_at = now(), applied_by = v_user WHERE id = r.id;
    v_rows := v_rows + 1;
  END LOOP;

  RETURN jsonb_build_object('rows', v_rows, 'movements', v_moves);
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_apply(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_apply(uuid[]) TO authenticated;
