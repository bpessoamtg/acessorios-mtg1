import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { MOVEMENT_TYPES } from '@/lib/constants';
import { getTranslations } from '@/lib/i18n';
import ComboboxField from '@/components/ComboboxField';
import { useModelOptions, useCestaOptions, useFiadaOptions } from '@/hooks/useFieldOptions';
import { useCestaContents } from '@/hooks/useCestaContents';
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

const GENERIC_MODELS = ['CIBR0000G', 'CIDIV000G', 'CITR0000G'];

const getCardColorClass = (tipo: string) => {
  switch (tipo) {
    case 'entrada': return 'bg-success/10 border-success/30';
    case 'saida': return 'bg-destructive/10 border-destructive/30';
    case 'transferencia': return 'bg-primary/10 border-primary/30';
    default: return '';
  }
};

const MovementTab = () => {
  const { user } = useAuth();
  const t = getTranslations(user?.username);
  const [tipo, setTipo] = useState<string>('entrada');
  const [modelo, setModelo] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [cesta, setCesta] = useState('');
  const [fiada, setFiada] = useState('');
  const [cestaDestino, setCestaDestino] = useState('');
  const [fiadaDestino, setFiadaDestino] = useState('');
  const [notas, setNotas] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showOvDialog, setShowOvDialog] = useState(false);
  const [ovValue, setOvValue] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [remainingStock, setRemainingStock] = useState<number>(0);
  const [pendingExtraNote, setPendingExtraNote] = useState<string | undefined>();
  const [showCorrectionDialog, setShowCorrectionDialog] = useState(false);
  const [correctedQty, setCorrectedQty] = useState('');

  const modelOptions = useModelOptions();
  const cestaOptions = useCestaOptions();
  const fiadaOptions = useFiadaOptions();
  const cestaContents = useCestaContents(cesta);

  const isTransfer = tipo === 'transferencia';

  useEffect(() => {
    if (cestaContents.length > 0 && cesta) {
      if (!fiada && cestaContents[0].fiada) {
        setFiada(cestaContents[0].fiada);
      }
      const uniqueModels = [...new Set(cestaContents.map((c) => c.modelo))];
      if (uniqueModels.length === 1 && !modelo) {
        setModelo(uniqueModels[0]);
      }
    }
  }, [cestaContents, cesta]);

  const cestaModels = [...new Set(cestaContents.map((c) => c.modelo))];
  const prioritizedModels = cestaModels.length > 0
    ? [...cestaModels, ...modelOptions.filter((m) => !cestaModels.includes(m))]
    : modelOptions;

  const trySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelo || !quantidade || !cesta || !fiada) {
      toast.error(t.fillRequired);
      return;
    }
    if (isTransfer && (!cestaDestino || !fiadaDestino)) {
      toast.error(t.fillDestination);
      return;
    }
    if (GENERIC_MODELS.includes(modelo)) {
      setOvValue('');
      setShowOvDialog(true);
      return;
    }
    prepareConfirmation();
  };

  const handleOvConfirm = () => {
    if (!/^\d{7}$/.test(ovValue)) {
      toast.error(t.ovMustBe7);
      return;
    }
    setShowOvDialog(false);
    prepareConfirmation(`OV:${ovValue}`);
  };

  const prepareConfirmation = async (extraNote?: string) => {
    const qty = parseInt(quantidade);
    const currentItem = cestaContents.find(
      (c) => c.modelo === modelo && c.fiada === fiada
    );
    const currentQty = currentItem?.quantidade || 0;
    const remaining = tipo === 'entrada' ? currentQty + qty : currentQty - qty;

    setPendingExtraNote(extraNote);
    setRemainingStock(remaining);
    setShowConfirmDialog(true);
  };

  const handleConfirmStock = () => {
    setShowConfirmDialog(false);
    executeSubmit(pendingExtraNote);
  };

  const handleStockMismatch = () => {
    setShowConfirmDialog(false);
    setCorrectedQty('');
    setShowCorrectionDialog(true);
  };

  const handleCorrectionSubmit = async () => {
    const corrected = parseInt(correctedQty);
    if (isNaN(corrected) || corrected < 0) {
      toast.error(t.invalidQuantity);
      return;
    }
    setShowCorrectionDialog(false);
    await executeSubmit(pendingExtraNote, corrected);
  };

  const executeSubmit = async (extraNote?: string, correctedRemaining?: number) => {
    setIsSubmitting(true);
    const qty = parseInt(quantidade);

    try {
      const { data: sapData } = await supabase
        .from('model_sap_lookup')
        .select('cod_sap')
        .eq('modelo', modelo)
        .maybeSingle();

      const codSap = sapData?.cod_sap || null;

      if (tipo === 'entrada') {
        const { data: existing } = await supabase
          .from('stock_items')
          .select('id, quantidade')
          .eq('modelo', modelo)
          .eq('cesta', cesta)
          .eq('fiada', fiada)
          .maybeSingle();

        if (correctedRemaining !== undefined) {
          if (existing) {
            if (correctedRemaining === 0) {
              await supabase.from('stock_items').delete().eq('id', existing.id);
            } else {
              await supabase.from('stock_items').update({ quantidade: correctedRemaining }).eq('id', existing.id);
            }
          } else if (correctedRemaining > 0) {
            await supabase.from('stock_items').insert({ modelo, cod_sap: codSap, cesta, fiada, quantidade: correctedRemaining });
          }
        } else {
          if (existing) {
            await supabase.from('stock_items').update({ quantidade: existing.quantidade + qty }).eq('id', existing.id);
          } else {
            await supabase.from('stock_items').insert({ modelo, cod_sap: codSap, cesta, fiada, quantidade: qty });
          }
        }
      } else if (tipo === 'saida') {
        const { data: existing } = await supabase
          .from('stock_items')
          .select('id, quantidade')
          .eq('modelo', modelo)
          .eq('cesta', cesta)
          .eq('fiada', fiada)
          .maybeSingle();

        if (correctedRemaining !== undefined) {
          if (existing) {
            if (correctedRemaining === 0) {
              await supabase.from('stock_items').delete().eq('id', existing.id);
            } else {
              await supabase.from('stock_items').update({ quantidade: correctedRemaining }).eq('id', existing.id);
            }
          } else if (correctedRemaining > 0) {
            await supabase.from('stock_items').insert({ modelo, cod_sap: codSap, cesta, fiada, quantidade: correctedRemaining });
          }
        } else {
          if (!existing || existing.quantidade < qty) {
            toast.error(t.insufficientStock);
            setIsSubmitting(false);
            return;
          }
          const newQty = existing.quantidade - qty;
          if (newQty === 0) {
            await supabase.from('stock_items').delete().eq('id', existing.id);
          } else {
            await supabase.from('stock_items').update({ quantidade: newQty }).eq('id', existing.id);
          }
        }
      } else {
        const { data: existing } = await supabase
          .from('stock_items')
          .select('id, quantidade')
          .eq('modelo', modelo)
          .eq('cesta', cesta)
          .eq('fiada', fiada)
          .maybeSingle();

        if (correctedRemaining !== undefined) {
          if (existing) {
            if (correctedRemaining === 0) {
              await supabase.from('stock_items').delete().eq('id', existing.id);
            } else {
              await supabase.from('stock_items').update({ quantidade: correctedRemaining }).eq('id', existing.id);
            }
          } else if (correctedRemaining > 0) {
            await supabase.from('stock_items').insert({ modelo, cod_sap: codSap, cesta, fiada, quantidade: correctedRemaining });
          }
        } else {
          if (!existing || existing.quantidade < qty) {
            toast.error(t.insufficientStockOrigin);
            setIsSubmitting(false);
            return;
          }
          const newQty = existing.quantidade - qty;
          if (newQty === 0) {
            await supabase.from('stock_items').delete().eq('id', existing.id);
          } else {
            await supabase.from('stock_items').update({ quantidade: newQty }).eq('id', existing.id);
          }
        }

        const { data: destExisting } = await supabase
          .from('stock_items')
          .select('id, quantidade')
          .eq('modelo', modelo)
          .eq('cesta', cestaDestino)
          .eq('fiada', fiadaDestino)
          .maybeSingle();

        if (destExisting) {
          await supabase.from('stock_items').update({ quantidade: destExisting.quantidade + qty }).eq('id', destExisting.id);
        } else {
          await supabase.from('stock_items').insert({ modelo, cod_sap: codSap, cesta: cestaDestino, fiada: fiadaDestino, quantidade: qty });
        }
      }

      const finalNotas = extraNote
        ? (notas ? `${notas} | ${extraNote}` : extraNote)
        : (notas || null);

      const { data: movData } = await supabase.from('movements').insert({
        tipo, modelo, cod_sap: codSap,
        cesta_origem: cesta, fiada_origem: fiada,
        cesta_destino: isTransfer ? cestaDestino : cesta,
        fiada_destino: isTransfer ? fiadaDestino : fiada,
        quantidade: qty,
        utilizador: user?.username || 'Unknown',
        notas: finalNotas,
      }).select('id').single();

      if (correctedRemaining !== undefined && movData) {
        const currentItem = cestaContents.find(
          (c) => c.modelo === modelo && c.fiada === fiada
        );
        const expectedRemaining = tipo === 'entrada'
          ? (currentItem?.quantidade || 0) + qty
          : (currentItem?.quantidade || 0) - qty;

        await supabase.from('admin_notifications').insert({
          message: `Stock corrigido por ${user?.username}: ${modelo} em ${cesta}/${fiada}. Sistema: ${expectedRemaining} un. → Corrigido: ${correctedRemaining} un. (${tipo})`,
          movimento_id: movData.id,
          utilizador: user?.username || 'Unknown',
        });
      }

      toast.success(
        tipo === 'entrada' ? t.addedUnits(qty, modelo)
          : tipo === 'saida' ? t.removedUnits(qty, modelo)
          : t.transferredUnits(qty, modelo)
      );

      setModelo('');
      setQuantidade('');
      setCesta('');
      setFiada('');
      setCestaDestino('');
      setFiadaDestino('');
      setNotas('');
    } catch (error) {
      toast.error(t.errorRegistering);
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {MOVEMENT_TYPES.map((mt) => (
          <button
            key={mt.value}
            onClick={() => setTipo(mt.value)}
            className={`flex flex-col items-center p-3 rounded-xl border-2 transition-all ${
              tipo === mt.value ? 'border-primary bg-primary/10' : 'border-border bg-card'
            }`}
          >
            <span className="text-xl">{mt.icon}</span>
            <span className="text-xs font-semibold mt-1 text-foreground">
              {mt.value === 'entrada' ? t.entry : mt.value === 'saida' ? t.exit : t.transfer}
            </span>
          </button>
        ))}
      </div>

      <Card className={`border-2 transition-colors ${getCardColorClass(tipo)}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">
            {tipo === 'entrada' ? t.registerEntry : tipo === 'saida' ? t.registerExit : t.registerTransfer}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={trySubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <ComboboxField
                label={isTransfer ? t.cestaOrigin : t.cesta}
                value={cesta}
                onChange={(v) => { setCesta(v); setFiada(''); setModelo(''); }}
                options={cestaOptions}
                placeholder="Cesta..."
              />
              <ComboboxField
                label={isTransfer ? t.fiadaOrigin : t.fiada}
                value={fiada}
                onChange={setFiada}
                options={fiadaOptions}
                placeholder="Fiada..."
              />
            </div>

            {cestaContents.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-2 text-xs text-muted-foreground">
                <span className="font-semibold">{t.inCesta}</span>{' '}
                {cestaContents.map((c) => `${c.modelo} (${c.quantidade}un)`).join(', ')}
              </div>
            )}

            <ComboboxField
              label={t.model}
              value={modelo}
              onChange={setModelo}
              options={prioritizedModels}
              placeholder={t.searchModel}
            />

            <div>
              <Label className="text-foreground">{t.quantity}</Label>
              <Input
                type="number"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="0"
                min="1"
                className="h-12 text-lg font-mono-app"
              />
            </div>

            {isTransfer && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                <ComboboxField
                  label={t.cestaDest}
                  value={cestaDestino}
                  onChange={setCestaDestino}
                  options={cestaOptions}
                  placeholder="Cesta..."
                />
                <ComboboxField
                  label={t.fiadaDest}
                  value={fiadaDestino}
                  onChange={setFiadaDestino}
                  options={fiadaOptions}
                  placeholder="Fiada..."
                />
              </div>
            )}

            <div>
              <Label className="text-foreground">{t.notes}</Label>
              <Input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder={t.notesPlaceholder}
                className="h-12"
              />
            </div>

            <Button type="submit" className="w-full h-14 text-base font-bold" disabled={isSubmitting}>
              {isSubmitting ? t.registering : t.confirmMovement}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* OV Dialog */}
      <AlertDialog open={showOvDialog} onOpenChange={setShowOvDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.genericModelOv}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.ovDescription} {modelo}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={ovValue}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 7);
              setOvValue(v);
            }}
            placeholder="0000000"
            className="h-12 text-lg font-mono tracking-widest text-center"
            maxLength={7}
            inputMode="numeric"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleOvConfirm(); }}>
              {t.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stock Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmStockTitle}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{t.confirmStockBefore} <span className="font-semibold">{modelo}</span> {t.confirmStockIn} <span className="font-semibold">{cesta}/{fiada}</span> {t.confirmStockWillBe}</p>
                <p className="text-2xl font-bold text-center text-foreground py-2">
                  {remainingStock} un.
                </p>
                <p>{t.confirmStockQuestion}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleStockMismatch}>
              {t.noCorrect}
            </AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleConfirmStock(); }}>
              {t.yesConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Correction Dialog */}
      <AlertDialog open={showCorrectionDialog} onOpenChange={setShowCorrectionDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.correctStockTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.correctStockDesc} {cesta}/{fiada} {t.correctStockFor} {modelo}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="number"
            value={correctedQty}
            onChange={(e) => setCorrectedQty(e.target.value)}
            placeholder={t.realQuantity}
            min="0"
            className="h-12 text-lg font-mono-app text-center"
            inputMode="numeric"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleCorrectionSubmit(); }}>
              {t.confirmCorrection}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MovementTab;
