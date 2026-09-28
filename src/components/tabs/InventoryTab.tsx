import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useInventory } from '@/hooks/useInventory';
import { invStrings, InvLang, OPERATORS } from '@/lib/inventoryI18n';
import { cn } from '@/lib/utils';
import InventoryCount from '@/components/inventory/InventoryCount';
import InventoryAdmin from '@/components/inventory/InventoryAdmin';

const OPERATOR_KEY = 'inventory-operator';

const readOperator = (): string | null => {
  try {
    const v = localStorage.getItem(OPERATOR_KEY);
    return OPERATORS.some((o) => o.name === v) ? v : null;
  } catch {
    return null;
  }
};
const writeOperator = (v: string | null) => {
  try {
    if (v) localStorage.setItem(OPERATOR_KEY, v);
    else localStorage.removeItem(OPERATOR_KEY);
  } catch {
    /* the picker simply shows again next time */
  }
};
const langOf = (name: string | null): InvLang => OPERATORS.find((o) => o.name === name)?.lang ?? 'pt';

const InventoryTab = () => {
  const { user } = useAuth();
  const isAdmin = user?.username === 'Admin';
  const inv = useInventory();

  // The shared "inventario" login is used by several people on the same phone,
  // so each one says who they are. Admin counts as Admin.
  const [operator, setOperator] = useState<string | null>(() => (isAdmin ? 'Admin' : readOperator()));
  const [lang, setLang] = useState<InvLang>(() => langOf(isAdmin ? null : readOperator()));
  const [mode, setMode] = useState<'count' | 'admin'>(isAdmin ? 'admin' : 'count');
  const t = invStrings(lang);

  const rejected = useRef(inv.rejectedTick);
  useEffect(() => {
    if (inv.rejectedTick !== rejected.current) {
      rejected.current = inv.rejectedTick;
      toast.warning(t.toastRejected);
    }
  }, [inv.rejectedTick, t]);
  useEffect(() => {
    if (inv.otherTick) toast(t.toastOther(inv.otherTick.n));
  }, [inv.otherTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickOperator = (name: string) => {
    writeOperator(name);
    setOperator(name);
    setLang(langOf(name));
  };

  if (!operator) {
    return (
      <div className="px-4 py-8 grid gap-4 justify-items-center text-center max-w-md mx-auto">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Metalogalva" width={56} height={56} className="w-14 h-14" />
        <h2 className="text-xl font-bold">{invStrings('pt').whoCounts}</h2>
        <p className="text-sm text-muted-foreground max-w-[34ch]">{invStrings('pt').whoCountsSub}</p>
        <div className="grid gap-2.5 w-full">
          {OPERATORS.map((o) => (
            <Button
              key={o.name}
              variant="outline"
              className="h-14 justify-between px-4 text-base font-semibold hover:bg-muted hover:text-foreground"
              onClick={() => pickOperator(o.name)}
            >
              {o.name}
              <span className="text-xs font-medium text-muted-foreground">{o.lang === 'en' ? 'English' : 'Português'}</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  if (inv.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (inv.loadError) {
    return (
      <div className="p-4 grid gap-3 text-center">
        <p className="text-muted-foreground">{t.loadError}</p>
        <Button variant="outline" className="h-11 hover:bg-muted hover:text-foreground" onClick={inv.refresh}>
          {t.retry}
        </Button>
      </div>
    );
  }

  const adminSwitch = isAdmin && (
    <div role="group" aria-label="Modo" className="mx-4 mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
      {(['admin', 'count'] as const).map((m) => (
        <button
          key={m}
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={cn(
            'h-9 rounded-md text-sm font-semibold transition-colors',
            mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          {m === 'admin' ? 'Painel' : 'Contagem'}
        </button>
      ))}
    </div>
  );

  if (isAdmin && mode === 'admin') {
    return (
      <>
        {adminSwitch}
        <InventoryAdmin inv={inv} />
      </>
    );
  }

  if (!inv.inventory) {
    return (
      <>
        {adminSwitch}
        <p className="p-6 text-center text-muted-foreground">{t.emptyList}</p>
      </>
    );
  }

  return (
    <>
      {adminSwitch}
      <InventoryCount
        inv={inv}
        t={t}
        operator={operator}
        lang={lang}
        onToggleLang={() => setLang((l) => (l === 'pt' ? 'en' : 'pt'))}
        onSwitchOperator={
          isAdmin
            ? null
            : () => {
                writeOperator(null);
                setOperator(null);
              }
        }
      />
    </>
  );
};

export default InventoryTab;
