import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Search, MapPin, Loader2, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { getTranslations } from '@/lib/i18n';

const SearchTab = () => {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editFiada, setEditFiada] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.username === 'Admin';
  const t = getTranslations(user?.username);

  const [ovMatches, setOvMatches] = useState<Record<string, string[]>>({});

  const { data: results, isLoading } = useQuery({
    queryKey: ['search-stock', search],
    queryFn: async () => {
      if (!search || search.length < 2) return [];

      const { data: stockData, error: stockError } = await supabase
        .from('stock_items')
        .select('*')
        .or(`modelo.ilike.%${search}%,cesta.ilike.%${search}%,fiada.ilike.%${search}%,cod_sap.ilike.%${search}%`)
        .order('modelo')
        .limit(50);
      if (stockError) throw stockError;

      const { data: movData } = await supabase
        .from('movements')
        .select('modelo, cesta_destino, cesta_origem, fiada_destino, fiada_origem, notas, tipo')
        .ilike('notas', `%OV:${search}%`)
        .limit(50);

      const ovMap: Record<string, string[]> = {};
      if (movData && movData.length > 0) {
        for (const mov of movData) {
          const ovMatch = mov.notas?.match(/OV:(\d{7})/);
          const ovLabel = ovMatch ? ovMatch[0] : '';
          const cesta = mov.cesta_destino || mov.cesta_origem || '';
          const fiada = mov.fiada_destino || mov.fiada_origem || '';
          const key = `${mov.modelo}|${cesta}|${fiada}`;
          if (!ovMap[key]) ovMap[key] = [];
          if (ovLabel && !ovMap[key].includes(ovLabel)) ovMap[key].push(ovLabel);
        }
        setOvMatches(ovMap);

        const ovModels = [...new Set(movData.map((m) => m.modelo))];
        const alreadyFound = new Set((stockData || []).map((s) => s.modelo));
        const missing = ovModels.filter((m) => !alreadyFound.has(m));
        if (missing.length > 0) {
          const { data: extraStock } = await supabase
            .from('stock_items')
            .select('*')
            .in('modelo', missing)
            .order('modelo')
            .limit(50);
          if (extraStock) return [...(stockData || []), ...extraStock];
        }
      } else {
        setOvMatches({});
      }

      return stockData || [];
    },
    enabled: search.length >= 2,
  });

  const grouped = (results || []).reduce((acc, item) => {
    if (!acc[item.modelo]) acc[item.modelo] = [];
    acc[item.modelo].push(item);
    return acc;
  }, {} as Record<string, typeof results>);

  const handleSave = async (itemId: string) => {
    const qty = parseInt(editQty);
    if (isNaN(qty) || qty < 0) {
      toast.error(t.invalidQty);
      return;
    }
    setIsSaving(true);
    try {
      if (qty === 0) {
        await supabase.from('stock_items').delete().eq('id', itemId);
      } else {
        await supabase.from('stock_items').update({ quantidade: qty, fiada: editFiada || null }).eq('id', itemId);
      }
      toast.success(t.updatedSuccess);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['search-stock'] });
    } catch {
      toast.error(t.updateError);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="h-12 pl-10 text-base"
        />
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      )}

      {search.length >= 2 && !isLoading && Object.keys(grouped).length === 0 && (
        <p className="text-center text-muted-foreground text-sm py-8">{t.noResults}</p>
      )}

      {Object.entries(grouped).map(([modelo, items]) => {
        const totalQty = items!.reduce((sum, i) => sum + i.quantidade, 0);
        return (
          <Card key={modelo} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-bold text-sm text-foreground font-mono-app">{modelo}</h3>
                {items?.[0]?.cod_sap && (
                  <p className="text-xs text-muted-foreground">{items[0].cod_sap}</p>
                )}
              </div>
              <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded-full">
                Total: {totalQty} un.
              </span>
            </div>
            {items?.map((item) => (
              <div key={item.id} className="flex items-center gap-2 py-1.5 border-t border-border/50">
                <MapPin className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="text-sm text-foreground">
                  Cesta <span className="font-mono-app font-semibold">{item.cesta}</span>
                  {' · '}
                  Fiada <span className="font-mono-app font-semibold">{item.fiada || '?'}</span>
                </span>
                {(() => {
                  const key = `${item.modelo}|${item.cesta}|${item.fiada || ''}`;
                  const ovs = ovMatches[key];
                  return ovs && ovs.length > 0 ? (
                    <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-mono-app">
                      {ovs.join(', ')}
                    </span>
                  ) : null;
                })()}
                {editingId === item.id ? (
                  <div className="ml-auto flex items-center gap-1">
                    <Input
                      value={editFiada}
                      onChange={(e) => setEditFiada(e.target.value)}
                      placeholder="Fiada"
                      className="h-7 w-14 text-sm font-mono-app"
                    />
                    <Input
                      type="number"
                      value={editQty}
                      onChange={(e) => setEditQty(e.target.value)}
                      className="h-7 w-16 text-sm font-mono-app text-right"
                      min="0"
                    />
                    <button
                      onClick={() => handleSave(item.id)}
                      disabled={isSaving}
                      className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="ml-auto flex items-center gap-1">
                    <span className="text-sm font-bold text-foreground">{item.quantidade} un.</span>
                    {isAdmin && (
                      <button
                        onClick={() => { setEditingId(item.id); setEditQty(String(item.quantidade)); setEditFiada(item.fiada || ''); }}
                        className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </Card>
        );
      })}
    </div>
  );
};

export default SearchTab;
