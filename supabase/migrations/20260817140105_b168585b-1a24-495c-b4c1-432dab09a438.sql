-- Password hashing support
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. app_users: hash passwords, lock table down completely (service role only)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS password_hash text;
UPDATE public.app_users SET password_hash = extensions.crypt(password, extensions.gen_salt('bf', 10)) WHERE password_hash IS NULL;
ALTER TABLE public.app_users DROP COLUMN IF EXISTS password;
ALTER TABLE public.app_users ALTER COLUMN password_hash SET NOT NULL;

DROP POLICY IF EXISTS "Anyone can read app_users" ON public.app_users;
REVOKE ALL ON public.app_users FROM anon, authenticated;
GRANT ALL ON public.app_users TO service_role;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- 2. stock_items
DROP POLICY IF EXISTS "Anyone can read stock" ON public.stock_items;
DROP POLICY IF EXISTS "Anyone can insert stock" ON public.stock_items;
DROP POLICY IF EXISTS "Anyone can update stock" ON public.stock_items;
DROP POLICY IF EXISTS "Anyone can delete stock" ON public.stock_items;
REVOKE ALL ON public.stock_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_items TO authenticated;
GRANT ALL ON public.stock_items TO service_role;
CREATE POLICY "Authenticated can read stock" ON public.stock_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert stock" ON public.stock_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update stock" ON public.stock_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete stock" ON public.stock_items FOR DELETE TO authenticated USING (true);

-- 3. movements
DROP POLICY IF EXISTS "Anyone can read movements" ON public.movements;
DROP POLICY IF EXISTS "Anyone can insert movements" ON public.movements;
REVOKE ALL ON public.movements FROM anon;
GRANT SELECT, INSERT ON public.movements TO authenticated;
GRANT ALL ON public.movements TO service_role;
CREATE POLICY "Authenticated can read movements" ON public.movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert movements" ON public.movements FOR INSERT TO authenticated WITH CHECK (true);

-- 4. inventory_audit
DROP POLICY IF EXISTS "Anyone can read inventory_audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Anyone can insert inventory_audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Anyone can update inventory_audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Anyone can delete inventory_audit" ON public.inventory_audit;
REVOKE ALL ON public.inventory_audit FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_audit TO authenticated;
GRANT ALL ON public.inventory_audit TO service_role;
CREATE POLICY "Authenticated can read inventory_audit" ON public.inventory_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert inventory_audit" ON public.inventory_audit FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update inventory_audit" ON public.inventory_audit FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete inventory_audit" ON public.inventory_audit FOR DELETE TO authenticated USING (true);

-- 5. model_sap_lookup
DROP POLICY IF EXISTS "Anyone can read lookup" ON public.model_sap_lookup;
DROP POLICY IF EXISTS "Anyone can insert lookup" ON public.model_sap_lookup;
REVOKE ALL ON public.model_sap_lookup FROM anon;
GRANT SELECT, INSERT ON public.model_sap_lookup TO authenticated;
GRANT ALL ON public.model_sap_lookup TO service_role;
CREATE POLICY "Authenticated can read lookup" ON public.model_sap_lookup FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert lookup" ON public.model_sap_lookup FOR INSERT TO authenticated WITH CHECK (true);

-- 6. admin_notifications
DROP POLICY IF EXISTS "Anyone can read notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Anyone can update notifications" ON public.admin_notifications;
REVOKE ALL ON public.admin_notifications FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;
CREATE POLICY "Authenticated can read notifications" ON public.admin_notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert notifications" ON public.admin_notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update notifications" ON public.admin_notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);