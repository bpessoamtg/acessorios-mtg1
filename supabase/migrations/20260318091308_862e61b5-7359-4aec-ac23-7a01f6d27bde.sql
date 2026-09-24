
-- Create app_users table for simple login
CREATE TABLE public.app_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read app_users" ON public.app_users FOR SELECT USING (true);

-- Insert the 3 users
INSERT INTO public.app_users (username, password) VALUES
  ('Carmona', '1112'),
  ('Deepak', '2222'),
  ('Admin', '1745');

-- Create stock_items table (current state of baskets)
CREATE TABLE public.stock_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cod_sap TEXT,
  modelo TEXT NOT NULL,
  cesta TEXT NOT NULL,
  fiada TEXT,
  quantidade INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read stock" ON public.stock_items FOR SELECT USING (true);
CREATE POLICY "Anyone can insert stock" ON public.stock_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update stock" ON public.stock_items FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete stock" ON public.stock_items FOR DELETE USING (true);

-- Create movements table (history)
CREATE TABLE public.movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida', 'transferencia')),
  modelo TEXT NOT NULL,
  cod_sap TEXT,
  cesta_origem TEXT,
  fiada_origem TEXT,
  cesta_destino TEXT,
  fiada_destino TEXT,
  quantidade INTEGER NOT NULL,
  utilizador TEXT NOT NULL,
  notas TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read movements" ON public.movements FOR SELECT USING (true);
CREATE POLICY "Anyone can insert movements" ON public.movements FOR INSERT WITH CHECK (true);

-- Create model_sap_lookup table for auto cod_sap
CREATE TABLE public.model_sap_lookup (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  modelo TEXT NOT NULL UNIQUE,
  cod_sap TEXT NOT NULL
);

ALTER TABLE public.model_sap_lookup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read lookup" ON public.model_sap_lookup FOR SELECT USING (true);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_stock_items_updated_at
  BEFORE UPDATE ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
