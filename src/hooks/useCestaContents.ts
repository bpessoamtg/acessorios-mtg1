import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const useCestaContents = (cesta: string) => {
  const { data } = useQuery({
    queryKey: ['cesta-contents', cesta],
    queryFn: async () => {
      if (!cesta) return [];
      const { data, error } = await supabase
        .from('stock_items')
        .select('modelo, fiada, quantidade, cod_sap')
        .eq('cesta', cesta);
      if (error) throw error;
      return data || [];
    },
    enabled: !!cesta,
  });
  return data || [];
};
