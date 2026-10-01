import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { lerHandoff, sairTambemDoPicking } from '@/lib/pickingHandoff';

interface User {
  username: string;
}

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const username = (session.user.user_metadata?.username as string) ?? '';
        setUser(username ? { username } : null);
      } else {
        setUser(null);
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      let username = (session?.user?.user_metadata?.username as string) ?? '';

      // Vindo da app de picking com outro utilizador (ou sem nenhum aqui): entra
      // com quem fez login lá. O PIN foi verificado no servidor por este mesmo
      // projeto, por isso é uma sessão como qualquer outra.
      const handoff = lerHandoff(localStorage);
      if (handoff && handoff.username !== username) {
        const { data: novo, error } = await supabase.auth.setSession({
          access_token: handoff.access_token,
          refresh_token: handoff.refresh_token,
        });
        if (!error && novo.session) {
          // Sem isto aparecia por momentos o que estava em cache do utilizador anterior
          queryClient.clear();
          username = handoff.username;
        }
      }

      if (username) setUser({ username });
      setIsLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('login', {
        body: { username, password },
      });
      if (error || !data?.access_token || !data?.refresh_token) return false;

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionError) return false;

      setUser({ username: data.username });
      return true;
    } catch {
      return false;
    }
  };

  const logout = () => {
    // Sai também do picking, se lá estiver a mesma pessoa
    sairTambemDoPicking(localStorage, user?.username);
    // Without this the next person to log in on the same phone is shown the
    // previous session's cached data until a refetch happens to land.
    queryClient.clear();
    setUser(null);
    localStorage.removeItem('warehouse_user');
    supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};
