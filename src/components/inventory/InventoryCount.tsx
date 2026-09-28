import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CloudOff, CloudUpload, Loader2, Plus, Search, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CESTAS, FIADAS } from '@/lib/constants';
import {
  AuditRow,
  compareByCesta,
  Filter,
  groupByFiada,
  isSpecialCesta,
  matchesSearch,
  passesFilter,
  progressOf,
  rowCesta,
  rowFiada,
} from '@/lib/inventory';
import { InvLang, InvStrings } from '@/lib/inventoryI18n';
import { InventoryData } from '@/hooks/useInventory';
import ItemCard from './ItemCard';
import FoundItemSheet from './FoundItemSheet';

interface InventoryCountProps {
  inv: InventoryData;
  t: InvStrings;
  operator: string;
  lang: InvLang;
  onToggleLang: () => void;
  onSwitchOperator: (() => void) | null;
}

type View = 'fiada' | 'cesta';
const PAGE = 60;
const VIEW_KEY = 'inventory-view';

const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'cesta' ? 'cesta' : 'fiada';
  } catch {
    return 'fiada';
  }
};

const hhmm = (ms: number | null) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const InventoryCount = ({ inv, t, operator, lang, onToggleLang, onSwitchOperator }: InventoryCountProps) => {
  const [view, setView] = useState<View>(readView);
  const [fiada, setFiada] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [foundFor, setFoundFor] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* per-device convenience only */
    }
  }, [view]);
  useEffect(() => setLimit(PAGE), [view, fiada, filter, query]);

  const { rows, stock, sap, models, pending } = inv;
  const prog = progressOf(rows);

  const cestaOptions = useMemo(() => {
    const s = new Set(CESTAS);
    rows.forEach((r) => s.add(rowCesta(r)));
    return [...s];
  }, [rows]);
  const fiadaOptions = useMemo(() => {
    const s = new Set(FIADAS);
    rows.forEach((r) => rowFiada(r) && s.add(rowFiada(r)));
    return [...s];
  }, [rows]);

  const card = (r: AuditRow, showFiada: boolean) => (
    <ItemCard
      key={r.id}
      row={r}
      t={t}
      operator={operator}
      stock={stock}
      sap={sap}
      showFiada={showFiada}
      queued={pending.has(r.id)}
      cestaOptions={cestaOptions}
      fiadaOptions={fiadaOptions}
      onCount={(patch) => inv.count(r, patch)}
      onRedo={() => {
        inv.redo(r);
        toast(t.toastRedo);
      }}
      onRemove={() => inv.removeFound(r.id)}
    />
  );

  const empty = (text: string) => (
    <div className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-muted-foreground">{text}</div>
  );
  const emptyForFilter = () => empty(filter === 'diff' ? t.emptyDiff : t.emptyPending);
  const more = (shown: number, total: number) =>
    total > shown && (
      <Button variant="outline" className="h-11 hover:bg-muted hover:text-foreground" onClick={() => setLimit((l) => l + PAGE)}>
        {t.showMore(Math.min(PAGE, total - shown))}
      </Button>
    );
  const foundButton = (f: string, label: string) => (
    <Button variant="outline" className="h-11 gap-1.5 font-semibold hover:bg-muted hover:text-foreground" onClick={() => setFoundFor(f)}>
      <Plus className="w-4 h-4" />
      {label}
    </Button>
  );

  let body: JSX.Element;
  const q = query.trim();
  if (q) {
    const hits = rows.filter((r) => matchesSearch(r, q, sap)).sort(compareByCesta);
    body = (
      <>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">{t.results(hits.length)}</p>
        {hits.length ? hits.slice(0, limit).map((r) => card(r, true)) : empty(t.emptySearch)}
        {more(Math.min(limit, hits.length), hits.length)}
      </>
    );
  } else if (view === 'fiada' && fiada === null) {
    const groups = groupByFiada(rows).filter((g) =>
      filter === 'pending' ? g.pending > 0 : filter === 'diff' ? g.diffs > 0 : true,
    );
    body = groups.length ? (
      <>
        {groups.map((g) => {
          const done = g.pending === 0;
          return (
            <button
              key={g.fiada || '-'}
              onClick={() => {
                setFiada(g.fiada);
                window.scrollTo({ top: 0 });
              }}
              className={cn(
                'grid grid-cols-[64px_1fr_auto] items-center gap-3 rounded-xl border bg-card px-3 py-3 min-h-14 text-left active:bg-muted',
                done && !g.diffs ? 'border-success/40' : 'border-border',
              )}
            >
              <span className="font-mono-app font-bold text-base">{g.fiada || t.noFiada}</span>
              <span className="grid gap-1">
                <span className="text-sm text-muted-foreground tabular-nums">
                  {g.counted}/{g.total}
                </span>
                <span className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <span
                    className={cn('block h-full rounded-full', done ? 'bg-success' : 'bg-primary')}
                    style={{ width: `${Math.round((100 * g.counted) / g.total)}%` }}
                  />
                </span>
              </span>
              {g.diffs ? (
                <span className="rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-xs font-semibold tabular-nums">{t.diffs(g.diffs)}</span>
              ) : done ? (
                <span className="rounded-full bg-success/10 text-success p-1.5"><Check className="w-4 h-4" /></span>
              ) : (
                <span />
              )}
            </button>
          );
        })}
      </>
    ) : (
      emptyForFilter()
    );
  } else if (view === 'fiada' && fiada !== null) {
    const inFiada = rows.filter((r) => rowFiada(r) === fiada).sort(compareByCesta);
    const p = progressOf(inFiada);
    const shown = inFiada.filter((r) => passesFilter(r, filter));
    body = (
      <>
        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" className="h-10 gap-1 hover:bg-muted hover:text-foreground" onClick={() => setFiada(null)}>
            <ArrowLeft className="w-4 h-4" />
            {t.fiadas}
          </Button>
          <h2 className="flex-1 text-center font-mono-app text-lg font-bold">{fiada || t.noFiada}</h2>
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums',
              p.pending === 0 ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
            )}
          >
            {p.counted}/{p.total}
          </span>
        </div>
        {shown.length ? shown.map((r) => card(r, false)) : emptyForFilter()}
        {foundButton(fiada, t.foundHere)}
      </>
    );
  } else {
    const list = rows.filter((r) => passesFilter(r, filter)).sort(compareByCesta);
    const cestas = list.filter((r) => !isSpecialCesta(rowCesta(r)));
    const special = list.filter((r) => isSpecialCesta(rowCesta(r)));
    const shownCestas = cestas.slice(0, limit);
    const shownSpecial = special.slice(0, Math.max(0, limit - cestas.length));
    body = (
      <>
        {foundButton('', t.found)}
        {!list.length && emptyForFilter()}
        {shownCestas.length > 0 && (
          <div className="flex items-baseline justify-between pt-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.secCestas}</span>
            <span className="text-sm text-muted-foreground tabular-nums">{t.items(cestas.length)}</span>
          </div>
        )}
        {shownCestas.map((r) => card(r, true))}
        {shownSpecial.length > 0 && (
          <div className="grid gap-0.5 pt-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.secSpecial}</span>
              <span className="text-sm text-muted-foreground tabular-nums">{t.items(special.length)}</span>
            </div>
            <p className="text-sm text-muted-foreground">{t.secSpecialSub}</p>
          </div>
        )}
        {shownSpecial.map((r) => card(r, true))}
        {more(shownCestas.length + shownSpecial.length, list.length)}
      </>
    );
  }

  const status = inv.offline ? (
    <span role="status" className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-xs font-semibold whitespace-nowrap">
      <CloudOff className="w-3.5 h-3.5" />
      {t.offline(inv.queueLength)}
    </span>
  ) : inv.sending || inv.queueLength ? (
    <span role="status" className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-semibold whitespace-nowrap">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      {t.saving}
    </span>
  ) : (
    <span role="status" className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success px-2.5 py-1 text-xs font-semibold whitespace-nowrap">
      <CloudUpload className="w-3.5 h-3.5" />
      {t.saved(hhmm(inv.lastSaved))}
    </span>
  );

  return (
    <div className="flex flex-col">
      {/* Only the essentials stay pinned: on a small phone the full set of
          controls would leave little room for the list. */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 pt-3 pb-2.5 grid gap-2">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-lg font-bold">{t.title}</h2>
          {status}
          <Button variant="outline" size="sm" className="h-9 px-2.5 hover:bg-muted hover:text-foreground" onClick={onToggleLang} aria-label={lang === 'pt' ? 'English' : 'Português'}>
            {t.langToggle}
          </Button>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <User className="w-4 h-4" />
          <span className="flex-1">{operator}</span>
          {onSwitchOperator && (
            <Button variant="ghost" size="sm" className="h-8 text-primary hover:bg-muted hover:text-primary" onClick={onSwitchOperator}>
              {t.switchOperator}
            </Button>
          )}
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between text-sm tabular-nums">
            <span className="font-semibold">{t.counted(prog.counted, prog.total)}</span>
            <span className="text-muted-foreground">{t.left(prog.pending)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${prog.total ? Math.round((100 * prog.counted) / prog.total) : 0}%` }} />
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 grid gap-2.5">
        <div role="group" aria-label="Ordenar" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(['fiada', 'cesta'] as View[]).map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
                setFiada(null);
              }}
              className={cn(
                'h-9 rounded-md text-sm font-semibold transition-colors',
                view === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {v === 'fiada' ? t.byFiada : t.byCesta}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            id="inventory-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            autoComplete="off"
            className="h-11 pl-9 text-base"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {([
            ['pending', t.fPending, prog.pending],
            ['diff', t.fDiff, prog.diffs],
            ['all', t.fAll, prog.total],
          ] as [Filter, string, number][]).map(([f, label, n]) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'h-9 rounded-full border px-3 text-sm font-semibold inline-flex items-center gap-1.5 transition-colors',
                filter === f ? 'bg-primary text-primary-foreground border-transparent' : 'bg-card border-border text-foreground',
              )}
            >
              {label}
              <span className="font-medium opacity-80 tabular-nums">{n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-3 grid gap-2">{body}</div>

      <FoundItemSheet
        open={foundFor !== null}
        fiada={foundFor ?? ''}
        t={t}
        models={models}
        sap={sap}
        cestaOptions={cestaOptions}
        fiadaOptions={fiadaOptions}
        onClose={() => setFoundFor(null)}
        onSave={(item) => {
          inv.addFound({ ...item, by: operator });
          setFoundFor(null);
          toast.success(t.toastAdded);
        }}
      />
    </div>
  );
};

export default InventoryCount;
