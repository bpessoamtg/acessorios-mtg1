-- =====================================================================
-- Inventário v2
--
-- 1. Cada contagem grava a sua linha, em vez de a app apagar e reescrever a
--    tabela inteira. As regras abaixo impedem que isso volte a acontecer.
-- 2. Quem contou e quando (a data é posta pela base de dados).
-- 3. Inventários arquivados em vez de apagados.
-- 4. Aplicar as diferenças ao stock e começar um inventário novo são funções
--    da base de dados, que recusam quem não for Admin. Esconder o botão na
--    app não chegava: os operadores têm permissão para escrever no stock.
-- =====================================================================

-- ── Inventários ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_by TEXT NOT NULL DEFAULT 'Admin',
  closed_at  TIMESTAMPTZ,
  closed_by  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS inventories_one_open ON public.inventories ((true)) WHERE closed_at IS NULL;

ALTER TABLE public.inventories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventories FROM anon, authenticated;
GRANT SELECT ON public.inventories TO authenticated;
GRANT ALL ON public.inventories TO service_role;
DROP POLICY IF EXISTS "Inventory roles can read inventories" ON public.inventories;
CREATE POLICY "Inventory roles can read inventories" ON public.inventories
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin'));

-- ── Colunas novas nas linhas de inventário ────────────────────────────
ALTER TABLE public.inventory_audit
  ADD COLUMN IF NOT EXISTS inventory_id UUID REFERENCES public.inventories(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS counted_by   TEXT,
  ADD COLUMN IF NOT EXISTS counted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_by   TEXT;

-- As linhas que já existem passam a ser o inventário aberto.
DO $$
DECLARE v_inv UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.inventory_audit WHERE inventory_id IS NULL) THEN
    SELECT id INTO v_inv FROM public.inventories WHERE closed_at IS NULL LIMIT 1;
    IF v_inv IS NULL THEN
      INSERT INTO public.inventories (started_at, started_by)
      SELECT coalesce(min(created_at), now()), 'Admin' FROM public.inventory_audit
      RETURNING id INTO v_inv;
    END IF;
    UPDATE public.inventory_audit SET inventory_id = v_inv WHERE inventory_id IS NULL;
    UPDATE public.inventory_audit SET counted_at = updated_at WHERE real_qty <> '' AND counted_at IS NULL;
  END IF;
END $$;

ALTER TABLE public.inventory_audit ALTER COLUMN inventory_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_audit_inventory_idx ON public.inventory_audit (inventory_id);

-- ── Guarda: o que a app pode e não pode mudar numa linha ──────────────
-- As funções de Admin mais abaixo ligam app.inventory_rpc só durante a sua
-- própria transação; nenhum pedido vindo do browser o consegue ligar.
CREATE OR REPLACE FUNCTION public.inventory_audit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_open BOOLEAN;
BEGIN
  IF coalesce(current_setting('app.inventory_rpc', true), '') = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  -- Apagar uma linha de stock anula a ligação (ON DELETE SET NULL). Isso tem
  -- de passar sempre, senão os movimentos do dia a dia deixavam de funcionar.
  IF TG_OP = 'UPDATE'
     AND OLD.stock_item_id IS NOT NULL AND NEW.stock_item_id IS NULL
     AND (to_jsonb(NEW) - 'stock_item_id' - 'updated_at') = (to_jsonb(OLD) - 'stock_item_id' - 'updated_at') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT closed_at IS NULL INTO v_open FROM public.inventories WHERE id = OLD.inventory_id;
    IF NOT coalesce(v_open, false) THEN RAISE EXCEPTION 'Este inventário já está fechado.' USING ERRCODE = '42501'; END IF;
    IF OLD.applied_at IS NOT NULL THEN RAISE EXCEPTION 'Esta linha já foi aplicada ao stock.' USING ERRCODE = '42501'; END IF;
    IF OLD.system_modelo <> '' THEN RAISE EXCEPTION 'Só se podem remover itens encontrados.' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;

  SELECT closed_at IS NULL INTO v_open FROM public.inventories WHERE id = NEW.inventory_id;
  IF NOT coalesce(v_open, false) THEN RAISE EXCEPTION 'Este inventário já está fechado.' USING ERRCODE = '42501'; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.system_modelo <> '' OR NEW.system_qty <> 0 OR NEW.stock_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'Só se podem acrescentar itens encontrados.' USING ERRCODE = '42501';
    END IF;
    NEW.applied_at := NULL;
    NEW.applied_by := NULL;
    NEW.counted_at := CASE WHEN NEW.real_qty = '' THEN NULL ELSE now() END;
    RETURN NEW;
  END IF;

  IF OLD.applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta linha já foi aplicada ao stock e não pode ser alterada.' USING ERRCODE = '42501';
  END IF;
  IF NEW.inventory_id  IS DISTINCT FROM OLD.inventory_id
  OR NEW.stock_item_id IS DISTINCT FROM OLD.stock_item_id
  OR NEW.system_modelo IS DISTINCT FROM OLD.system_modelo
  OR NEW.system_cesta  IS DISTINCT FROM OLD.system_cesta
  OR NEW.system_fiada  IS DISTINCT FROM OLD.system_fiada
  OR NEW.system_qty    IS DISTINCT FROM OLD.system_qty
  OR NEW.applied_at    IS DISTINCT FROM OLD.applied_at
  OR NEW.applied_by    IS DISTINCT FROM OLD.applied_by THEN
    RAISE EXCEPTION 'Os valores do sistema e da aplicação ao stock não se alteram pela app.' USING ERRCODE = '42501';
  END IF;
  IF NEW.real_qty    IS DISTINCT FROM OLD.real_qty
  OR NEW.real_cesta  IS DISTINCT FROM OLD.real_cesta
  OR NEW.real_fiada  IS DISTINCT FROM OLD.real_fiada
  OR NEW.real_modelo IS DISTINCT FROM OLD.real_modelo THEN
    NEW.counted_at := CASE WHEN NEW.real_qty = '' THEN NULL ELSE now() END;
    IF NEW.real_qty = '' THEN NEW.counted_by := NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_audit_guard ON public.inventory_audit;
