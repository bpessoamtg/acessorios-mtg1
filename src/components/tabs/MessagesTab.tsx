import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { Loader2, CheckCheck, AlertTriangle } from 'lucide-react';

const MessagesTab = () => {
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const markAsRead = async (id: string) => {
    await supabase.from('admin_notifications').update({ lida: true }).eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
  };

  const markAllAsRead = async () => {
    await supabase.from('admin_notifications').update({ lida: true }).eq('lida', false);
    queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
  };

  const unreadCount = notifications?.filter((n) => !n.lida).length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">
          Mensagens {unreadCount > 0 && <span className="text-destructive">({unreadCount} novas)</span>}
        </h2>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={markAllAsRead}>
            <CheckCheck className="w-4 h-4 mr-1" />
            Marcar todas como lidas
          </Button>
        )}
      </div>

      {(!notifications || notifications.length === 0) ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCheck className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Sem mensagens</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card
              key={n.id}
              className={`p-3 border transition-colors ${
                n.lida ? 'bg-card border-border opacity-60' : 'bg-destructive/5 border-destructive/30'
              }`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${n.lida ? 'text-muted-foreground' : 'text-destructive'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(n.created_at), "dd/MM/yyyy HH:mm", { locale: pt })}
                  </p>
                </div>
                {!n.lida && (
                  <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => markAsRead(n.id)}>
                    Lida
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default MessagesTab;
