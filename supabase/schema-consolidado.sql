-- =====================================================================
-- SCHEMA — Gestão de Acessórios MTG1_Exp
--
-- Estado final das 9 migrações do projeto original (cjqnidiydxpjxdgfphit),
-- consolidado num só ficheiro.
--
-- Correr no SQL Editor do projeto DO PICKING (cpoghfbbawubcmdtmpfj),
-- antes de 02-dados.sql.
--
-- NÃO MEXE NO PICKING. Verificado contra o projeto a 2026-09-24: nenhuma
-- destas tabelas lá existe, e as permissões e políticas abaixo referem-se
-- só a elas. As tabelas plans e plan_items ficam exatamente como estão.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── Função de apoio: manter updated_at ────────────────────────────────
-- CREATE OR REPLACE: se o projeto do picking já tiver uma função com este
-- nome, fica substituída. Verifiquei que não tem — nenhuma tabela dele usa
-- updated_at. Se entretanto criares uma, confirma antes de correr isto.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ── Perfis ────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'inventory', 'operator');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── app_users: PINs da aplicação (só o service_role lhe toca) ─────────
CREATE TABLE IF NOT EXISTS public.app_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── stock_items: estado atual (modelo x cesta x fiada -> quantidade) ──
CREATE TABLE IF NOT EXISTS public.stock_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cod_sap    TEXT,
  modelo     TEXT NOT NULL,
  cesta      TEXT NOT NULL,
  fiada      TEXT,
  quantidade INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── movements: histórico ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          TEXT NOT NULL CHECK (tipo IN ('entrada','saida','transferencia','estorno')),
  modelo        TEXT NOT NULL,
  cod_sap       TEXT,
  cesta_origem  TEXT,
  fiada_origem  TEXT,
  cesta_destino TEXT,
  fiada_destino TEXT,
  quantidade    INTEGER NOT NULL,
  utilizador    TEXT NOT NULL,
  notas         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── model_sap_lookup: modelo -> código SAP ────────────────────────────
CREATE TABLE IF NOT EXISTS public.model_sap_lookup (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo  TEXT NOT NULL UNIQUE,
  cod_sap TEXT NOT NULL
);

-- ── inventory_audit: contagem física vs sistema ───────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID REFERENCES public.stock_items(id) ON DELETE SET NULL,
  system_modelo TEXT NOT NULL DEFAULT '',
  system_cesta  TEXT NOT NULL DEFAULT '',
  system_fiada  TEXT NOT NULL DEFAULT '',
  system_qty    INTEGER NOT NULL DEFAULT 0,
  real_modelo   TEXT NOT NULL DEFAULT '',
  real_cesta    TEXT NOT NULL DEFAULT '',
  real_fiada    TEXT NOT NULL DEFAULT '',
  real_qty      TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── admin_notifications: avisos de correção de stock ──────────────────
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  message      TEXT NOT NULL,
  movimento_id UUID REFERENCES public.movements(id) ON DELETE CASCADE,
  lida         BOOLEAN NOT NULL DEFAULT false,
  utilizador   TEXT NOT NULL
);

