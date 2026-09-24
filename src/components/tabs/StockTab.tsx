import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Search, Loader2, Download, Upload, Plus } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { getTranslations } from '@/lib/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface StockSummary {
  modelo: string;
  cod_sap: string | null;
  total: number;
  locations: number;
}

const StockTab = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [newModelo, setNewModelo] = useState('');
  const [newCodSap, setNewCodSap] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const isAdmin = user?.username === 'Admin';
  const t = getTranslations(user?.username);

  const { data: stockData, isLoading, refetch } = useQuery({
    queryKey: ['stock-overview'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('modelo, cod_sap, quantidade, cesta, fiada')
        .order('modelo');
      if (error) throw error;

      const grouped: Record<string, StockSummary> = {};
      for (const item of data) {
        if (!grouped[item.modelo]) {
          grouped[item.modelo] = { modelo: item.modelo, cod_sap: item.cod_sap, total: 0, locations: 0 };
        }
        grouped[item.modelo].total += item.quantidade;
        grouped[item.modelo].locations += 1;
      }
      return { summary: Object.values(grouped).sort((a, b) => a.modelo.localeCompare(b.modelo)), raw: data };
    },
    refetchInterval: 10000,
  });

  const summary = stockData?.summary || [];
  const rawData = stockData?.raw || [];

  const filtered = summary.filter(
    (s) =>
      s.modelo.toLowerCase().includes(filter.toLowerCase()) ||
      (s.cod_sap && s.cod_sap.toLowerCase().includes(filter.toLowerCase()))
  );

  const totalStock = filtered.reduce((sum, s) => sum + s.total, 0);

  const handleAddModel = async () => {
    if (!newModelo.trim() || !newCodSap.trim()) {
      toast.error(t.fillModelAndSap);
      return;
    }
    setIsAdding(true);
    try {
      const { error } = await supabase.from('model_sap_lookup').insert({
        modelo: newModelo.trim(),
        cod_sap: newCodSap.trim(),
      });
      if (error) throw error;
      toast.success(t.modelAdded);
      setNewModelo('');
      setNewCodSap('');
      setShowAddModel(false);
      queryClient.invalidateQueries({ queryKey: ['model-options'] });
    } catch (error) {
      console.error(error);
      toast.error(t.modelAddError);
    } finally {
      setIsAdding(false);
    }
  };

  const handleExport = () => {
    const exportData = rawData.map((item) => ({
      Modelo: item.modelo,
      'Cod SAP': item.cod_sap || '',
      Cesta: item.cesta,
      Fiada: item.fiada || '',
      Quantidade: item.quantidade,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `stock_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(t.exportDone);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

      const items = rows.map((row) => ({
        modelo: String(row['Modelo'] || row['modelo'] || ''),
        cod_sap: String(row['Cod SAP'] || row['cod_sap'] || row['Cod_SAP'] || row['COD_SAP'] || '') || null,
        cesta: String(row['Cesta'] || row['cesta'] || row['Cesta/palete'] || row['Cesta/Palete'] || ''),
        fiada: String(row['Fiada'] || row['fiada'] || '') || null,
        quantidade: parseInt(String(row['Quantidade'] || row['quantidade'] || row['Stock'] || row['stock'] || '0')) || 0,
      })).filter((i) => i.modelo && i.cesta);

      if (items.length === 0) {
        toast.error(t.noValidData);
        setIsImporting(false);
        return;
      }

      await supabase.from('stock_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      for (let i = 0; i < items.length; i += 100) {
        const batch = items.slice(i, i + 100);
        const { error } = await supabase.from('stock_items').insert(batch);
        if (error) throw error;
      }

      toast.success(t.importSuccess(items.length));
      refetch();
    } catch (error) {
      console.error(error);
      toast.error(t.importError);
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{t.stockOverview}</h2>
        <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full">
          {filtered.length} {t.models}
        </span>
      </div>

      {isAdmin && (
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="w-4 h-4" /> {t.exportBtn}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 relative" disabled={isImporting}>
            <Upload className="w-4 h-4" /> {isImporting ? t.importing : t.importBtn}
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImport}
              className="absolute inset-0 opacity-0 cursor-pointer"
              disabled={isImporting}
            />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddModel(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> {t.addNewModel}
          </Button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t.filterPlaceholder}
          className="h-10 pl-10"
        />
      </div>

      <Card className="p-3 bg-primary/5 border-primary/20">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">
            {filter ? t.filteredSubtotal : t.globalTotal}
          </span>
          <span className="text-lg font-bold text-primary">{totalStock} un.</span>
        </div>
      </Card>

      <div className="space-y-2">
        {filtered.map((item) => (
          <Card key={item.modelo} className="p-3 flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground font-mono-app truncate">{item.modelo}</p>
              {item.cod_sap && (
                <p className="text-xs text-muted-foreground truncate">{item.cod_sap}</p>
              )}
            </div>
            <div className="text-right shrink-0 ml-3">
              <p className="text-lg font-bold text-foreground">{item.total}</p>
              <p className="text-xs text-muted-foreground">{t.locationCount(item.locations)}</p>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={showAddModel} onOpenChange={setShowAddModel}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.newModelTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-foreground">{t.modelName}</label>
              <Input value={newModelo} onChange={(e) => setNewModelo(e.target.value)} placeholder="Ex: ABC-123" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t.sapCode}</label>
              <Input value={newCodSap} onChange={(e) => setNewCodSap(e.target.value)} placeholder="Ex: 400012345" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModel(false)}>{t.cancel}</Button>
            <Button onClick={handleAddModel} disabled={isAdding}>
              {isAdding ? t.adding : t.addBtn}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StockTab;