CREATE TRIGGER inventory_audit_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_audit
  FOR EACH ROW EXECUTE FUNCTION public.inventory_audit_guard();

-- ── Permissões nas linhas de inventário ───────────────────────────────
DROP POLICY IF EXISTS "Inventory roles can read audit"   ON public.inventory_audit;
DROP POLICY IF EXISTS "Inventory roles can insert audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Inventory roles can update audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Inventory roles can delete audit" ON public.inventory_audit;
CREATE POLICY "Inventory roles can read audit" ON public.inventory_audit
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin'));
CREATE POLICY "Inventory roles can add found items" ON public.inventory_audit
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin') AND system_modelo = '');
CREATE POLICY "Inventory roles can count" ON public.inventory_audit
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin') AND applied_at IS NULL)
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin'));
CREATE POLICY "Inventory roles can remove found items" ON public.inventory_audit
  FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin') AND system_modelo = '' AND applied_at IS NULL);

-- ── Funções internas (fora do esquema público, ninguém as chama de fora) ─
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.inv_get_stock(p_modelo text, p_cesta text, p_fiada text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(sum(quantidade), 0)::int FROM public.stock_items
  WHERE modelo = p_modelo AND cesta = p_cesta AND coalesce(fiada, '') = coalesce(p_fiada, '');
$$;

CREATE OR REPLACE FUNCTION private.inv_set_stock(p_modelo text, p_cesta text, p_fiada text, p_qty integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_id uuid; v_sap text;
BEGIN
  SELECT id INTO v_id FROM public.stock_items
  WHERE modelo = p_modelo AND cesta = p_cesta AND coalesce(fiada, '') = coalesce(p_fiada, '')
  ORDER BY created_at LIMIT 1 FOR UPDATE;
  -- Linhas duplicadas para a mesma posição ficam reduzidas a uma.
  DELETE FROM public.stock_items
  WHERE modelo = p_modelo AND cesta = p_cesta AND coalesce(fiada, '') = coalesce(p_fiada, '')
    AND id IS DISTINCT FROM v_id;
  IF p_qty <= 0 THEN
    IF v_id IS NOT NULL THEN DELETE FROM public.stock_items WHERE id = v_id; END IF;
  ELSIF v_id IS NOT NULL THEN
    UPDATE public.stock_items SET quantidade = p_qty WHERE id = v_id;
  ELSE
    SELECT cod_sap INTO v_sap FROM public.model_sap_lookup WHERE modelo = p_modelo;
    INSERT INTO public.stock_items (modelo, cod_sap, cesta, fiada, quantidade)
    VALUES (p_modelo, v_sap, p_cesta, nullif(p_fiada, ''), p_qty);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.inv_move(
  p_tipo text, p_modelo text, p_cesta_o text, p_fiada_o text,
  p_cesta_d text, p_fiada_d text, p_qty integer, p_user text, p_note text)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO public.movements
    (tipo, modelo, cod_sap, cesta_origem, fiada_origem, cesta_destino, fiada_destino, quantidade, utilizador, notas)
  SELECT p_tipo, p_modelo, (SELECT cod_sap FROM public.model_sap_lookup WHERE modelo = p_modelo),
         p_cesta_o, nullif(p_fiada_o, ''), p_cesta_d, nullif(p_fiada_d, ''), p_qty, p_user, p_note;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

-- ── Aplicar diferenças ao stock (só Admin) ────────────────────────────
-- O stock passa a ser o valor contado. Cada diferença fica como movimento
-- normal (entrada, saída ou transferência), por isso aparece no Histórico e
-- pode ser estornada de lá. Tudo ou nada: se uma linha falhar, nada muda.
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
  v_q int; v_cur int; v_dst int; v_d int;
  v_new boolean; v_same boolean; v_same_model boolean;
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
    v_new := r.system_modelo = '';
    v_same_model := lower(r.real_modelo) = lower(r.system_modelo);
    v_same := NOT v_new AND v_same_model
              AND lower(r.real_cesta) = lower(r.system_cesta)
              AND lower(r.real_fiada) = lower(r.system_fiada);

    IF v_new THEN
      v_dst := private.inv_get_stock(r.real_modelo, r.real_cesta, r.real_fiada);
      PERFORM private.inv_set_stock(r.real_modelo, r.real_cesta, r.real_fiada, v_dst + v_q);
      IF v_q > 0 THEN
        PERFORM private.inv_move('entrada', r.real_modelo, r.real_cesta, r.real_fiada, r.real_cesta, r.real_fiada, v_q, v_user, v_note);
        v_moves := v_moves + 1;
      END IF;

    ELSIF v_same THEN
      v_cur := private.inv_get_stock(r.system_modelo, r.system_cesta, r.system_fiada);
      v_d := v_q - v_cur;
      PERFORM private.inv_set_stock(r.system_modelo, r.system_cesta, r.system_fiada, v_q);
      IF v_d <> 0 THEN
        PERFORM private.inv_move(CASE WHEN v_d > 0 THEN 'entrada' ELSE 'saida' END, r.system_modelo,
          r.system_cesta, r.system_fiada, r.system_cesta, r.system_fiada, abs(v_d), v_user, v_note);
        v_moves := v_moves + 1;
      END IF;

    ELSE
      -- Noutro sítio: sai da posição do sistema e fica onde foi encontrado.
      v_cur := private.inv_get_stock(r.system_modelo, r.system_cesta, r.system_fiada);
      v_dst := private.inv_get_stock(r.real_modelo, r.real_cesta, r.real_fiada);
      PERFORM private.inv_set_stock(r.system_modelo, r.system_cesta, r.system_fiada, 0);
      PERFORM private.inv_set_stock(r.real_modelo, r.real_cesta, r.real_fiada, v_dst + v_q);
      IF v_same_model THEN
        IF v_cur > 0 THEN
          PERFORM private.inv_move('transferencia', r.system_modelo, r.system_cesta, r.system_fiada,
            r.real_cesta, r.real_fiada, v_cur, v_user, v_note);
          v_moves := v_moves + 1;
        END IF;
        v_d := v_q - v_cur;
        IF v_d <> 0 THEN
          PERFORM private.inv_move(CASE WHEN v_d > 0 THEN 'entrada' ELSE 'saida' END, r.real_modelo,
            r.real_cesta, r.real_fiada, r.real_cesta, r.real_fiada, abs(v_d), v_user, v_note);
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

-- ── Começar inventário novo (só Admin) ────────────────────────────────
-- O inventário aberto fica arquivado, com todas as linhas, e a lista nova é
-- criada a partir do stock atual.
CREATE OR REPLACE FUNCTION public.inventory_start_new()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
  v_user text := coalesce(auth.jwt() -> 'user_metadata' ->> 'username', 'Admin');
  v_inv uuid;
  v_rows int;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Só o Admin pode começar um inventário novo.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.inventory_rpc', 'on', true);

  UPDATE public.inventories SET closed_at = now(), closed_by = v_user WHERE closed_at IS NULL;
  INSERT INTO public.inventories (started_by) VALUES (v_user) RETURNING id INTO v_inv;

  INSERT INTO public.inventory_audit
    (inventory_id, stock_item_id, system_modelo, system_cesta, system_fiada, system_qty,
     real_modelo, real_cesta, real_fiada, real_qty)
  SELECT v_inv, id, modelo, cesta, coalesce(fiada, ''), quantidade,
         modelo, cesta, coalesce(fiada, ''), ''
  FROM public.stock_items;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('inventory_id', v_inv, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_apply(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventory_start_new() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_apply(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_start_new() TO authenticated;
REVOKE ALL ON FUNCTION public.inventory_audit_guard() FROM PUBLIC, anon, authenticated;
