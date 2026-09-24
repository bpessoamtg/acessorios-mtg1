import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Download, ArrowUpDown, ChevronUp, ChevronDown, RefreshCw, Save, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';

interface StockItem {
  id: string;
  modelo: string;
  cesta: string;
  fiada: string | null;
  quantidade: number;
  cod_sap: string | null;
}

interface AuditRow {
  systemId: string | null;
  systemModelo: string;
  systemCesta: string;
  systemFiada: string;
  systemQty: number;
  realModelo: string;
  realCesta: string;
  realFiada: string;
  realQty: string;
}

type SortField = 'cesta' | 'fiada';
type SortDir = 'asc' | 'desc';

const ADMIN_CODE = '1745';

const InventoryTab = () => {
  const queryClient = useQueryClient();

  const { data: stockItems = [], isLoading } = useQuery({
    queryKey: ['inventory-stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('*')
        .order('cesta')
        .order('fiada');
      if (error) throw error;
      return (data || []) as StockItem[];
    },
  });

  // Load saved audit data
  const { data: savedAudit, isLoading: isLoadingSaved } = useQuery({
    queryKey: ['inventory-audit-saved'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_audit')
        .select('*')
        .order('created_at');
      if (error) throw error;
      return data || [];
    },
  });

  const [auditRows, setAuditRows] = useState<AuditRow[] | null>(null);
  const [sortField, setSortField] = useState<SortField>('cesta');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [searchCesta, setSearchCesta] = useState('');
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Initialize from saved data or stock
  useEffect(() => {
    if (initialized || isLoading || isLoadingSaved) return;
    if (savedAudit && savedAudit.length > 0) {
      setAuditRows(
        savedAudit.map((row) => ({
          systemId: row.stock_item_id,
          systemModelo: row.system_modelo,
          systemCesta: row.system_cesta,
          systemFiada: row.system_fiada,
          systemQty: row.system_qty,
          realModelo: row.real_modelo,
          realCesta: row.real_cesta,
          realFiada: row.real_fiada,
          realQty: row.real_qty,
        }))
      );
    } else if (stockItems.length > 0) {
      setAuditRows(
        stockItems.map((item) => ({
          systemId: item.id,
          systemModelo: item.modelo,
          systemCesta: item.cesta,
          systemFiada: item.fiada || '',
          systemQty: item.quantidade,
          realModelo: item.modelo,
          realCesta: item.cesta,
          realFiada: item.fiada || '',
          realQty: '',
        }))
      );
    }
    setInitialized(true);
  }, [stockItems, savedAudit, isLoading, isLoadingSaved, initialized]);

  const rows = useMemo(() => {
    if (!auditRows) return [];
    let filtered = auditRows;
    if (searchCesta.trim()) {
      const q = searchCesta.trim().toLowerCase();
      filtered = auditRows.filter((r) => r.systemCesta.toLowerCase().includes(q) || r.realCesta.toLowerCase().includes(q));
    }
    return [...filtered].sort((a, b) => {
      const valA = sortField === 'cesta' ? a.systemCesta : a.systemFiada;
      const valB = sortField === 'cesta' ? b.systemCesta : b.systemFiada;
      const cmp = valA.localeCompare(valB, undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [auditRows, sortField, sortDir, searchCesta]);

  const updateRow = (index: number, field: keyof AuditRow, value: string) => {
    if (!auditRows) return;
    const sortedRow = rows[index];
    const origIdx = auditRows.indexOf(sortedRow);
    if (origIdx === -1) return;
    const updated = [...auditRows];
    (updated[origIdx] as any)[field] = value;
    setAuditRows(updated);
  };

  const addRow = () => {
    setAuditRows((prev) => [
      ...(prev || []),
      {
        systemId: null,
        systemModelo: '',
        systemCesta: '',
        systemFiada: '',
        systemQty: 0,
        realModelo: '',
        realCesta: '',
        realFiada: '',
        realQty: '',
      },
    ]);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const isDiff = (real: string, system: string) =>
    real !== '' && real.trim().toLowerCase() !== system.trim().toLowerCase();

  const isQtyDiff = (realQty: string, systemQty: number) =>
    realQty !== '' && Number(realQty) !== systemQty;

  const diffClass = 'text-destructive font-bold';

  // Save progress to DB
  const handleSave = useCallback(async () => {
    if (!auditRows) return;
    setIsSaving(true);
    try {
      // Delete existing
      await supabase.from('inventory_audit').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      // Insert all
      const toInsert = auditRows.map((r) => ({
        stock_item_id: r.systemId,
        system_modelo: r.systemModelo,
        system_cesta: r.systemCesta,
        system_fiada: r.systemFiada,
        system_qty: r.systemQty,
        real_modelo: r.realModelo,
        real_cesta: r.realCesta,
        real_fiada: r.realFiada,
        real_qty: r.realQty,
      }));
      // Insert in batches of 100
      for (let i = 0; i < toInsert.length; i += 100) {
        const batch = toInsert.slice(i, i + 100);
        const { error } = await supabase.from('inventory_audit').insert(batch);
        if (error) throw error;
      }
      toast.success('Inventário gravado com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao gravar inventário');
    } finally {
      setIsSaving(false);
    }
  }, [auditRows]);

  // Reset inventory from current stock (requires admin code)
  const handleReset = async () => {
    if (adminCode !== ADMIN_CODE) {
      toast.error('Código de admin inválido');
      return;
    }
    setIsResetting(true);
    try {
      // Refresh stock
      const { data: freshStock, error } = await supabase
        .from('stock_items')
        .select('*')
        .order('cesta')
        .order('fiada');
      if (error) throw error;
      const items = (freshStock || []) as StockItem[];
      const newRows: AuditRow[] = items.map((item) => ({
        systemId: item.id,
        systemModelo: item.modelo,
        systemCesta: item.cesta,
        systemFiada: item.fiada || '',
        systemQty: item.quantidade,
        realModelo: item.modelo,
        realCesta: item.cesta,
        realFiada: item.fiada || '',
        realQty: '',
      }));
      setAuditRows(newRows);
      // Clear saved audit
      await supabase.from('inventory_audit').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      // Save fresh
      const toInsert = newRows.map((r) => ({
        stock_item_id: r.systemId,
        system_modelo: r.systemModelo,
        system_cesta: r.systemCesta,
        system_fiada: r.systemFiada,
        system_qty: r.systemQty,
        real_modelo: r.realModelo,
        real_cesta: r.realCesta,
        real_fiada: r.realFiada,
        real_qty: r.realQty,
      }));
      for (let i = 0; i < toInsert.length; i += 100) {
        const batch = toInsert.slice(i, i + 100);
        await supabase.from('inventory_audit').insert(batch);
      }
      queryClient.invalidateQueries({ queryKey: ['inventory-audit-saved'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
      toast.success('Lista de inventário atualizada!');
      setResetDialogOpen(false);
      setAdminCode('');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao atualizar lista');
    } finally {
      setIsResetting(false);
    }
  };

  const exportToExcel = () => {
    if (!auditRows) return;
    const data = auditRows.map((r) => ({
      'Modelo (Sistema)': r.systemModelo,
      'Cesta (Sistema)': r.systemCesta,
      'Fiada (Sistema)': r.systemFiada,
      'Qtd (Sistema)': r.systemQty,
      'Modelo (Real)': r.realModelo,
      'Cesta (Real)': r.realCesta,
      'Fiada (Real)': r.realFiada,
      'Qtd (Real)': r.realQty === '' ? '' : Number(r.realQty),
      'Diferença Qtd': r.realQty === '' ? '' : Number(r.realQty) - r.systemQty,
      'Discrepância':
        r.realQty !== '' &&
        (Number(r.realQty) !== r.systemQty ||
          r.realModelo.toLowerCase() !== r.systemModelo.toLowerCase() ||
          r.realCesta.toLowerCase() !== r.systemCesta.toLowerCase() ||
          r.realFiada.toLowerCase() !== r.systemFiada.toLowerCase())
          ? 'SIM'
          : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventário');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf]), `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Exportação concluída');
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />;
  };

  if (isLoading || isLoadingSaved) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-bold text-foreground">Inventário / Auditoria</h2>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setResetDialogOpen(true)} className="gap-1">
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
          <Button size="sm" variant="outline" onClick={addRow} className="gap-1">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Novo</span>
          </Button>
        </div>
      </div>

      {/* Search + Sort bar */}
      <div className="px-4 py-2 flex flex-col gap-2 border-b border-border bg-muted/30">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchCesta}
            onChange={(e) => setSearchCesta(e.target.value)}
            placeholder="Pesquisar por cesta..."
            className="h-8 text-xs pl-8"
          />
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => toggleSort('cesta')}
            className="text-xs font-medium flex items-center text-muted-foreground hover:text-foreground transition-colors"
          >
            Cesta <SortIcon field="cesta" />
          </button>
          <button
            onClick={() => toggleSort('fiada')}
            className="text-xs font-medium flex items-center text-muted-foreground hover:text-foreground transition-colors"
          >
            Fiada <SortIcon field="fiada" />
          </button>
          <span className="ml-auto text-xs text-muted-foreground">{rows.length} itens</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto px-3 py-2 space-y-2 pb-32">
        {rows.map((row, idx) => {
          const isNew = row.systemId === null;
          return (
            <div key={row.systemId || `new-${idx}`} className="rounded-lg border border-border bg-card p-3">
              {isNew && (
                <span className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1 block">
                  + Item encontrado
                </span>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sistema</p>
                  {isNew ? (
                    <p className="text-xs text-muted-foreground italic">Sem registo</p>
                  ) : (
                    <>
                      <p className="text-xs"><span className="text-muted-foreground">Modelo:</span> {row.systemModelo}</p>
                      <p className="text-xs"><span className="text-muted-foreground">Cesta:</span> {row.systemCesta}</p>
                      <p className="text-xs"><span className="text-muted-foreground">Fiada:</span> {row.systemFiada || '—'}</p>
                      <p className="text-xs"><span className="text-muted-foreground">Qtd:</span> {row.systemQty}</p>
                    </>
                  )}
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Contagem</p>
                  <Input
                    value={row.realModelo}
                    onChange={(e) => updateRow(idx, 'realModelo', e.target.value)}
                    placeholder="Modelo"
                    className={`h-8 text-xs ${isDiff(row.realModelo, row.systemModelo) ? diffClass : ''}`}
                  />
                  <Input
                    value={row.realCesta}
                    onChange={(e) => updateRow(idx, 'realCesta', e.target.value)}
                    placeholder="Cesta"
                    className={`h-8 text-xs ${isDiff(row.realCesta, row.systemCesta) ? diffClass : ''}`}
                  />
                  <Input
                    value={row.realFiada}
                    onChange={(e) => updateRow(idx, 'realFiada', e.target.value)}
                    placeholder="Fiada"
                    className={`h-8 text-xs ${isDiff(row.realFiada, row.systemFiada) ? diffClass : ''}`}
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={row.realQty}
                    onChange={(e) => updateRow(idx, 'realQty', e.target.value)}
                    placeholder="Qtd"
                    className={`h-8 text-xs ${isQtyDiff(row.realQty, row.systemQty) ? diffClass : ''}`}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fixed bottom buttons */}
      <div className="fixed bottom-16 left-0 right-0 p-3 bg-card border-t border-border z-40 flex gap-2">
        <Button onClick={handleSave} variant="outline" disabled={isSaving} className="flex-1 gap-2 h-11 font-semibold">
          <Save className="w-4 h-4" />
          {isSaving ? 'A gravar...' : 'Gravar'}
        </Button>
        <Button onClick={exportToExcel} className="flex-1 gap-2 h-11 font-semibold">
          <Download className="w-4 h-4" />
          Exportar Excel
        </Button>
      </div>

      {/* Reset dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Atualizar Lista Inventário</DialogTitle>
            <DialogDescription>
              Isto irá recarregar todos os itens do stock atual e limpar todas as contagens existentes. Insira o código de admin para confirmar.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            inputMode="numeric"
            placeholder="Código de admin"
            value={adminCode}
            onChange={(e) => setAdminCode(e.target.value)}
            className="h-11"
            onKeyDown={(e) => e.key === 'Enter' && handleReset()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetDialogOpen(false); setAdminCode(''); }}>
              Cancelar
            </Button>
            <Button onClick={handleReset} disabled={isResetting || !adminCode}>
              {isResetting ? 'A atualizar...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InventoryTab;
