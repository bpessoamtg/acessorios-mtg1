ALTER TABLE public.movements DROP CONSTRAINT movements_tipo_check;
ALTER TABLE public.movements ADD CONSTRAINT movements_tipo_check CHECK (tipo IN ('entrada', 'saida', 'transferencia', 'estorno'));