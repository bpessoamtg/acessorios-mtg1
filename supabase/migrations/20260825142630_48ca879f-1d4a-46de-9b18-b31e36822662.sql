DROP POLICY IF EXISTS "Admins can read notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Warehouse staff can create notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Admins can update notifications" ON public.admin_notifications;
CREATE POLICY "Admins can read notifications" ON public.admin_notifications FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Warehouse staff can create notifications" ON public.admin_notifications FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'operator'));
CREATE POLICY "Admins can update notifications" ON public.admin_notifications FOR UPDATE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Inventory roles can read audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Inventory roles can insert audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Inventory roles can update audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Inventory roles can delete audit" ON public.inventory_audit;
CREATE POLICY "Inventory roles can read audit" ON public.inventory_audit FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory', 'admin'));
CREATE POLICY "Inventory roles can insert audit" ON public.inventory_audit FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory', 'admin'));
CREATE POLICY "Inventory roles can update audit" ON public.inventory_audit FOR UPDATE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory', 'admin')) WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory', 'admin'));
CREATE POLICY "Inventory roles can delete audit" ON public.inventory_audit FOR DELETE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('inventory', 'admin'));

DROP POLICY IF EXISTS "Assigned users can read lookup" ON public.model_sap_lookup;
DROP POLICY IF EXISTS "Admins can insert lookup" ON public.model_sap_lookup;
CREATE POLICY "Assigned users can read lookup" ON public.model_sap_lookup FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'inventory', 'operator'));
CREATE POLICY "Admins can insert lookup" ON public.model_sap_lookup FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Warehouse staff can read movements" ON public.movements;
DROP POLICY IF EXISTS "Warehouse staff can insert movements" ON public.movements;
CREATE POLICY "Warehouse staff can read movements" ON public.movements FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'operator'));
CREATE POLICY "Warehouse staff can insert movements" ON public.movements FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'operator'));

DROP POLICY IF EXISTS "Assigned users can read stock" ON public.stock_items;
DROP POLICY IF EXISTS "Warehouse staff can insert stock" ON public.stock_items;
DROP POLICY IF EXISTS "Warehouse staff can update stock" ON public.stock_items;
DROP POLICY IF EXISTS "Warehouse staff can delete stock" ON public.stock_items;
CREATE POLICY "Assigned users can read stock" ON public.stock_items FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'inventory', 'operator'));
CREATE POLICY "Warehouse staff can insert stock" ON public.stock_items FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'operator'));
CREATE POLICY "Warehouse staff can update stock" ON public.stock_items FOR UPDATE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'operator')) WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'operator'));
CREATE POLICY "Warehouse staff can delete stock" ON public.stock_items FOR DELETE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'operator'));

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_warehouse_staff(uuid) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.has_role(uuid, public.app_role);
DROP FUNCTION public.is_warehouse_staff(uuid);