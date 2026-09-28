import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { normalizeCesta, normalizeFiada, normalizeModelo } from '@/lib/inventory';
import { InvStrings } from '@/lib/inventoryI18n';
import AutocompleteInput from './AutocompleteInput';

interface FoundItemSheetProps {
  open: boolean;
  fiada: string;
  t: InvStrings;
  models: string[];
  sap: Record<string, string>;
  cestaOptions: string[];
  fiadaOptions: string[];
  onClose: () => void;
  onSave: (item: { modelo: string; cesta: string; fiada: string; qty: number }) => void;
}

type Errors = { modelo?: string; cesta?: string; qty?: string };

const FoundItemSheet = ({ open, fiada, t, models, sap, cestaOptions, fiadaOptions, onClose, onSave }: FoundItemSheetProps) => {
  const [modelo, setModelo] = useState('');
  const [cesta, setCesta] = useState('');
  const [fiadaVal, setFiadaVal] = useState(fiada);
  const [qty, setQty] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (open) {
      setModelo('');
      setCesta('');
      setFiadaVal(fiada);
      setQty('');
      setErrors({});
    }
  }, [open, fiada]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const m = normalizeModelo(modelo);
    const c = normalizeCesta(cesta);
    const next: Errors = {};
    if (!m) next.modelo = t.errModel;
    if (!c) next.cesta = t.errCesta;
    if (!/^\d+$/.test(qty.trim())) next.qty = t.errQty;
    setErrors(next);
    if (Object.keys(next).length) return;
    onSave({ modelo: m, cesta: c, fiada: normalizeFiada(fiadaVal), qty: Number(qty) });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <SheetHeader className="text-left">
          <SheetTitle>
            {t.foundTitle}
            {fiada && <span className="font-mono-app"> · {fiada}</span>}
          </SheetTitle>
          <SheetDescription>{t.foundSub}</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="grid gap-3 mt-4" noValidate>
          <div className="grid gap-1">
            <AutocompleteInput
              id="found-modelo"
              label={t.modelo}
              value={modelo}
              onChange={(v) => {
                setModelo(v);
                setErrors((e) => ({ ...e, modelo: undefined }));
              }}
              options={models}
              hintFor={(m) => sap[m]}
              newLabel={t.useNew}
              normalize={normalizeModelo}
              error={errors.modelo}
              autoFocus
            />
            {!errors.modelo && <p className="text-sm text-muted-foreground">{t.modelHint}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <AutocompleteInput
              id="found-cesta"
              label={t.cesta}
              value={cesta}
              onChange={(v) => {
                setCesta(v);
                setErrors((e) => ({ ...e, cesta: undefined }));
              }}
              options={cestaOptions}
              normalize={normalizeCesta}
              error={errors.cesta}
            />
            <AutocompleteInput
              id="found-fiada"
              label={t.fiada}
              value={fiadaVal}
              onChange={setFiadaVal}
              options={fiadaOptions}
              normalize={normalizeFiada}
            />
          </div>
          <div className="grid gap-1">
            <label htmlFor="found-qty" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t.quantity}
            </label>
            <Input
              id="found-qty"
              type="number"
              inputMode="numeric"
              min={0}
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                setErrors((er) => ({ ...er, qty: undefined }));
              }}
              aria-invalid={!!errors.qty}
              className="h-11 text-lg tabular-nums"
            />
            {errors.qty && <p className="text-sm text-destructive">{errors.qty}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="outline" className="h-11 font-semibold hover:bg-muted hover:text-foreground" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" className="h-11 font-semibold">
              {t.save}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default FoundItemSheet;