-- ── user_roles: perfil por utilizador do Supabase Auth ────────────────
CREATE TABLE IF NOT EXISTS public.user_roles (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role    public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- ── Triggers de updated_at ────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_stock_items_updated_at ON public.stock_items;
CREATE TRIGGER update_stock_items_updated_at
  BEFORE UPDATE ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_inventory_audit_updated_at ON public.inventory_audit;
CREATE TRIGGER update_inventory_audit_updated_at
  BEFORE UPDATE ON public.inventory_audit
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Verificação de PIN (só o service_role a pode executar) ────────────
CREATE OR REPLACE FUNCTION public.verify_app_user(_username text, _password text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.username
  FROM public.app_users u
  WHERE lower(u.username) = lower(_username)
    AND u.password_hash = extensions.crypt(_password, u.password_hash)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.verify_app_user(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_app_user(text, text) TO service_role;

-- =====================================================================
-- ROW LEVEL SECURITY
--
-- O perfil é lido do JWT (app_metadata.role), que a edge function de
-- login grava ao provisionar o utilizador. A chave anon sozinha não abre
-- nada: sem login não há perfil, e sem perfil nenhuma política passa.
-- =====================================================================

ALTER TABLE public.app_users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_sap_lookup    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_audit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles          ENABLE ROW LEVEL SECURITY;

-- app_users: inacessível a partir do browser, em qualquer circunstância.
REVOKE ALL ON public.app_users FROM anon, authenticated;
GRANT ALL ON public.app_users TO service_role;
DROP POLICY IF EXISTS "Application users are backend only" ON public.app_users;
CREATE POLICY "Application users are backend only" ON public.app_users
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- user_roles
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
DROP POLICY IF EXISTS "Users can read their own roles" ON public.user_roles;
CREATE POLICY "Users can read their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- stock_items
REVOKE ALL ON public.stock_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_items TO authenticated;
GRANT ALL ON public.stock_items TO service_role;
DROP POLICY IF EXISTS "Assigned users can read stock" ON public.stock_items;
DROP POLICY IF EXISTS "Warehouse staff can insert stock" ON public.stock_items;
DROP POLICY IF EXISTS "Warehouse staff can update stock" ON public.stock_items;
DROP POLICY IF EXISTS "Warehouse staff can delete stock" ON public.stock_items;
CREATE POLICY "Assigned users can read stock" ON public.stock_items
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','inventory','operator'));
CREATE POLICY "Warehouse staff can insert stock" ON public.stock_items
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','operator'));
CREATE POLICY "Warehouse staff can update stock" ON public.stock_items
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','operator'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','operator'));
CREATE POLICY "Warehouse staff can delete stock" ON public.stock_items
  FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','operator'));

-- movements
REVOKE ALL ON public.movements FROM anon;
GRANT SELECT, INSERT ON public.movements TO authenticated;
GRANT ALL ON public.movements TO service_role;
DROP POLICY IF EXISTS "Warehouse staff can read movements" ON public.movements;
DROP POLICY IF EXISTS "Warehouse staff can insert movements" ON public.movements;
CREATE POLICY "Warehouse staff can read movements" ON public.movements
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','operator'));
CREATE POLICY "Warehouse staff can insert movements" ON public.movements
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','operator'));

-- model_sap_lookup
REVOKE ALL ON public.model_sap_lookup FROM anon;
GRANT SELECT, INSERT ON public.model_sap_lookup TO authenticated;
GRANT ALL ON public.model_sap_lookup TO service_role;
DROP POLICY IF EXISTS "Assigned users can read lookup" ON public.model_sap_lookup;
DROP POLICY IF EXISTS "Admins can insert lookup" ON public.model_sap_lookup;
CREATE POLICY "Assigned users can read lookup" ON public.model_sap_lookup
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','inventory','operator'));
CREATE POLICY "Admins can insert lookup" ON public.model_sap_lookup
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- inventory_audit
REVOKE ALL ON public.inventory_audit FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_audit TO authenticated;
GRANT ALL ON public.inventory_audit TO service_role;
DROP POLICY IF EXISTS "Inventory roles can read audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Inventory roles can insert audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Inventory roles can update audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Inventory roles can delete audit" ON public.inventory_audit;
CREATE POLICY "Inventory roles can read audit" ON public.inventory_audit
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin'));
CREATE POLICY "Inventory roles can insert audit" ON public.inventory_audit
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin'));
CREATE POLICY "Inventory roles can update audit" ON public.inventory_audit
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin'));
CREATE POLICY "Inventory roles can delete audit" ON public.inventory_audit
  FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory','admin'));

-- admin_notifications
REVOKE ALL ON public.admin_notifications FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;
DROP POLICY IF EXISTS "Admins can read notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Warehouse staff can create notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Admins can update notifications" ON public.admin_notifications;
CREATE POLICY "Admins can read notifications" ON public.admin_notifications
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Warehouse staff can create notifications" ON public.admin_notifications
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','operator'));
CREATE POLICY "Admins can update notifications" ON public.admin_notifications
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Os utilizadores e PINs ficam no 01b-pins.sql, para correres à parte.
