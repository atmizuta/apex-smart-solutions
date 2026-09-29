# SSO "Apex Mind": bolinha no painel → login automático no pratica-vendas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O consultor clica na bolinha "Apex Mind" (canto inferior direito do painel de clientes) e é levado, já autenticado, para o pratica-vendas — sem digitar login/senha de novo.

**Architecture:** Handoff por token assinado (HS256) de uso único e vida curta (60s). O painel (já logado via Supabase Auth) chama uma Edge Function nova que verifica a sessão, monta e assina o token com um segredo compartilhado, e devolve uma URL. O painel abre essa URL em nova aba. O pratica-vendas verifica o token com o mesmo segredo, acha ou cria a conta do consultor pelo `usuario` (mesmo nome de usuário do painel), cria a sessão normal (reaproveitando o mecanismo de login já existente) e redireciona pra `/cenarios`.

**Tech Stack:** `jose` (JWT, já usado nos dois lados — `pratica-vendas` no Node/Next, e via `npm:jose` no Deno da Edge Function), `postgres` (driver do pratica-vendas), Supabase Edge Functions (Deno) no projeto `apex` (`mdgfboijyqfkggcrhptn`), Supabase Postgres no projeto `apex-pratica-vendas` (`ifezqcrzfxlgpkxohhdh`).

**Spec:** `docs/superpowers/specs/2026-09-29-sso-painel-pratica-vendas-design.md`

## Global Constraints

- `SSO_SHARED_SECRET` nunca aparece em código versionado nem em HTML público — só como variável de ambiente nos dois servidores (Edge Function e pratica-vendas).
- Token de SSO expira em 60 segundos e é de uso único (checagem de `jti`).
- Nenhuma alteração em `crm/painel_clientes_apex.html` diretamente — só em `crm/_template.html`, seguido de `python3 build_painel.py` pra regenerar (trava de segurança já existente no script).
- Conta autoprovisionada no pratica-vendas via SSO recebe senha aleatória inutilizável (não dá pra logar nela por usuário/senha).
- Mapeamento de papel: `role` do painel `admin` ou `supervisor` → `papel` do pratica-vendas `admin`; `consultor` → `consultor`.
- Simplificação decidida na hora de planejar (vs. o spec original): em vez de uma coluna nova `painel_username`, o vínculo é direto pela coluna `usuarios.usuario` já existente (evita duplicar o mesmo dado em duas colunas).

## Review Focus

- Token com assinatura válida mas expirado (>60s) — deve ser rejeitado, não só "assinatura ok, segue o jogo".
- Mesmo token usado duas vezes (replay: usuário abre o link duas vezes, ou alguém copia a URL) — a segunda tentativa deve falhar, mesmo dentro da janela de 60s.
- Consultor cujo `usuario` já existe no pratica-vendas (ex.: "rafael", criado manualmente antes) — o SSO deve entrar nessa conta existente, não criar uma duplicada nem dar erro de conflito.
- `SSO_SHARED_SECRET` ausente ou diferente entre os dois lados — deve falhar de forma clara (erro no log, redirecionamento pro login com aviso), nunca aceitar um token sem poder verificar a assinatura.
- Painel chamando a function sem sessão válida (usuário deslogado, token expirado do próprio Supabase Auth) — a function deve recusar antes de sequer montar um token de SSO.

---

## Arquivos

- Modificar: `pratica-vendas/db/schema.sql` — tabela `sso_tokens_usados`
- Criar: `pratica-vendas/db/ssoTokensUsados.ts` — controle de reuso de `jti`
- Modificar: `pratica-vendas/db/usuarios.ts` — busca-ou-cria por `usuario`
- Criar: `pratica-vendas/lib/auth/ssoToken.ts` — verificação do token HS256
- Criar: `pratica-vendas/lib/auth/ssoToken.test.ts`
- Criar: `pratica-vendas/app/api/auth/sso/route.ts` — orquestra verificação + sessão + redirect
- Modificar: `pratica-vendas/app/login/page.tsx` — mostra erro quando `?erro=sso_invalido`
- Modificar: `pratica-vendas/.env.example` — `SSO_SHARED_SECRET`
- Criar: `crm/edge_function_sso_pratica.ts` — Edge Function (Deno)
- Modificar: `crm/_template.html` — bolinha "Apex Mind" + handler JS

---

### Task 1: Tabela de controle de tokens já usados

**Files:**
- Modify: `pratica-vendas/db/schema.sql`
- Create: `pratica-vendas/db/ssoTokensUsados.ts`

