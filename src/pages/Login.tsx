import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { getTranslations } from '@/lib/i18n';

const USERNAMES = ['Carmona', 'Deepak', 'Admin', 'inventario'];

const Login = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const t = getTranslations(username);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) {
      toast.error(t.invalidCredentials);
      return;
    }
    setIsLoading(true);
    const success = await login(username, password);
    setIsLoading(false);
    if (!success) {
      toast.error(t.invalidCredentials);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-xl border-border/50">
        <CardHeader className="text-center pb-2">
          {/* O logótipo é azul sobre transparente — sobre fundo primary desaparecia. */}
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Metalogalva"
            width={64}
            height={64}
            className="mx-auto w-16 h-16 mb-4"
          />
          <h1 className="text-2xl font-bold text-foreground">{t.loginTitle}</h1>
          <p className="text-muted-foreground text-sm">{t.loginSubtitle}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-foreground">{t.userLabel}</Label>
              <Select value={username} onValueChange={setUsername}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder={t.userPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {USERNAMES.map((u) => (
                    <SelectItem key={u} value={u} className="text-base">
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground">{t.passwordLabel}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••"
                  className="h-12 text-base pr-12"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={isLoading}>
              {isLoading ? t.loggingIn : t.loginBtn}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
