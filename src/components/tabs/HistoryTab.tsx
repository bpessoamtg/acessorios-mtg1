import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { pt as ptLocale } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';
import { Loader2, Download, Undo2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { getTranslations } from '@/lib/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const HistoryTab = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [estornoTarget, setEstornoTarget] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filter, setFilter] = useState('');
  const isAdmin = user?.username === 'Admin';
  const t = getTranslations(user?.username);
  const isDeepak = user?.username === 'Deepak';
  const dateLocale = isDeepak ? enUS : ptLocale;

  const { data: movements, isLoading } = useQuery({
    queryKey: ['movements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    refetchInterval: 5000,
  });

  const filteredMovements = movements?.filter((m) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      m.modelo.toLowerCase().includes(q) ||
      (m.cesta_origem && m.cesta_origem.toLowerCase().includes(q)) ||
      (m.cesta_destino && m.cesta_destino.toLowerCase().includes(q))
    );
  });

  const getTypeInfo = (tipo: string) => {
    switch (tipo) {
      case 'entrada': return { emoji: '📥', label: t.entry, colorClass: 'bg-success/10 border-success/30' };
      case 'saida': return { emoji: '📤', label: t.exit, colorClass: 'bg-destructive/10 border-destructive/30' };
      case 'transferencia': return { emoji: '🔄', label: t.transfer, colorClass: 'bg-primary/10 border-primary/30' };
      case 'estorno': return { emoji: '↩️', label: t.reversal, colorClass: 'bg-warning/10 border-warning/30' };
      default: return { emoji: '❓', label: tipo, colorClass: 'bg-muted' };
    }
  };

  const handleEstorno = async () => {
    if (!estornoTarget) return;
    setIsProcessing(true);
    const m = estornoTarget;

    try {
      if (m.tipo === 'entrada') {
        const { data: existing } = await supabase
          .from('stock_items')
          .select('id, quantidade')
          .eq('modelo', m.modelo)
          .eq('cesta', m.cesta_origem)
          .eq('fiada', m.fiada_origem)
          .maybeSingle();

        if (existing) {
          const newQty = existing.quantidade - m.quantidade;
          if (newQty <= 0) {
            await supabase.from('stock_items').delete().eq('id', existing.id);
          } else {
            await supabase.from('stock_items').update({ quantidade: newQty }).eq('id', existing.id);
          }
        }
      } else if (m.tipo === 'saida') {
        const { data: existing } = await supabase
          .from('stock_items')
          .select('id, quantidade')
          .eq('modelo', m.modelo)
          .eq('cesta', m.cesta_origem)
          .eq('fiada', m.fiada_origem)
          .maybeSingle();

        if (existing) {
          await supabase.from('stock_items').update({ quantidade: existing.quantidade + m.quantidade }).eq('id', existing.id);
        } else {
          await supabase.from('stock_items').insert({
            modelo: m.modelo, cod_sap: m.cod_sap,
            cesta: m.cesta_origem, fiada: m.fiada_origem,
            quantidade: m.quantidade,
          });
        }
      } else if (m.tipo === 'transferencia') {
        const { data: destItem } = await supabase
          .from('stock_items')
          .select('id, quantidade')
          .eq('modelo', m.modelo)
          .eq('cesta', m.cesta_destino)
          .eq('fiada', m.fiada_destino)
          .maybeSingle();

        if (destItem) {
          const newQty = destItem.quantidade - m.quantidade;
          if (newQty <= 0) {
            await supabase.from('stock_items').delete().eq('id', destItem.id);
          } else {
            await supabase.from('stock_items').update({ quantidade: newQty }).eq('id', destItem.id);
          }
        }

        const { data: origItem } = await supabase
          .from('stock_items')
          .select('id, quantidade')
          .eq('modelo', m.modelo)
          .eq('cesta', m.cesta_origem)
          .eq('fiada', m.fiada_origem)
          .maybeSingle();

        if (origItem) {
          await supabase.from('stock_items').update({ quantidade: origItem.quantidade + m.quantidade }).eq('id', origItem.id);
        } else {
          await supabase.from('stock_items').insert({
            modelo: m.modelo, cod_sap: m.cod_sap,
            cesta: m.cesta_origem, fiada: m.fiada_origem,
            quantidade: m.quantidade,
          });
        }
      }

      const { error: insertError } = await supabase.from('movements').insert({
        tipo: 'estorno',
        modelo: m.modelo,
        cod_sap: m.cod_sap,
        cesta_origem: m.cesta_origem,
        fiada_origem: m.fiada_origem,
        cesta_destino: m.cesta_destino,
        fiada_destino: m.fiada_destino,
        quantidade: m.quantidade,
        utilizador: user?.username || 'Unknown',
        notas: `Estorno de ${m.tipo} (${format(new Date(m.created_at), 'dd/MM HH:mm')})`,
      });

      if (insertError) {
        console.error('Insert error:', insertError);
        throw insertError;
      }

      queryClient.invalidateQueries({ queryKey: ['movements'] });
      queryClient.invalidateQueries({ queryKey: ['stock-overview'] });
      toast.success(t.reversalSuccess);
    } catch (error) {
      console.error(error);
      toast.error(t.reversalError);
    } finally {
      setIsProcessing(false);
      setEstornoTarget(null);
    }
  };

  const handleExport = () => {
    if (!movements?.length) return;
    const exportData = movements.map((m) => ({
      Data: format(new Date(m.created_at), 'dd/MM/yyyy HH:mm', { locale: dateLocale }),
      Tipo: m.tipo,
      Modelo: m.modelo,
      'Cod SAP': m.cod_sap || '',
      Quantidade: m.quantidade,
      'Cesta Origem': m.cesta_origem || '',
      'Fiada Origem': m.fiada_origem || '',
      'Cesta Destino': m.cesta_destino || '',
      'Fiada Destino': m.fiada_destino || '',
      Utilizador: m.utilizador,
      Notas: m.notas || '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'History');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `history_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(t.exportDone);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{t.movementHistory}</h2>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="w-4 h-4" /> {t.exportBtn}
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={isDeepak ? 'Filter by model or cesta...' : 'Filtrar por modelo ou cesta...'}
          className="h-10 pl-10"
        />
      </div>

      {!filteredMovements?.length && (
        <p className="text-muted-foreground text-sm text-center py-8">{t.noMovements}</p>
      )}

      {filteredMovements?.map((m) => {
        const info = getTypeInfo(m.tipo);
        const canEstorno = m.tipo !== 'estorno';
        return (
          <Card key={m.id} className={`p-3 border ${info.colorClass}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span>{info.emoji}</span>
                  <span className="font-semibold text-sm text-foreground">{info.label}</span>
                  <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground font-medium">{m.quantidade} un.</span>
                </div>
                <p className="text-sm font-medium text-foreground mt-1 font-mono-app">{m.modelo}</p>
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  {m.tipo === 'transferencia' ? (
                    <>
                      <p>{t.from} Cesta {m.cesta_origem} / Fiada {m.fiada_origem}</p>
                      <p>{t.to} Cesta {m.cesta_destino} / Fiada {m.fiada_destino}</p>
                    </>
                  ) : (
                    <p>Cesta {m.cesta_origem} / Fiada {m.fiada_origem}</p>
                  )}
                </div>
                {m.notas && <p className="text-xs text-muted-foreground mt-1 italic">{m.notas}</p>}
              </div>
              <div className="text-right shrink-0 ml-2 flex flex-col items-end gap-1">
                <p className="text-xs text-muted-foreground">
                  {format(new Date(m.created_at), 'dd/MM HH:mm', { locale: dateLocale })}
                </p>
                <p className="text-xs text-muted-foreground font-medium">{m.utilizador}</p>
                {canEstorno && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                    onClick={() => setEstornoTarget(m)}
                  >
                    <Undo2 className="w-3.5 h-3.5" /> {t.reversal}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}

      <AlertDialog open={!!estornoTarget} onOpenChange={(open) => !open && setEstornoTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmReversal}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.reversalQuestion}{' '}
              <strong>{estornoTarget?.tipo}</strong> {t.of}{' '}
              <strong>{estornoTarget?.quantidade} un.</strong> {t.of}{' '}
              <strong>{estornoTarget?.modelo}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleEstorno(); }} disabled={isProcessing} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isProcessing ? t.processing : t.confirmReversal}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default HistoryTab;