**Interfaces:**
- Produces: `jtiJaUsado(jti: string): Promise<boolean>`, `registrarJtiUsado(jti: string): Promise<void>` — usados pela Task 5.

- [ ] **Step 1: Adicionar a tabela no schema**

Em `pratica-vendas/db/schema.sql`, adicionar ao final do arquivo:

```sql
-- Guarda o "jti" (id único) de cada token de SSO já consumido — impede que
-- a mesma URL de login automático seja usada duas vezes dentro da janela de
-- validade de 60s (Review Focus: replay do token).
create table if not exists sso_tokens_usados (
  jti text primary key,
  usado_em timestamptz not null default now()
);
```

- [ ] **Step 2: Aplicar a migração no banco real (projeto `apex-pratica-vendas`, id `ifezqcrzfxlgpkxohhdh`)**

Usar a tool de migração do Supabase (`apply_migration`) com esse mesmo SQL, nome da migração `criar_sso_tokens_usados`.

- [ ] **Step 3: Criar `db/ssoTokensUsados.ts`**

```typescript
import { sql } from './client';

// jti = "JWT ID", um identificador aleatório único por token de SSO emitido
// pela Edge Function do painel. Sem essa checagem, copiar/reabrir a mesma
// URL de login automático (ex.: histórico do navegador) logaria de novo
// silenciosamente, mesmo com o token ainda dentro dos 60s de validade.
export async function jtiJaUsado(jti: string): Promise<boolean> {
  const linhas = await sql<{ jti: string }[]>`select jti from sso_tokens_usados where jti = ${jti}`;
  return linhas.length > 0;
}

export async function registrarJtiUsado(jti: string): Promise<void> {
  await sql`insert into sso_tokens_usados (jti) values (${jti}) on conflict (jti) do nothing`;
}
```

- [ ] **Step 4: Commit**

```bash
git add pratica-vendas/db/schema.sql pratica-vendas/db/ssoTokensUsados.ts
git commit -m "Adiciona controle de reuso de token SSO (sso_tokens_usados)"
```

---

### Task 2: Verificação do token de SSO

**Files:**
- Create: `pratica-vendas/lib/auth/ssoToken.ts`
- Test: `pratica-vendas/lib/auth/ssoToken.test.ts`

**Interfaces:**
- Consumes: nenhuma (módulo isolado, só depende de `jose` e `process.env.SSO_SHARED_SECRET`).
- Produces: `verificarTokenSso(token: string): Promise<DadosTokenSso | null>` onde `DadosTokenSso = { sub: string; nome: string; papel: 'consultor' | 'admin'; jti: string }` — usado pela Task 5.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// pratica-vendas/lib/auth/ssoToken.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { verificarTokenSso } from './ssoToken';

const SEGREDO_TESTE = 'segredo-de-teste-com-pelo-menos-32-bytes-aa';

