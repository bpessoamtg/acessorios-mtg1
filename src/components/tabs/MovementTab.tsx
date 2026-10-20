import { useState, useEffect, useRef } from 'react';
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
import { isSameLocation, wholeCestaQuantity } from '@/lib/transfer';
import { gravarMovimento, totalNaCesta } from '@/lib/movimentos';
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

  // Moving a whole cesta to another fiada is the usual transfer, so quantity
  // and destination cesta come pre-filled. They stop following the origin as
  // soon as the operator edits them.
  const qtyEdited = useRef(false);
  const destEdited = useRef(false);

  // Um número por movimento. Se a resposta se perder na rede e o operador
  // voltar a confirmar o mesmo movimento, a base de dados reconhece-o e não o
  // grava duas vezes. Muda quando muda algum campo.
  const pedido = useRef<{ chave: string; id: string } | null>(null);

  useEffect(() => {
    if (!isTransfer || !cesta) return;
    if (!destEdited.current) setCestaDestino(cesta);
    if (!qtyEdited.current) {
      const qty = wholeCestaQuantity(cestaContents, modelo, fiada);
      setQuantidade(qty === null ? '' : String(qty));
    }
  }, [isTransfer, cesta, modelo, fiada, cestaContents]);

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
    if (isTransfer && isSameLocation({ cesta, fiada }, { cesta: cestaDestino, fiada: fiadaDestino })) {
      toast.error(t.sameLocation);
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
    const chave = JSON.stringify([tipo, modelo, quantidade, cesta, fiada, cestaDestino, fiadaDestino, extraNote || '']);
    if (!pedido.current || pedido.current.chave !== chave) pedido.current = { chave, id: crypto.randomUUID() };
    const currentQty = totalNaCesta(cestaContents, modelo, fiada);
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
    if (isSubmitting || !pedido.current) return;
    setIsSubmitting(true);
    const qty = parseInt(quantidade);

    try {
      const finalNotas = extraNote
        ? (notas ? `${notas} | ${extraNote}` : extraNote)
        : (notas || null);

      // Tudo numa só gravação: ou fica tudo gravado ou nada, e só então se diz
      // ao operador que ficou registado
      const r = await gravarMovimento(pedido.current.id, {
        tipo, modelo, cesta, fiada, quantidade: qty,
        cestaDestino: isTransfer ? cestaDestino : undefined,
        fiadaDestino: isTransfer ? fiadaDestino : undefined,
        notas: finalNotas,
        corrigido: correctedRemaining,
      });
      if (!r.ok) {
        // O formulário fica preenchido para tentar outra vez
        console.error(r.error);
        toast.error(
          r.erro === 'sem_rede' ? t.notSavedNoNetwork
            : r.erro === 'stock_insuficiente' ? (isTransfer ? t.insufficientStockOrigin : t.insufficientStock)
            : r.erro === 'sem_permissao' ? t.sessionExpired
            : t.errorRegistering,
          { duration: 6000 }
        );
        return;
      }
      pedido.current = null;

      toast.success(
        tipo === 'entrada' ? t.addedUnits(qty, modelo)
          : tipo === 'saida' ? t.removedUnits(qty, modelo)
          : t.transferredUnits(qty, modelo)
      );

      setModelo('');
      qtyEdited.current = false;
      destEdited.current = false;
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
                onChange={(v) => { qtyEdited.current = false; setCesta(v); setFiada(''); setModelo(''); }}
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
                onChange={(e) => { qtyEdited.current = true; setQuantidade(e.target.value); }}
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
                  onChange={(v) => { destEdited.current = true; setCestaDestino(v); }}
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
