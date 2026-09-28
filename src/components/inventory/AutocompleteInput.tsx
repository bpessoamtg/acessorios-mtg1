import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface AutocompleteInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** Extra text shown next to a suggestion and also searched (the SAP code). */
  hintFor?: (option: string) => string | undefined;
  /** Offer the typed text as a new value when nothing matches exactly. */
  newLabel?: (typed: string) => string;
  /** Applied when the field loses focus or a new value is chosen. */
  normalize?: (value: string) => string;
  placeholder?: string;
  error?: string;
  autoFocus?: boolean;
}

const MAX = 6;

// Unlike ComboboxField this accepts values that are not on the list: a model
// first seen during the count, or a fiada such as B20 that the fixed list lacks.
const AutocompleteInput = ({
  id, label, value, onChange, options, hintFor, newLabel, normalize, placeholder, error, autoFocus,
}: AutocompleteInputProps) => {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();

  const hits = useMemo(() => {
    if (!q) return [];
    return options.filter((o) => o.toLowerCase().includes(q) || (hintFor?.(o) || '').toLowerCase().includes(q));
  }, [options, hintFor, q]);
  const exact = hits.some((o) => o.toLowerCase() === q);

  const pick = (v: string) => {
    onChange(normalize ? normalize(v) : v);
    setOpen(false);
  };

  return (
    <div className="grid gap-1 min-w-0">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          if (normalize) {
            const n = normalize(value);
            if (n !== value) onChange(n);
          }
        }}
        className={cn('h-11 text-base font-mono-app', error && 'border-destructive')}
      />
      {open && (hits.length > 0 || (newLabel && q && !exact)) && (
        <div role="listbox" className="grid rounded-lg border border-border bg-card overflow-hidden">
          {hits.slice(0, MAX).map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={o.toLowerCase() === q}
              // mousedown fires before the input's blur, so the tap is not lost.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              className="min-h-11 px-3 flex items-center justify-between gap-2 text-left border-b border-border last:border-b-0 font-mono-app text-sm hover:bg-muted active:bg-muted"
            >
              <span className="truncate">{o}</span>
              {hintFor?.(o) && <span className="text-xs text-muted-foreground font-sans shrink-0">{hintFor(o)}</span>}
            </button>
          ))}
          {hits.length > MAX && (
            <p className="px-3 py-2 text-xs text-muted-foreground border-b border-border">+ {hits.length - MAX}</p>
          )}
          {newLabel && q && !exact && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(value.trim().toUpperCase());
              }}
              className="min-h-11 px-3 text-left text-sm font-semibold text-primary hover:bg-muted active:bg-muted"
            >
              {newLabel(value.trim().toUpperCase())}
            </button>
          )}
        </div>
      )}
      {error && (
        <p id={`${id}-err`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
};

export default AutocompleteInput;
