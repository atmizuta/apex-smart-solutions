# SSO: bolinha "Apex Mind" no painel → login automático no pratica-vendas

## Contexto e objetivo

O painel de clientes (`crm/_template.html`, deploy em `painel_clientes_apex.html`, projeto Supabase `apex` / `mdgfboijyqfkggcrhptn`) e o app de prática de vendas (`pratica-vendas/`, projeto Supabase `apex-pratica-vendas` / `ifezqcrzfxlgpkxohhdh`) são dois sistemas com bancos de autenticação completamente separados hoje.

Rafael quer um ponto de entrada único: uma bolinha flutuante no canto inferior direito do painel, nomeada **"Apex Mind"**, que o consultor clica para ser levado direto ao pratica-vendas — já autenticado, sem digitar login/senha de novo. No futuro essa bolinha vira a porta de entrada de um portal maior; por enquanto só precisa abrir o pratica-vendas logado.

Confirmado com Rafael: login automático de verdade (não é só reaproveitar a mesma senha em dois lugares), a bolinha abre o pratica-vendas em nova aba, e o nome da IA é "Apex Mind".

## Por que não um jeito mais simples

- **Duplicar usuário/senha nos dois sistemas**: mais simples, mas o consultor ainda digitaria login de novo — não é o que foi pedido.
- **Unificar os dois sistemas num único banco de autenticação**: resolveria de raiz, mas é uma migração de risco alto no painel de produção (dados reais de cliente, 26 perfis ativos) só para viabilizar esse atalho — desproporcional ao ganho agora.
- **Handoff por token assinado de uso único (escolhida)**: não migra nada existente, isola o risco numa peça nova e pequena (uma Edge Function), e os dois sistemas continuam podendo evoluir de forma independente.

## Desenho da solução

### Fluxo

1. Consultor já está logado no painel (sessão Supabase Auth válida no projeto `apex`).
2. Clica na bolinha "Apex Mind" → o JS do painel chama a nova Edge Function `sso-pratica-vendas` (projeto `apex`), enviando o access token da sessão Supabase atual no header `Authorization`.
3. A Edge Function:
   - Verifica o token com `supabase.auth.getUser(token)` (client Supabase com a **service role key**, nunca exposta ao navegador).
   - Busca o perfil em `public.profiles` (`nome`, `username`, `role`) pelo `id` do usuário autenticado. `role` no painel tem 3 valores confirmados: `admin`, `supervisor`, `consultor`; o pratica-vendas só tem dois papéis (`admin`/`consultor`) — mapeamento explícito: `admin` e `supervisor` → `admin` (mesma visibilidade ampla que já têm no painel), `consultor` → `consultor`.
   - Monta um payload `{ sub: username, nome, papel: role === 'consultor' ? 'consultor' : 'admin', jti: <uuid aleatório>, iat, exp: iat + 60s }`.
   - Assina esse payload em HS256 com `SSO_SHARED_SECRET` (variável de ambiente da function, nunca no HTML).
   - Retorna `{ url: "<PRATICA_VENDAS_URL>/api/auth/sso?token=<jwt>" }`.
4. O painel abre essa URL em nova aba (`window.open`).
5. O pratica-vendas, na rota nova `GET /api/auth/sso`:
   - Verifica a assinatura e a expiração do token com o **mesmo** `SSO_SHARED_SECRET` (variável de ambiente do pratica-vendas).
   - Rejeita se expirado, mal assinado, ou se o `jti` já foi usado antes (proteção contra reuso — guardar `jti`s usados numa tabela pequena com expiração, já que a janela é de 60s).
   - Busca `usuarios` por uma nova coluna `painel_username` (= `sub` do token). Se não existir, cria a conta automaticamente (`nome`, `papel`, `painel_username`, `senha_hash` com um valor aleatório inutilizável — essa conta só entra via SSO, não por senha).
   - Emite o cookie de sessão normal (reaproveita `lib/auth/sessao.ts`, o mesmo mecanismo do login manual).
   - Redireciona (302) para `/cenarios`.

### Peças novas

| Onde | O quê |
|---|---|
| `crm/edge_function_sso_pratica.ts` | Edge Function nova (mesmo padrão de `edge_function_create_user.ts`) |
| `crm/_template.html` | Bolinha "Apex Mind" (canto inferior direito) + handler JS que chama a function e abre a aba |
| Supabase `apex` (produção) | Variável de ambiente `SSO_SHARED_SECRET` na Edge Function |
| `pratica-vendas/app/api/auth/sso/route.ts` | Rota nova: verifica token, provisiona usuário, cria sessão, redireciona |
| `pratica-vendas/lib/auth/ssoToken.ts` | Verificação HS256 do token (usando `jose`, já é dependência do projeto) |
| `pratica-vendas/db/schema.sql` | Coluna nova `usuarios.painel_username text unique` |
| `pratica-vendas/db/` | Tabela pequena `sso_tokens_usados (jti text primary key, usado_em timestamptz)` para bloquear reuso |
| `pratica-vendas/.env.local` / ambiente de produção | Mesma `SSO_SHARED_SECRET` |

### Segurança

- `SSO_SHARED_SECRET` só existe em dois lugares server-side (a Edge Function e o servidor do pratica-vendas) — nunca no HTML público do painel nem no bundle do cliente do pratica-vendas.
- Token expira em 60 segundos e é de uso único (`jti` consumido na primeira verificação) — mesmo que alguém intercepte a URL, a janela de ataque é curta e de uso único.
- A Edge Function só assina um token depois de validar a sessão Supabase real do consultor — não aceita usuário/senha direto, só uma sessão já autenticada no painel.
- Conta autoprovisionada no pratica-vendas via SSO recebe uma senha aleatória inutilizável — não dá pra fazer login manual nela sem outro fluxo explícito (ex.: "esqueci minha senha", fora de escopo aqui).

### O que muda no painel de produção

- Único arquivo tocado no painel é `_template.html` (nunca o `painel_clientes_apex.html` gerado direto — sempre via `build_painel.py`, seguindo a trava de segurança que já existe nesse script).
- A Edge Function é um arquivo novo, deploy isolado — não altera nenhuma function existente.
- Antes de rodar `build_painel.py` de verdade em produção, testo a bolinha e o fluxo completo apontando pro pratica-vendas local, e mostro pra Rafael aprovar visualmente antes do rebuild final.

## Testes

- Unit: verificação do token (`ssoToken.ts`) — assinatura válida, expirado, `jti` reusado, `SSO_SHARED_SECRET` errado.
- Integração manual: fluxo completo painel → bolinha → Edge Function → nova aba → pratica-vendas logado em `/cenarios`, com consultor novo (autoprovisionamento) e consultor que já tem conta.

## Fora de escopo (por enquanto)

- Login manual sincronizado (usuário/senha iguais nos dois sistemas) — não é mais necessário, o SSO substitui essa necessidade.
- Fluxo de recuperação de senha para contas autoprovisionadas via SSO.
- Qualquer conteúdo do "portal maior" que a bolinha vai abrir no futuro — hoje ela só leva pro pratica-vendas.
