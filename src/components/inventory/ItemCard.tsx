import { useState } from 'react';
import { AlertTriangle, Check, CloudUpload, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  AuditRow,
  CountPatch,
  countedQty,
  isFound,
  isSpecialCesta,
  isStale,
  kindOf,
  liveQty,
  normalizeCesta,
  normalizeFiada,
  rowCesta,
  rowFiada,
  rowModelo,
} from '@/lib/inventory';
import { InvStrings } from '@/lib/inventoryI18n';
import AutocompleteInput from './AutocompleteInput';

interface ItemCardProps {
  row: AuditRow;
  t: InvStrings;
  operator: string;
  stock: Map<string, number>;
  sap: Record<string, string>;
  showFiada: boolean;
  queued: boolean;
  cestaOptions: string[];
  fiadaOptions: string[];
  onCount: (patch: CountPatch) => void;
  onRedo: () => void;
  onRemove: () => void;
}

const hhmm = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const isWholeNumber = (v: string) => /^\d+$/.test(v.trim());

const pill = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap';
const tone = {
  ok: 'bg-success/10 text-success',
  warn: 'bg-amber-100 text-amber-800',
  bad: 'bg-destructive/10 text-destructive',
  info: 'bg-primary/10 text-primary',
  muted: 'bg-muted text-muted-foreground',
};
const actionBtn = 'h-11 text-sm font-semibold hover:bg-muted hover:text-foreground';

type Editor = { mode: 'qty' | 'where'; qty: string; cesta: string; fiada: string; error?: string } | null;

