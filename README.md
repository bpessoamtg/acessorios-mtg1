# Gestão de Acessórios MTG1_Exp

Gestão de stock e movimentação de acessórios no parque MTG1. Réplica local da app
originalmente construída no Lovable — mesmo código, mesma base de dados Supabase,
agora a correr fora do Lovable.

- **Origem do código:** export Lovable em `G:\usr\dl\EXPEDIÇÃO\Braços\App gestão partque acessórios`
- **Supabase (projeto):** `cjqnidiydxpjxdgfphit`
- **Stack:** Vite 8 + React 18 + TypeScript + Tailwind + shadcn/ui + Supabase

---

## Arrancar

```bash
npm install
```

Depois preenche o `.env` (copia de `.env.example`) com a chave do Supabase:

| Variável | Onde obter |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → **Project URL** |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API → **anon / publishable key** |

Dashboard: https://supabase.com/dashboard/project/cjqnidiydxpjxdgfphit

```bash
npm run dev     # http://localhost:8080
npm run build   # produção → dist/
```

> Sem a chave preenchida a app arranca em ecrã branco — o cliente Supabase
> rebenta no arranque. É o único passo em falta para ficar 100% operacional.

---

## Deploy (GitHub Pages)

A app está publicada em **https://bpessoamtg.github.io/acessorios-mtg1/**
(repo `bpessoamtg/acessorios-mtg1`, público — o Pages não serve repos privados
no plano gratuito).

Qualquer `push` para `main` dispara `.github/workflows/deploy.yml`, que faz o
build e publica. Não há passo manual.

As variáveis do Supabase entram no build como **secrets do repositório**:

```bash
gh secret set VITE_SUPABASE_URL --body "https://cjqnidiydxpjxdgfphit.supabase.co"
gh secret set VITE_SUPABASE_PUBLISHABLE_KEY --body "<a-chave-anon>"
```

Depois de mudar um secret é preciso relançar o workflow — os secrets só são
lidos no momento do build:

```bash
gh workflow run deploy.yml
```

Duas coisas que o deploy em subdiretório obriga e já estão tratadas:
o `BASE_PATH` passado ao Vite (derivado do nome do repo) e a cópia
`index.html` → `404.html`, que é como o Pages deixa o React Router encaminhar
rotas que não são ficheiros reais.

---

## Identidade visual

Dois ficheiros em `public/`, com papéis diferentes de propósito:

| Ficheiro | Onde aparece |
|---|---|
| `logo.png` (512×512) | separador do browser (favicon) e ecrã de login |
| `icon-app.png` (256×256) | ícone do atalho no telemóvel (`apple-touch-icon` + manifest) |

No login o logótipo entra como `<img>` e não dentro de um quadrado `bg-primary`:
é azul sobre transparente e sobre fundo azul desapareceria.

O `icon-app.png` está declarado como `any` **e** `maskable`. Sendo uma foto
quadrada sem transparência, o Android mostra-a a sangrar em vez de a encaixar
num círculo branco.

O `manifest.webmanifest` é o que torna a app instalável — sem ele, "Adicionar
ao ecrã principal" no Android cria um marcador com ícone genérico em vez de um
atalho de aplicação.

---

## Utilizadores e perfis

O login não usa email/password do Supabase Auth diretamente. A edge function
`supabase/functions/login` valida um **PIN** contra `app_users` (hash bcrypt via
`verify_app_user`), provisiona um utilizador Auth interno e devolve a sessão.

| Utilizador | Perfil (`app_metadata.role`) | Acesso |
|---|---|---|
| `Admin` | `admin` | tudo + separador Mensagens |
| `Carmona` | `operator` | movimento, pesquisa, stock, histórico |
| `Deepak` | `operator` | idem (interface em inglês — ver `src/lib/i18n.ts`) |
| `inventario` | `inventory` | apenas separador Inventário |

As políticas RLS leem o perfil do JWT (`auth.jwt() -> 'app_metadata' ->> 'role'`).

---

## Estrutura

```
src/
├── pages/
│   ├── Index.tsx         # router: Login ou Dashboard
│   ├── Login.tsx         # seleção de utilizador + PIN
│   └── Dashboard.tsx     # shell com nav bar inferior
├── components/tabs/
│   ├── MovementTab.tsx   # entrada / saída / transferência (núcleo da app)
│   ├── SearchTab.tsx     # procurar modelo → onde está
│   ├── StockTab.tsx      # stock agregado
│   ├── HistoryTab.tsx    # histórico de movimentos
│   ├── InventoryTab.tsx  # contagem física vs sistema
│   └── MessagesTab.tsx   # notificações de correção (só Admin)
├── hooks/
│   ├── useFieldOptions.ts  # modelos (BD), cestas e fiadas (constantes)
│   └── useCestaContents.ts # o que está numa cesta
├── lib/constants.ts      # MTG1_CB001..500, fiadas A01..D05, RAMPA/CORREDOR/COBERTO
└── integrations/supabase/
```

### Tabelas

| Tabela | Papel |
|---|---|
| `stock_items` | estado atual: modelo × cesta × fiada → quantidade |
| `movements` | histórico imutável (entrada / saída / transferência / estorno) |
| `model_sap_lookup` | modelo → código SAP |
| `inventory_audit` | contagem física vs sistema |
| `admin_notifications` | avisos de correção de stock para o Admin |
| `app_users` | PINs (só service role) |

Migrações em `supabase/migrations/` — histórico completo, incluindo o
endurecimento de RLS (de "anyone can" para políticas por perfil).

---

## Regras de negócio a reter

- **Modelos genéricos** (`CIBR0000G`, `CIDIV000G`, `CITR0000G`) exigem OV de
  7 dígitos, guardada em `notas` como `OV:0000000`.
- **Confirmação de stock:** antes de gravar, a app mostra o stock resultante e
  pergunta se bate certo. Se o operador corrigir, grava o valor real **e** cria
  uma notificação para o Admin.
- Linhas de `stock_items` com quantidade 0 são apagadas, não mantidas a zero.
- O `cod_sap` é preenchido automaticamente a partir de `model_sap_lookup`.

---

## Notas da migração para local

O que veio do export tal e qual: `src/`, `supabase/`, configs de build.
O que foi acrescentado aqui: `.gitignore`, `.env` / `.env.example`,
`eslint.config.js`, `public/` (favicon, robots), `.claude/launch.json`, este README.

Ficou de fora do export do Lovable e ainda não foi reposto:
- `vitest.config.ts` e a pasta `src/test/` (o `package.json` tem scripts `test`
  mas não há testes nem config)
- `playwright.config.ts`

`src/integrations/supabase/previewAuthStorage.ts` é específico do preview do
Lovable; fora desse ambiente cai automaticamente em `localStorage`. Pode ser
removido quando o Lovable deixar de ser usado.
