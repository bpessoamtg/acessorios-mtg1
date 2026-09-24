import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CESTAS, FIADAS } from '@/lib/constants';

export const useModelOptions = () => {
  const { data } = useQuery({
    queryKey: ['model-options'],
    queryFn: async () => {
      const { data } = await supabase
        .from('model_sap_lookup')
        .select('modelo')
        .order('modelo');
      return data?.map((d) => d.modelo) || [];
    },
  });
  return data || [];
};

export const useCestaOptions = () => CESTAS;
export const useFiadaOptions = () => FIADAS;