const ItemCard = ({
  row, t, operator, stock, sap, showFiada, queued, cestaOptions, fiadaOptions, onCount, onRedo, onRemove,
}: ItemCardProps) => {
  const [editor, setEditor] = useState<Editor>(null);
  const kind = kindOf(row);
  const found = isFound(row);
  const cesta = rowCesta(row);
  const modelo = rowModelo(row);
  const special = isSpecialCesta(cesta);
  const stale = !found && isStale(row, stock);

  const base = { real_modelo: row.system_modelo, real_cesta: row.system_cesta, real_fiada: row.system_fiada, counted_by: operator };

  const saveEditor = () => {
    if (!editor) return;
    if (!isWholeNumber(editor.qty)) {
      setEditor({ ...editor, error: t.errQty });
      return;
    }
    const qty = String(Number(editor.qty));
    if (editor.mode === 'qty') {
      onCount({ ...base, real_qty: qty });
    } else {
      const c = normalizeCesta(editor.cesta);
      if (!c) {
        setEditor({ ...editor, error: t.errCesta });
        return;
      }
      onCount({ ...base, real_cesta: c, real_fiada: normalizeFiada(editor.fiada), real_qty: qty });
    }
    setEditor(null);
  };

  let border = 'border-border';
  let status: JSX.Element | null = null;
  if (kind === 'new') {
    border = 'border-primary';
    status = <span className={cn(pill, tone.info)}><Plus className="w-3.5 h-3.5" />{t.stFound(countedQty(row))}</span>;
  } else if (kind === 'ok') {
    border = 'border-success/40';
    status = <span className={cn(pill, tone.ok)}><Check className="w-3.5 h-3.5" />{t.stMatches}</span>;
  } else if (kind === 'qty') {
    border = 'border-amber-300';
    status = <span className={cn(pill, tone.warn, 'tabular-nums')}>{t.stCounted(countedQty(row), signed(countedQty(row) - row.system_qty))}</span>;
  } else if (kind === 'zero') {
    border = 'border-destructive/40';
    status = <span className={cn(pill, tone.bad)}>{t.stNotFound}</span>;
  } else if (kind === 'moved') {
    border = 'border-amber-300';
    const q = countedQty(row);
    status = (
      <span className={cn(pill, tone.warn, 'font-mono-app')}>
        {t.stMoved(row.real_cesta, row.real_fiada || t.noFiada)}
        {q !== row.system_qty ? ` · ${q}` : ''}
      </span>
    );
  }

  return (
    <article className={cn('rounded-xl border bg-card p-3 grid gap-2.5', border)}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 grid gap-1">
          {special ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono-app font-bold text-[17px] break-all">{modelo}</span>
                {showFiada && <span className={cn(pill, tone.muted, 'font-mono-app')}>{rowFiada(row) || t.noFiada}</span>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(pill, tone.muted)}>{cesta}</span>
                {sap[modelo] && <span className="text-xs text-muted-foreground font-mono-app">{sap[modelo]}</span>}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono-app font-bold text-[15px]">{cesta}</span>
                {showFiada && <span className={cn(pill, tone.muted, 'font-mono-app')}>{rowFiada(row) || t.noFiada}</span>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono-app font-bold text-[17px] break-all">{modelo}</span>
                {sap[modelo] && <span className="text-xs text-muted-foreground font-mono-app">{sap[modelo]}</span>}
              </div>
            </>
          )}
        </div>
        {!found && (
          <div className="text-right leading-tight shrink-0">
            <div className="text-xl font-bold tabular-nums">{row.system_qty}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t.system}</div>
          </div>
        )}
      </div>

      {stale && (
        <div className="flex items-start gap-1.5 rounded-lg bg-amber-100 text-amber-800 px-2.5 py-1.5 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t.stale(liveQty(row, stock))}</span>
        </div>
      )}

      {row.applied_at ? (
        <div className="flex items-center gap-2 flex-wrap">
          {status}
          <span className={cn(pill, tone.muted)}>{t.stApplied}</span>
        </div>
      ) : editor ? (
        <div className="grid gap-2 rounded-lg bg-muted p-2.5">
          {editor.mode === 'where' && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.whereItIs}</p>
              <div className="grid grid-cols-2 gap-2">
                <AutocompleteInput
                  id={`ec-${row.id}`}
                  label={t.cesta}
                  value={editor.cesta}
                  onChange={(v) => setEditor({ ...editor, cesta: v, error: undefined })}
                  options={cestaOptions}
                  normalize={normalizeCesta}
                  autoFocus
                />
                <AutocompleteInput
                  id={`ef-${row.id}`}
                  label={t.fiada}
                  value={editor.fiada}
                  onChange={(v) => setEditor({ ...editor, fiada: v, error: undefined })}
                  options={fiadaOptions}
                  normalize={normalizeFiada}
                />
              </div>
            </>
          )}
          <label htmlFor={`eq-${row.id}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t.countedQty}
          </label>
          <div className="grid grid-cols-[48px_1fr_48px] gap-2">
            <Button
              type="button"
              variant="outline"
              className={cn(actionBtn, 'px-0')}
              aria-label="−1"
              onClick={() => setEditor({ ...editor, qty: String(Math.max(0, (Number(editor.qty) || 0) - 1)), error: undefined })}
            >
              <Minus className="w-4 h-4" />
            </Button>
            <Input
              id={`eq-${row.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              value={editor.qty}
              autoFocus={editor.mode === 'qty'}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setEditor({ ...editor, qty: e.target.value, error: undefined })}
              onKeyDown={(e) => e.key === 'Enter' && saveEditor()}
              className="h-11 text-center text-xl font-bold tabular-nums"
            />
            <Button
              type="button"
              variant="outline"
              className={cn(actionBtn, 'px-0')}
              aria-label="+1"
              onClick={() => setEditor({ ...editor, qty: String((Number(editor.qty) || 0) + 1), error: undefined })}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          {editor.error && <p className="text-sm text-destructive">{editor.error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className={actionBtn} onClick={() => setEditor(null)}>
              {t.cancel}
            </Button>
            <Button type="button" className="h-11 font-semibold" onClick={saveEditor}>
              {t.save}
            </Button>
          </div>
        </div>
      ) : kind === 'pending' ? (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" className="h-11 font-semibold gap-1.5" onClick={() => onCount({ ...base, real_qty: String(row.system_qty) })}>
            <Check className="w-4 h-4" />
            {t.matches}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={actionBtn}
            onClick={() => setEditor({ mode: 'qty', qty: String(row.system_qty), cesta: row.system_cesta, fiada: row.system_fiada })}
          >
            {t.otherQty}
          </Button>
          <Button type="button" variant="outline" className={actionBtn} onClick={() => onCount({ ...base, real_qty: '0' })}>
            {t.notHere}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={actionBtn}
            onClick={() => setEditor({ mode: 'where', qty: String(row.system_qty), cesta: '', fiada: row.system_fiada })}
          >
            {t.elsewhere}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {status}
          <span className="flex-1 min-w-0 text-sm text-muted-foreground truncate">
            {row.counted_by ? `${row.counted_by} · ` : ''}
            {hhmm(row.counted_at)}
          </span>
          {queued && (
            <span className="inline-flex items-center gap-1 text-xs text-primary" title={t.sending}>
              <CloudUpload className="w-3.5 h-3.5" />
            </span>
          )}
          <Button type="button" variant="ghost" size="sm" className="text-primary hover:bg-muted hover:text-primary" onClick={found ? onRemove : onRedo}>
            {found ? t.remove : t.redo}
          </Button>
        </div>
      )}
    </article>
  );
};

export default ItemCard;
