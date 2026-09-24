
CREATE TABLE public.inventory_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stock_item_id UUID REFERENCES public.stock_items(id) ON DELETE SET NULL,
  system_modelo TEXT NOT NULL DEFAULT '',
  system_cesta TEXT NOT NULL DEFAULT '',
  system_fiada TEXT NOT NULL DEFAULT '',
  system_qty INTEGER NOT NULL DEFAULT 0,
  real_modelo TEXT NOT NULL DEFAULT '',
  real_cesta TEXT NOT NULL DEFAULT '',
  real_fiada TEXT NOT NULL DEFAULT '',
  real_qty TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read inventory_audit" ON public.inventory_audit FOR SELECT USING (true);
CREATE POLICY "Anyone can insert inventory_audit" ON public.inventory_audit FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update inventory_audit" ON public.inventory_audit FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete inventory_audit" ON public.inventory_audit FOR DELETE USING (true);

CREATE TRIGGER update_inventory_audit_updated_at
  BEFORE UPDATE ON public.inventory_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
