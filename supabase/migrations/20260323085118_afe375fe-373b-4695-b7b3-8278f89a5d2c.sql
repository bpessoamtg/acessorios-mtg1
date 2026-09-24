CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  message text NOT NULL,
  movimento_id uuid REFERENCES public.movements(id) ON DELETE CASCADE,
  lida boolean NOT NULL DEFAULT false,
  utilizador text NOT NULL
);

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read notifications" ON public.admin_notifications FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert notifications" ON public.admin_notifications FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can update notifications" ON public.admin_notifications FOR UPDATE TO public USING (true);