async function assinarTokenTeste(payload: Record<string, unknown>, opts?: { expiraEm?: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(opts?.expiraEm ?? '60s')
    .sign(new TextEncoder().encode(SEGREDO_TESTE));
}

describe('verificarTokenSso', () => {
  beforeEach(() => {
    process.env.SSO_SHARED_SECRET = SEGREDO_TESTE;
  });

  it('retorna os dados do payload pra um token válido', async () => {
    const token = await assinarTokenTeste({ sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' });
    const dados = await verificarTokenSso(token);
    expect(dados).toEqual({ sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' });
  });

  it('retorna null pra token expirado', async () => {
    const token = await assinarTokenTeste(
      { sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' },
      { expiraEm: '-1s' }
    );
    const dados = await verificarTokenSso(token);
    expect(dados).toBeNull();
  });

  it('retorna null pra token assinado com segredo errado', async () => {
    const token = await new SignJWT({ sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('60s')
      .sign(new TextEncoder().encode('outro-segredo-completamente-diferente-aa'));
    const dados = await verificarTokenSso(token);
    expect(dados).toBeNull();
  });

  it('retorna null se o payload não tiver os campos esperados', async () => {
    const token = await assinarTokenTeste({ sub: 'joao' }); // falta nome, papel, jti
    const dados = await verificarTokenSso(token);
    expect(dados).toBeNull();
  });

  it('lança erro se SSO_SHARED_SECRET não estiver configurada', async () => {
    delete process.env.SSO_SHARED_SECRET;
    const token = await assinarTokenTeste({ sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' });
    await expect(verificarTokenSso(token)).rejects.toThrow('SSO_SHARED_SECRET');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd pratica-vendas && npx vitest run lib/auth/ssoToken.test.ts`
Expected: FAIL — `Cannot find module './ssoToken'`

- [ ] **Step 3: Implementar `ssoToken.ts`**

```typescript
import { jwtVerify } from 'jose';

function obterSegredo(): Uint8Array {
  const segredo = process.env.SSO_SHARED_SECRET;
  if (!segredo) throw new Error('SSO_SHARED_SECRET não configurada — veja .env.example.');
  return new TextEncoder().encode(segredo);
}

export type DadosTokenSso = { sub: string; nome: string; papel: 'consultor' | 'admin'; jti: string };

// Verifica o token de handoff emitido pela Edge Function do painel. jwtVerify
// já rejeita token expirado (baseado no "exp" do JWT) e assinatura inválida —
// só precisamos validar o formato do payload por cima.
export async function verificarTokenSso(token: string): Promise<DadosTokenSso | null> {
  try {
    const { payload } = await jwtVerify(token, obterSegredo());
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.nome !== 'string' ||
      (payload.papel !== 'consultor' && payload.papel !== 'admin') ||
      typeof payload.jti !== 'string'
    ) {
      return null;
    }
    return { sub: payload.sub, nome: payload.nome, papel: payload.papel, jti: payload.jti };
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes('SSO_SHARED_SECRET')) throw erro;
    return null;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd pratica-vendas && npx vitest run lib/auth/ssoToken.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add pratica-vendas/lib/auth/ssoToken.ts pratica-vendas/lib/auth/ssoToken.test.ts
git commit -m "Adiciona verificação do token de SSO (HS256, jose)"
```

---

### Task 3: Busca-ou-cria usuário por username

**Files:**
- Modify: `pratica-vendas/db/usuarios.ts`

**Interfaces:**
- Consumes: `gerarHashSenha` de `pratica-vendas/lib/auth/senha.ts` (já existe).
- Produces: `buscarOuCriarUsuarioPorUsername(usuario: string, nome: string, papel: 'consultor' | 'admin'): Promise<Usuario>` — usado pela Task 5.

- [ ] **Step 1: Adicionar a função em `db/usuarios.ts`**

```typescript
import { gerarHashSenha } from '../lib/auth/senha';
```

(adicionar esse import no topo do arquivo, junto ao `import { sql } from './client';`)

```typescript
// Usado pelo login automático via SSO (painel -> pratica-vendas): acha a
// conta existente pelo mesmo "usuario" do painel, ou cria uma nova na
// primeira vez. A senha gerada é aleatória e nunca é informada a ninguém —
// essa conta só entra via SSO, não por usuário/senha manual.
export async function buscarOuCriarUsuarioPorUsername(
  usuario: string,
  nome: string,
  papel: 'consultor' | 'admin'
): Promise<Usuario> {
  const existente = await buscarUsuarioPorLogin(usuario);
  if (existente) return existente;

  const senhaAleatoriaInutilizavel = await gerarHashSenha(crypto.randomUUID());
  const linhas = await sql<LinhaUsuario[]>`
    insert into usuarios (nome, usuario, senha_hash, papel)
    values (${nome}, ${usuario}, ${senhaAleatoriaInutilizavel}, ${papel})
    returning id, nome, usuario, senha_hash, papel
  `;
  return mapearUsuario(linhas[0]);
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd pratica-vendas && npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add pratica-vendas/db/usuarios.ts
git commit -m "Adiciona busca-ou-cria de usuário por username (autoprovisionamento SSO)"
```

---

### Task 4: Rota de handoff `/api/auth/sso`

**Files:**
- Create: `pratica-vendas/app/api/auth/sso/route.ts`
- Modify: `pratica-vendas/app/login/page.tsx`
- Modify: `pratica-vendas/.env.example`

**Interfaces:**
- Consumes: `verificarTokenSso` (Task 2), `jtiJaUsado`/`registrarJtiUsado` (Task 1), `buscarOuCriarUsuarioPorUsername` (Task 3), `criarTokenSessao` de `lib/auth/sessao.ts` (já existe, assinatura `criarTokenSessao(dados: { usuarioId: string; papel: 'consultor' | 'admin' }): Promise<string>`).

- [ ] **Step 1: Criar a rota**

```typescript
// pratica-vendas/app/api/auth/sso/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSso } from '@/lib/auth/ssoToken';
import { jtiJaUsado, registrarJtiUsado } from '@/db/ssoTokensUsados';
import { buscarOuCriarUsuarioPorUsername } from '@/db/usuarios';
import { criarTokenSessao } from '@/lib/auth/sessao';

// Handoff de login automático vindo da bolinha "Apex Mind" do painel: o
// consultor abre esta URL numa aba nova, já com o token assinado pela Edge
// Function do painel. Qualquer falha aqui redireciona pro /login com um
// aviso — nunca mostra um JSON cru numa aba que o usuário só vê abrir.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/login?erro=sso_invalido', req.url));
  }

  const dados = await verificarTokenSso(token);
  if (!dados) {
    return NextResponse.redirect(new URL('/login?erro=sso_invalido', req.url));
  }

  if (await jtiJaUsado(dados.jti)) {
    return NextResponse.redirect(new URL('/login?erro=sso_expirado', req.url));
  }
  await registrarJtiUsado(dados.jti);

  const usuario = await buscarOuCriarUsuarioPorUsername(dados.sub, dados.nome, dados.papel);

  const sessaoToken = await criarTokenSessao({ usuarioId: usuario.id, papel: usuario.papel });
  const resposta = NextResponse.redirect(new URL('/cenarios', req.url));
  resposta.cookies.set('sessao', sessaoToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return resposta;
}
```

- [ ] **Step 2: Mostrar o erro na tela de login**

Ler o arquivo atual antes de editar: `pratica-vendas/app/login/page.tsx`. Adicionar leitura do parâmetro de busca e um mapeamento de mensagens, mostrando junto ao restante da UI de erro já existente (mesmo padrão visual do `erro` que já existe no componente — reaproveitar o estado `erro` já existente em vez de criar um novo):

```typescript
import { useRouter, useSearchParams } from 'next/navigation';
```

(trocar o import de `useRouter` sozinho por esse, incluindo `useSearchParams`)

No corpo do componente, logo após `const router = useRouter();`:

```typescript
  const searchParams = useSearchParams();
  useEffect(() => {
    const erroSso = searchParams.get('erro');
    if (erroSso === 'sso_invalido') setErro('Não foi possível confirmar seu acesso automático. Faça login normalmente.');
    if (erroSso === 'sso_expirado') setErro('Esse link de acesso automático já foi usado ou expirou. Faça login normalmente.');
  }, [searchParams]);
```

(adicionar `import { useEffect } from 'react';` junto ao `useState` já importado, se ainda não houver)

- [ ] **Step 3: Documentar a variável de ambiente**

Em `pratica-vendas/.env.example`, adicionar:

```
SSO_SHARED_SECRET=gerar-com-openssl-rand-hex-32-igual-nos-dois-lados
```

- [ ] **Step 4: Verificar tipos**

Run: `cd pratica-vendas && npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 5: Testar manualmente com um token forjado (ambiente local)**

```bash
cd pratica-vendas
node -e "
const { SignJWT } = require('jose');
(async () => {
  const token = await new SignJWT({ sub: 'teste.sso', nome: 'Teste SSO', papel: 'consultor', jti: crypto.randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('60s')
    .sign(new TextEncoder().encode(process.env.SSO_SHARED_SECRET));
  console.log(token);
})();
"
```

Copiar o token impresso, abrir `http://localhost:3000/api/auth/sso?token=<token>` no navegador — deve redirecionar pra `/cenarios` já logado como "Teste SSO". Abrir a mesma URL de novo — deve redirecionar pro `/login` com o aviso de link expirado/já usado (Review Focus: replay do token).

Gerar um segundo token com o **mesmo** `sub` (ex.: `teste.sso` de novo) e abrir sua URL — deve entrar na **mesma** conta já criada (conferir no admin do pratica-vendas, ou direto no banco, que só existe uma linha em `usuarios` com `usuario = 'teste.sso'`), não uma segunda (Review Focus: usuário já existente não deve duplicar).

- [ ] **Step 6: Commit**

```bash
git add pratica-vendas/app/api/auth/sso/route.ts pratica-vendas/app/login/page.tsx pratica-vendas/.env.example
git commit -m "Adiciona rota de handoff SSO /api/auth/sso"
```

---

### Task 5: Edge Function no painel (`sso-pratica-vendas`)

**Files:**
- Create: `crm/edge_function_sso_pratica.ts`

**Interfaces:**
- Consumes: tabela `public.profiles` (`id`, `nome`, `username`, `role`) do projeto Supabase `apex`.
- Produces: endpoint que devolve `{ url: string }` — consumido pela Task 6 via `sb.functions.invoke('sso-pratica-vendas')`.

- [ ] **Step 1: Escrever a Edge Function**

```typescript
// ============================================================
// Edge Function: sso-pratica-vendas
// ------------------------------------------------------------
// Gera um token de login automático (60s, uso único) pro consultor logado
// no painel abrir o pratica-vendas já autenticado — clique na bolinha
// "Apex Mind". Não recebe nada no corpo: usa só a sessão Supabase de quem
// chama (Authorization já vem automático via sb.functions.invoke).
//
// COMO PUBLICAR (pelo painel do Supabase, sem precisar instalar nada):
// 1. No painel do projeto "apex", vá em "Edge Functions" > "Deploy a new function".
// 2. Nome da função: sso-pratica-vendas
// 3. Cole todo o conteúdo deste arquivo no editor e clique em "Deploy".
// 4. Em "Secrets" da function, adicione SSO_SHARED_SECRET e PRATICA_VENDAS_URL
//    (a mesma SSO_SHARED_SECRET configurada no ambiente do pratica-vendas).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT } from "npm:jose@5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SSO_SHARED_SECRET = Deno.env.get("SSO_SHARED_SECRET")!;
const PRATICA_VENDAS_URL = Deno.env.get("PRATICA_VENDAS_URL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado." }, 401);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: perfil, error: perfilErr } = await admin
      .from("profiles")
      .select("nome, username, role")
      .eq("id", userData.user.id)
      .single();
    if (perfilErr || !perfil) return json({ error: "Perfil não encontrado." }, 404);

    // painel tem 3 papéis (admin/supervisor/consultor), pratica-vendas só tem 2 —
    // admin e supervisor entram como admin lá (mesma visibilidade ampla que já têm aqui).
    const papel = perfil.role === "consultor" ? "consultor" : "admin";

    const token = await new SignJWT({
      sub: perfil.username,
      nome: perfil.nome,
      papel,
      jti: crypto.randomUUID(),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(SSO_SHARED_SECRET));

    return json({ url: `${PRATICA_VENDAS_URL}/api/auth/sso?token=${token}` }, 200);
  } catch (e) {
    return json({ error: "Erro inesperado: " + (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
```

- [ ] **Step 2: Commit**

```bash
git add crm/edge_function_sso_pratica.ts
git commit -m "Adiciona Edge Function sso-pratica-vendas (emite token de handoff)"
```

*(deploy de verdade acontece na Task 7, junto com a configuração das variáveis de ambiente)*

---

### Task 6: Bolinha "Apex Mind" no painel

**Files:**
- Modify: `crm/_template.html`

**Interfaces:**
- Consumes: `sb` (cliente Supabase já criado no template), `mostrarAviso(msg, tipo)` (já existe), `mensagemErroFuncao(error, data)` (já existe).

- [ ] **Step 1: Adicionar o CSS da bolinha**

Antes de fechar a tag `</style>` (perto de onde `#apexToasts` é definido, linha ~398), adicionar:

```css
#apexMindBubble{
  position:fixed; right:var(--space-6); bottom:100px; z-index:95;
  width:56px; height:56px; border-radius:50%;
  background:linear-gradient(135deg, var(--c-sinal) 0%, var(--c-bordo) 100%);
  display:flex; align-items:center; justify-content:center;
  cursor:pointer; border:none; box-shadow:0 8px 24px -8px rgba(82,12,7,.55);
  transition:transform .15s ease;
}
#apexMindBubble:hover{ transform:scale(1.06); }
#apexMindBubble:active{ transform:scale(0.97); }
#apexMindBubble svg{ width:26px; height:26px; }
#apexMindBubble .apxMindLabel{
  position:absolute; right:64px; bottom:16px; white-space:nowrap;
  background:var(--c-bordo); color:#fff; font-size:12.5px; font-weight:600;
  padding:6px 12px; border-radius:8px; opacity:0; pointer-events:none;
  transition:opacity .15s ease;
}
#apexMindBubble:hover .apxMindLabel{ opacity:1; }
```

(usar as variáveis `--c-sinal`, `--c-bordo` e `--space-6` já existentes no template — não inventar cores novas)

- [ ] **Step 2: Adicionar o HTML da bolinha**

Logo após `<div id="app">` (linha ~452, antes do `<aside class="sidebar"...>`), adicionar:

```html
<button id="apexMindBubble" type="button" title="Apex Mind — Praticar vendas com IA" aria-label="Abrir Apex Mind">
  <span class="apxMindLabel">Apex Mind</span>
  <svg viewBox="0 0 100 86" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M50 3 L4 82 H50 Z" fill="#ffffff" fill-opacity="0.92"/>
    <path d="M50 3 L96 82 H50 Z" fill="#ffffff" fill-opacity="0.7"/>
    <path d="M50 40 L28 82 H72 Z" fill="#ffffff" fill-opacity="0.5"/>
  </svg>
</button>
```

- [ ] **Step 3: Adicionar o handler de clique**

Perto de onde `sb.functions.invoke('sync-leads')` é chamado (pra manter o mesmo padrão), adicionar:

```javascript
document.getElementById('apexMindBubble').addEventListener('click', async () => {
  const btn = document.getElementById('apexMindBubble');
  btn.disabled = true;
  try {
    const { data, error } = await sb.functions.invoke('sso-pratica-vendas');
    if (error || !data || !data.url) {
      mostrarAviso(await mensagemErroFuncao(error, data), 'erro');
      return;
    }
    window.open(data.url, '_blank');
  } catch (e) {
    mostrarAviso('Não foi possível abrir a Apex Mind agora. Tente de novo.', 'erro');
  } finally {
    btn.disabled = false;
  }
});
```

- [ ] **Step 4: Rebuild local pra conferir visualmente**

```bash
cd crm
python3 build_painel.py
```

Abrir `painel_clientes_apex.html` localmente (ou onde já é servido em dev), logar, conferir que a bolinha aparece no canto inferior direito, acima da área de toasts, com o triângulo Apex.

- [ ] **Step 5: Commit**

```bash
git add crm/_template.html crm/painel_clientes_apex.html
git commit -m "Adiciona bolinha Apex Mind no painel (abre pratica-vendas via SSO)"
```

---

### Task 7: Deploy e configuração de ambiente (produção)

**Files:** nenhum arquivo novo — só configuração.

- [ ] **Step 1: Gerar a chave secreta compartilhada**

```bash
openssl rand -hex 32
```

Guardar esse valor — vai ser usado nos dois lados, nunca commitado.

- [ ] **Step 2: Configurar no pratica-vendas**

Adicionar `SSO_SHARED_SECRET=<valor gerado>` no `.env.local` (dev) e nas variáveis de ambiente do deploy de produção do pratica-vendas, quando existir.

- [ ] **Step 3: Deploy da Edge Function no projeto `apex` (produção)**

Usar a tool de deploy de Edge Function do Supabase (`deploy_edge_function`) com:
- `project_id`: `mdgfboijyqfkggcrhptn`
- nome: `sso-pratica-vendas`
- conteúdo: `crm/edge_function_sso_pratica.ts`

- [ ] **Step 4: Configurar secrets da Edge Function**

No painel do Supabase do projeto `apex` (Edge Functions > sso-pratica-vendas > Secrets), adicionar:
- `SSO_SHARED_SECRET` = mesmo valor do Step 1
- `PRATICA_VENDAS_URL` = URL pública do pratica-vendas (ex.: `https://pratica.apexsolutions.com.br` — **atualizar quando o pratica-vendas for publicado**; até lá, pode apontar pra uma URL de teste/túnel se Rafael quiser validar o fluxo completo antes do deploy final)

- [ ] **Step 5: Teste end-to-end**

Logar no painel de verdade, clicar na bolinha Apex Mind, confirmar que abre o pratica-vendas numa aba nova já logado em `/cenarios`, com o nome certo aparecendo na barra superior.

Deslogar do painel (ou abrir o DevTools e chamar `sb.auth.signOut()` no console) e tentar invocar a function direto (`sb.functions.invoke('sso-pratica-vendas')` no console) — deve devolver erro 401 "Sessão inválida.", nunca um token válido (Review Focus: chamada sem sessão autenticada).

---

## Nota de dependência

O fluxo completo só funciona de ponta a ponta em produção quando o `pratica-vendas` estiver publicado num domínio real (`PRATICA_VENDAS_URL` da Task 7 precisa ser alcançável pelo navegador de quem usa o painel). Até lá, as Tasks 1–6 são testáveis e verificáveis localmente (rodando o pratica-vendas em `localhost:3000` e testando a Edge Function apontando pra lá).
