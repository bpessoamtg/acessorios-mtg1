import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import MovementTab from '@/components/tabs/MovementTab';
import HistoryTab from '@/components/tabs/HistoryTab';
import SearchTab from '@/components/tabs/SearchTab';
import StockTab from '@/components/tabs/StockTab';
import MessagesTab from '@/components/tabs/MessagesTab';
import InventoryTab from '@/components/tabs/InventoryTab';
import { Package, History, Search, BarChart3, LogOut, Mail, ClipboardCheck } from 'lucide-react';
import { getTranslations } from '@/lib/i18n';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const isAdmin = user?.username === 'Admin';
  const isInventory = user?.username?.toLowerCase() === 'inventario';
  const [activeTab, setActiveTab] = useState<string>(isInventory ? 'inventory' : 'movement');
  const t = getTranslations(user?.username);

  const { data: unreadCount } = useQuery({
    queryKey: ['admin-unread-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('admin_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('lida', false);
      return count || 0;
    },
    enabled: isAdmin,
    refetchInterval: 30000,
  });

  const tabs = isInventory
    ? [{ id: 'inventory', label: 'Inventário', icon: ClipboardCheck }]
    : [
        { id: 'movement', label: t.movement, icon: Package },
        { id: 'search', label: t.search, icon: Search },
        { id: 'stock', label: t.stock, icon: BarChart3 },
        { id: 'history', label: t.history, icon: History },
        ...(isAdmin ? [{ id: 'messages', label: t.messages, icon: Mail }] : []),
      ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">{t.appTitle}</h1>
          <p className="text-xs text-muted-foreground">{user?.username}</p>
        </div>
        <button onClick={logout} className="p-2 text-muted-foreground hover:text-destructive transition-colors">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 overflow-auto pb-20">
        {activeTab === 'movement' && !isInventory && <MovementTab />}
        {activeTab === 'search' && !isInventory && <SearchTab />}
        {activeTab === 'stock' && !isInventory && <StockTab />}
        {activeTab === 'history' && !isInventory && <HistoryTab />}
        {activeTab === 'messages' && isAdmin && <MessagesTab />}
        {activeTab === 'inventory' && <InventoryTab />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border flex z-50">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center py-2 px-1 transition-colors relative ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {tab.id === 'messages' && (unreadCount ?? 0) > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-0.5 font-medium">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default Dashboard;
