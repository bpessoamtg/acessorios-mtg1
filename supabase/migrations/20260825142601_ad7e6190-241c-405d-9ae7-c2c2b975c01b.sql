CREATE TYPE public.app_role AS ENUM ('admin', 'inventory', 'operator');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_warehouse_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin'::public.app_role, 'operator'::public.app_role)
  )
$$;

CREATE POLICY "Users can read their own roles"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated can read notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Authenticated can update notifications" ON public.admin_notifications;
CREATE POLICY "Admins can read notifications" ON public.admin_notifications FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Warehouse staff can create notifications" ON public.admin_notifications FOR INSERT TO authenticated WITH CHECK (public.is_warehouse_staff(auth.uid()));
CREATE POLICY "Admins can update notifications" ON public.admin_notifications FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can read inventory_audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Authenticated can insert inventory_audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Authenticated can update inventory_audit" ON public.inventory_audit;
DROP POLICY IF EXISTS "Authenticated can delete inventory_audit" ON public.inventory_audit;
CREATE POLICY "Inventory roles can read audit" ON public.inventory_audit FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Inventory roles can insert audit" ON public.inventory_audit FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Inventory roles can update audit" ON public.inventory_audit FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Inventory roles can delete audit" ON public.inventory_audit FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can read lookup" ON public.model_sap_lookup;
DROP POLICY IF EXISTS "Authenticated can insert lookup" ON public.model_sap_lookup;
CREATE POLICY "Assigned users can read lookup" ON public.model_sap_lookup FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid()));
CREATE POLICY "Admins can insert lookup" ON public.model_sap_lookup FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can read movements" ON public.movements;
DROP POLICY IF EXISTS "Authenticated can insert movements" ON public.movements;
CREATE POLICY "Warehouse staff can read movements" ON public.movements FOR SELECT TO authenticated USING (public.is_warehouse_staff(auth.uid()));
CREATE POLICY "Warehouse staff can insert movements" ON public.movements FOR INSERT TO authenticated WITH CHECK (public.is_warehouse_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read stock" ON public.stock_items;
DROP POLICY IF EXISTS "Authenticated can insert stock" ON public.stock_items;
DROP POLICY IF EXISTS "Authenticated can update stock" ON public.stock_items;
DROP POLICY IF EXISTS "Authenticated can delete stock" ON public.stock_items;
CREATE POLICY "Assigned users can read stock" ON public.stock_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid()));
CREATE POLICY "Warehouse staff can insert stock" ON public.stock_items FOR INSERT TO authenticated WITH CHECK (public.is_warehouse_staff(auth.uid()));
CREATE POLICY "Warehouse staff can update stock" ON public.stock_items FOR UPDATE TO authenticated USING (public.is_warehouse_staff(auth.uid())) WITH CHECK (public.is_warehouse_staff(auth.uid()));
CREATE POLICY "Warehouse staff can delete stock" ON public.stock_items FOR DELETE TO authenticated USING (public.is_warehouse_staff(auth.uid()));

REVOKE ALL ON public.app_users FROM anon, authenticated;
DROP POLICY IF EXISTS "Application users are backend only" ON public.app_users;
CREATE POLICY "Application users are backend only" ON public.app_users FOR ALL TO authenticated USING (false) WITH CHECK (false);