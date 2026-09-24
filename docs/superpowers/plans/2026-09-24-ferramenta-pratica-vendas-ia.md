# Ferramenta de Prática de Vendas com IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um app web onde o consultor pratica atendimento de lead com uma IA fazendo o papel do cliente (em cenários baseados em objeções reais), recebe nota e feedback automáticos ao final, e o Rafael acompanha a evolução de cada consultor ao longo do tempo.

**Architecture:** Next.js (App Router) na Vercel, com Postgres próprio (Vercel Postgres/Neon) e chamadas à API da Anthropic sempre feitas no servidor (rotas de API), nunca no navegador. Autenticação por usuário/senha com sessão em cookie assinado (JWT via `jose`, compatível com Edge Runtime do middleware).

**Tech Stack:** Next.js 14+ / TypeScript, Vitest (testes), `postgres` (porsager, cliente Postgres), `bcryptjs` (hash de senha), `jose` (sessão JWT), `@anthropic-ai/sdk` (Claude).

**Spec:** `docs/superpowers/specs/2026-09-24-ferramenta-pratica-vendas-ia-design.md`

## Global Constraints

- App **independente** do CRM do chefe do Rafael — banco de dados próprio, código próprio, nenhum arquivo em `apex-smart-solutions/crm` é tocado por este plano.
- A chave de API da Anthropic só existe como variável de ambiente no servidor (`.env.local` em dev, variável de ambiente da Vercel em produção) — nunca aparece em código, nunca é commitada, nunca é enviada ao navegador.
- Limite de 10 sessões de prática por consultor por dia (valor configurável, mas esse é o padrão).
- A rubrica de avaliação (Task 6) tem que espelhar exatamente as 6 regras da seção 8 da spec — não inventar critério novo nem remover nenhum dos seis.
- Cenários iniciais são exatamente os 5 da seção 7 da spec (preço questionado, sumiu, CNPJ inválido, sem viabilidade, lead frio) — não adicionar nem remover cenário nesta v1.

## Review Focus

- Mensagem vazia (ou só espaço) enviada no chat não pode disparar uma chamada à IA nem travar a conversa — precisa ser rejeitada antes de gastar uma chamada de API.
- Clicar em "encerrar sessão" duas vezes (ou duas abas abertas na mesma sessão) não pode gerar duas avaliações/notas para a mesma sessão — a segunda tentativa deve ser rejeitada ou devolver o resultado já salvo, nunca chamar a IA de novo.
- Consultor que já bateu o limite diário de sessões recebe uma mensagem clara ("você já usou as 10 práticas de hoje") ao tentar iniciar uma nova — não um erro genérico de servidor.
- Falha ou timeout da API da Anthropic (durante o roleplay ou durante a avaliação final) não pode deixar a sessão "presa" sem resposta — o consultor precisa de um caminho claro pra tentar de novo, e uma avaliação que falhou não conta como sessão consumida do limite diário.
- Login com usuário inexistente ou senha errada devolve sempre a mesma mensagem genérica ("usuário ou senha inválidos") — nunca revela qual dos dois estava errado.

---

## Task 1: Scaffold do projeto e harness de teste

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/package.json`
- Create: `apex-smart-solutions/pratica-vendas/tsconfig.json`
- Create: `apex-smart-solutions/pratica-vendas/vitest.config.ts`
- Create: `apex-smart-solutions/pratica-vendas/next.config.mjs`
- Create: `apex-smart-solutions/pratica-vendas/.env.example`
- Create: `apex-smart-solutions/pratica-vendas/.gitignore`
- Create: `apex-smart-solutions/pratica-vendas/lib/_smoke.ts`
- Test: `apex-smart-solutions/pratica-vendas/lib/_smoke.test.ts`

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "pratica-vendas-apex",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "postgres": "^3.4.4",
    "bcryptjs": "^2.4.3",
    "jose": "^5.9.0",
    "@anthropic-ai/sdk": "^0.27.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/bcryptjs": "^2.4.6",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Criar `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Criar `next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 5: Criar `.env.example`**

```
DATABASE_URL=postgres://usuario:senha@host:5432/banco
ANTHROPIC_API_KEY=sk-ant-...
SESSION_SECRET=uma-string-aleatoria-longa-gerada-com-openssl-rand-hex-32
```

- [ ] **Step 6: Criar `.gitignore`**

```
node_modules/
.next/
.env.local
.env
```

- [ ] **Step 7: Escrever o arquivo de exemplo `lib/_smoke.ts`**

```typescript
export function somar(a: number, b: number): number {
  return a + b;
}
```

- [ ] **Step 8: Escrever o teste `lib/_smoke.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { somar } from './_smoke';

describe('somar', () => {
  it('soma dois números', () => {
    expect(somar(2, 3)).toBe(5);
  });
});
```

- [ ] **Step 9: Instalar dependências e rodar os testes**

Run: `cd apex-smart-solutions/pratica-vendas && npm install && npm test`
Expected: `Test Files 1 passed`, `Tests 1 passed`

- [ ] **Step 10: Remover o arquivo de exemplo**

Run: `rm apex-smart-solutions/pratica-vendas/lib/_smoke.ts apex-smart-solutions/pratica-vendas/lib/_smoke.test.ts`

- [ ] **Step 11: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/package.json apex-smart-solutions/pratica-vendas/tsconfig.json apex-smart-solutions/pratica-vendas/vitest.config.ts apex-smart-solutions/pratica-vendas/next.config.mjs apex-smart-solutions/pratica-vendas/.env.example apex-smart-solutions/pratica-vendas/.gitignore
git commit -m "chore: scaffold pratica-vendas Next.js project with Vitest harness"
```

---

## Task 2: Schema do banco de dados e cliente Postgres

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/db/schema.sql`
- Create: `apex-smart-solutions/pratica-vendas/db/client.ts`

**Interfaces:**
- Produces: `sql` (cliente `postgres` configurado, usado por todos os módulos de acesso a dados dos Tasks 8+).

- [ ] **Step 1: Escrever `db/schema.sql`**

```sql
create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  usuario text not null unique,
  senha_hash text not null,
  papel text not null check (papel in ('consultor', 'admin')),
  criado_em timestamptz not null default now()
);

create table if not exists cenarios (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text not null,
  prompt_ia_cliente text not null,
  categoria text not null,
  ativo boolean not null default true
);

create table if not exists sessoes_pratica (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id),
  cenario_id uuid not null references cenarios(id),
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  nota integer,
  feedback text
);

create table if not exists mensagens (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references sessoes_pratica(id),
  remetente text not null check (remetente in ('consultor', 'ia')),
  texto text not null,
  criado_em timestamptz not null default now()
);

create index if not exists idx_sessoes_usuario on sessoes_pratica(usuario_id);
create index if not exists idx_mensagens_sessao on mensagens(sessao_id);
```

- [ ] **Step 2: Escrever `db/client.ts`**

```typescript
import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada — veja .env.example.');
}

export const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
```

- [ ] **Step 3: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/db/schema.sql apex-smart-solutions/pratica-vendas/db/client.ts
git commit -m "feat: add database schema and Postgres client"
```

(este arquivo depende de `DATABASE_URL` real — não roda em teste automatizado; ver Task 12 pra como provisionar o banco antes de rodar em produção)

---

## Task 3: Módulo de senha (hash e verificação)

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/lib/auth/senha.ts`
- Test: `apex-smart-solutions/pratica-vendas/lib/auth/senha.test.ts`

**Interfaces:**
- Produces: `gerarHashSenha(senha: string): Promise<string>`; `verificarSenha(senha: string, hash: string): Promise<boolean>`. Usados pelo Task 8 (usuarios.ts) e Task 9 (rota de login).

- [ ] **Step 1: Escrever os testes**

```typescript
import { describe, it, expect } from 'vitest';
import { gerarHashSenha, verificarSenha } from './senha';

describe('senha', () => {
  it('gerarHashSenha produz um hash diferente do texto original', async () => {
    const hash = await gerarHashSenha('minhaSenha123');
    expect(hash).not.toBe('minhaSenha123');
  });

  it('verificarSenha retorna true pra senha correta', async () => {
    const hash = await gerarHashSenha('minhaSenha123');
    expect(await verificarSenha('minhaSenha123', hash)).toBe(true);
  });

  it('verificarSenha retorna false pra senha errada', async () => {
    const hash = await gerarHashSenha('minhaSenha123');
    expect(await verificarSenha('outraSenha', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd apex-smart-solutions/pratica-vendas && npm test`
Expected: FAIL — `Cannot find module './senha'`

- [ ] **Step 3: Implementar `lib/auth/senha.ts`**

```typescript
import bcrypt from 'bcryptjs';

export async function gerarHashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, 10);
}

export async function verificarSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}
```

- [ ] **Step 4: Rodar todos os testes e confirmar que passam**

Run: `npm test`
Expected: 3 testes em PASS

- [ ] **Step 5: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/lib/auth/senha.ts apex-smart-solutions/pratica-vendas/lib/auth/senha.test.ts
git commit -m "feat: add password hashing module"
```

---

## Task 4: Módulo de sessão (JWT em cookie)

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/lib/auth/sessao.ts`
- Test: `apex-smart-solutions/pratica-vendas/lib/auth/sessao.test.ts`

**Interfaces:**
- Produces: `criarTokenSessao(dados: {usuarioId: string, papel: 'consultor'|'admin'}): Promise<string>`; `verificarTokenSessao(token: string): Promise<{usuarioId: string, papel: 'consultor'|'admin'}|null>`. Usados pelo Task 9 (login/logout) e pelo middleware (Task 9).

- [ ] **Step 1: Escrever os testes**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { criarTokenSessao, verificarTokenSessao } from './sessao';

beforeAll(() => {
  process.env.SESSION_SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres';
});

describe('sessao', () => {
  it('cria e verifica um token válido', async () => {
    const token = await criarTokenSessao({ usuarioId: 'abc-123', papel: 'consultor' });
    const dados = await verificarTokenSessao(token);
    expect(dados).toEqual({ usuarioId: 'abc-123', papel: 'consultor' });
  });

  it('rejeita um token inválido/corrompido', async () => {
    const dados = await verificarTokenSessao('token.invalido.aqui');
    expect(dados).toBeNull();
  });

  it('preserva o papel admin corretamente', async () => {
    const token = await criarTokenSessao({ usuarioId: 'xyz-789', papel: 'admin' });
    const dados = await verificarTokenSessao(token);
    expect(dados?.papel).toBe('admin');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd apex-smart-solutions/pratica-vendas && npm test`
Expected: FAIL — `Cannot find module './sessao'`

- [ ] **Step 3: Implementar `lib/auth/sessao.ts`**

```typescript
import { SignJWT, jwtVerify } from 'jose';

function obterSegredo(): Uint8Array {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error('SESSION_SECRET não configurada — veja .env.example.');
  return new TextEncoder().encode(segredo);
}

export type DadosSessao = { usuarioId: string; papel: 'consultor' | 'admin' };

export async function criarTokenSessao(dados: DadosSessao): Promise<string> {
  return new SignJWT({ ...dados })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(obterSegredo());
}

export async function verificarTokenSessao(token: string): Promise<DadosSessao | null> {
  try {
    const { payload } = await jwtVerify(token, obterSegredo());
    if (typeof payload.usuarioId !== 'string' || typeof payload.papel !== 'string') return null;
    return { usuarioId: payload.usuarioId, papel: payload.papel as DadosSessao['papel'] };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar todos os testes e confirmar que passam**

Run: `npm test`
Expected: 3 testes em PASS

- [ ] **Step 5: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/lib/auth/sessao.ts apex-smart-solutions/pratica-vendas/lib/auth/sessao.test.ts
git commit -m "feat: add signed JWT session module"
```

---

## Task 5: Cenários — dados iniciais e construção do prompt da IA-cliente

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/lib/cenarios/dados.ts`
- Create: `apex-smart-solutions/pratica-vendas/lib/cenarios/prompt.ts`
- Test: `apex-smart-solutions/pratica-vendas/lib/cenarios/prompt.test.ts`

**Interfaces:**
- Produces: `CENARIOS_INICIAIS: CenarioSeed[]` (os 5 cenários da spec, seção 7); `construirPromptCliente(cenario: {titulo: string, descricao: string, promptIaCliente: string}): string`. Usados pelo Task 8 (seed do banco) e Task 9 (chamada à IA no roleplay).

- [ ] **Step 1: Escrever `lib/cenarios/dados.ts`** (os 5 cenários exatos da spec, seção 7 — cada `promptIaCliente` define a personalidade/comportamento da IA nesse papel)

```typescript
export type CenarioSeed = {
  titulo: string;
  descricao: string;
  promptIaCliente: string;
  categoria: string;
};

export const CENARIOS_INICIAIS: CenarioSeed[] = [
  {
    titulo: 'Cliente questionou o preço',
    descricao: 'O cliente recebeu a proposta de 100GB/70GB e achou caro comparado ao que viu no anúncio.',
    promptIaCliente:
      'Você é o dono de uma pequena empresa que respondeu um anúncio de internet/linha empresarial ' +
      'da Claro. Você viu no anúncio um valor bem menor do que o consultor está oferecendo agora. ' +
      'Reclame do preço de forma educada mas firme. Se o consultor justificar bem o valor (benefícios, ' +
      'não só desconto) e ainda assim você achar caro, aceite negociar um plano intermediário — mas só ' +
      'se ele perguntar o que você esperava pagar, não aceite de primeira se ele simplesmente abaixar o preço sem perguntar nada.',
    categoria: 'objecao_preco',
  },
  {
    titulo: 'Cliente sumiu no meio da negociação',
    descricao: 'O cliente parou de responder depois de uma primeira troca de mensagens.',
    promptIaCliente:
      'Você é um cliente que respondeu as duas primeiras mensagens do consultor de forma neutra e curta, ' +
      'mas está claramente sem pressa e meio desinteressado. Se a mensagem do consultor for genérica ou ' +
      'repetir o que já foi dito, responda de forma cada vez mais curta ou pare de responder (responda só ' +
      '"..." ou não responda). Se o consultor fizer uma pergunta direta e específica sobre sua necessidade real, ' +
      'volte a engajar normalmente.',
    categoria: 'lead_frio',
  },
  {
    titulo: 'CNPJ inválido descoberto durante a conversa',
    descricao: 'No meio da conversa fica claro que a pessoa não tem CNPJ ativo de verdade.',
    promptIaCliente:
      'Você é uma pessoa física que preencheu o formulário dizendo ter uma empresa, mas na verdade não tem ' +
      'CNPJ ativo (é autônomo informal). Se o consultor perguntar diretamente sobre o CNPJ ou confirmar que ' +
      'o atendimento é só para empresas com CNPJ ativo, admita que não tem. Se ele não perguntar isso, continue ' +
      'a conversa normalmente como se fosse uma empresa.',
    categoria: 'cnpj_invalido',
  },
  {
    titulo: 'Sem viabilidade técnica no endereço',
    descricao: 'O cliente queria internet fixa (Fibra), mas o endereço dele não tem cobertura.',
    promptIaCliente:
      'Você quer contratar internet fixa (Fibra) para sua empresa. Se o consultor perguntar seu CEP/endereço, ' +
      'informe um endereço qualquer. Trate a resposta dele como se a viabilidade tivesse dado negativa. Se o ' +
      'consultor simplesmente disser que não dá pra atender e encerrar a conversa, demonstre frustração e ' +
      'desinteresse total. Se ele oferecer linha móvel empresarial como alternativa, considere positivamente.',
    categoria: 'sem_viabilidade',
  },
  {
    titulo: 'Lead frio que só respondeu uma vez',
    descricao: 'O cliente respondeu rápido uma vez, mas a mensagem do consultor não conectou.',
    promptIaCliente:
      'Você respondeu ao anúncio por curiosidade, sem muita convicção. Você já respondeu uma mensagem ' +
      'educada e genérica. Se a próxima mensagem do consultor for genérica ("posso te ajudar?", "tem ' +
      'interesse?"), não responda mais. Se ela for personalizada (usa seu nome/empresa, referencia o que ' +
      'você preencheu no formulário) e apresentar um benefício concreto, responda com interesse moderado.',
    categoria: 'lead_frio',
  },
];
```

- [ ] **Step 2: Escrever os testes de `construirPromptCliente`**

```typescript
import { describe, it, expect } from 'vitest';
import { construirPromptCliente } from './prompt';

describe('construirPromptCliente', () => {
  it('inclui o título e a descrição do cenário no prompt', () => {
    const prompt = construirPromptCliente({
      titulo: 'Cliente questionou o preço',
      descricao: 'Achou caro.',
      promptIaCliente: 'Reclame do preço.',
    });
    expect(prompt).toContain('Cliente questionou o preço');
    expect(prompt).toContain('Achou caro.');
    expect(prompt).toContain('Reclame do preço.');
  });

  it('instrui a IA a nunca sair do personagem', () => {
    const prompt = construirPromptCliente({
      titulo: 'X',
      descricao: 'Y',
      promptIaCliente: 'Z',
    });
    expect(prompt.toLowerCase()).toContain('nunca saia do personagem');
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `cd apex-smart-solutions/pratica-vendas && npm test`
Expected: FAIL — `Cannot find module './prompt'`

- [ ] **Step 4: Implementar `lib/cenarios/prompt.ts`**

```typescript
export function construirPromptCliente(cenario: {
  titulo: string;
  descricao: string;
  promptIaCliente: string;
}): string {
  return (
    `Você está simulando um cliente em uma conversa de vendas de WhatsApp, para treinar um ` +
    `consultor de vendas da Apex Smart Solutions (revenda Claro Empresas).\n\n` +
    `Cenário: ${cenario.titulo}\n` +
    `Contexto: ${cenario.descricao}\n\n` +
    `Como agir: ${cenario.promptIaCliente}\n\n` +
    `Regras: responda sempre como o cliente, em português, em mensagens curtas de WhatsApp. ` +
    `Nunca saia do personagem, nunca mencione que você é uma IA, nunca explique a simulação.`
  );
}
```

- [ ] **Step 5: Rodar todos os testes e confirmar que passam**

Run: `npm test`
Expected: 2 testes em PASS

- [ ] **Step 6: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/lib/cenarios/
git commit -m "feat: add initial scenarios and client-roleplay prompt builder"
```

---

## Task 6: Rubrica de avaliação — construção do prompt do avaliador

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/lib/avaliacao/rubrica.ts`
- Test: `apex-smart-solutions/pratica-vendas/lib/avaliacao/rubrica.test.ts`

**Interfaces:**
- Produces: `CRITERIOS_RUBRICA: string[]` (os 6 critérios da spec, seção 8); `construirPromptAvaliacao(transcricao: {remetente: 'consultor'|'ia', texto: string}[]): string`. Usado pelo Task 9 (chamada de avaliação).

- [ ] **Step 1: Escrever os testes**

```typescript
import { describe, it, expect } from 'vitest';
import { construirPromptAvaliacao, CRITERIOS_RUBRICA } from './rubrica';

describe('rubrica', () => {
  it('tem exatamente os 6 critérios da spec', () => {
    expect(CRITERIOS_RUBRICA).toHaveLength(6);
  });

  it('construirPromptAvaliacao inclui todos os critérios', () => {
    const prompt = construirPromptAvaliacao([{ remetente: 'consultor', texto: 'Oi!' }]);
    CRITERIOS_RUBRICA.forEach((criterio) => {
      expect(prompt).toContain(criterio);
    });
  });

  it('construirPromptAvaliacao inclui a transcrição formatada', () => {
    const prompt = construirPromptAvaliacao([
      { remetente: 'consultor', texto: 'Oi, tudo bem?' },
      { remetente: 'ia', texto: 'Tudo sim.' },
    ]);
    expect(prompt).toContain('CONSULTOR: Oi, tudo bem?');
    expect(prompt).toContain('CLIENTE: Tudo sim.');
  });

  it('construirPromptAvaliacao pede nota de 0 a 100 em JSON', () => {
    const prompt = construirPromptAvaliacao([{ remetente: 'consultor', texto: 'Oi!' }]);
    expect(prompt).toContain('"nota"');
    expect(prompt).toContain('"feedback"');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd apex-smart-solutions/pratica-vendas && npm test`
Expected: FAIL — `Cannot find module './rubrica'`

- [ ] **Step 3: Implementar `lib/avaliacao/rubrica.ts`**

```typescript
export const CRITERIOS_RUBRICA: string[] = [
  'Personalizou a abertura com nome, empresa e necessidade mencionados no cenário?',
  'Abriu pelo plano de 100GB ou 70GB, não pelo plano de entrada?',
  'Só desceu de plano porque o cliente questionou o valor, não de primeira?',
  'Evitou oferecer o plano regional de R$44,99/15GB?',
  'Fez uma pergunta de fechamento, não uma pergunta aberta?',
  'Tratou a objeção seguindo a lógica do guia (ex.: sem viabilidade não é "não", redirecionar pra linha móvel)?',
];

export function construirPromptAvaliacao(
  transcricao: { remetente: 'consultor' | 'ia'; texto: string }[]
): string {
  const transcricaoFormatada = transcricao
    .map((m) => `${m.remetente === 'consultor' ? 'CONSULTOR' : 'CLIENTE'}: ${m.texto}`)
    .join('\n');

  const criteriosFormatados = CRITERIOS_RUBRICA.map((c, i) => `${i + 1}. ${c}`).join('\n');

  return (
    `Você vai avaliar a conversa de um consultor de vendas com um cliente simulado, usando ` +
    `exatamente os critérios abaixo (baseados no guia de atendimento da Apex Smart Solutions):\n\n` +
    `${criteriosFormatados}\n\n` +
    `Transcrição:\n${transcricaoFormatada}\n\n` +
    `Responda SOMENTE com um JSON no formato ` +
    `{"nota": <número de 0 a 100>, "feedback": "<2-4 frases específicas, citando trechos da conversa quando possível>"}, ` +
    `sem nenhum texto antes ou depois do JSON.`
  );
}
```

- [ ] **Step 4: Rodar todos os testes e confirmar que passam**

Run: `npm test`
Expected: 4 testes em PASS

- [ ] **Step 5: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/lib/avaliacao/
git commit -m "feat: add grading rubric and evaluation prompt builder"
```

---

## Task 7: Limite de sessões diárias

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/lib/limiteSessoes.ts`
- Test: `apex-smart-solutions/pratica-vendas/lib/limiteSessoes.test.ts`

**Interfaces:**
- Produces: `LIMITE_SESSOES_POR_DIA = 10`; `podeIniciarSessao(sessoesHoje: number): boolean`. Usado pelo Task 9 (rota de iniciar prática).

- [ ] **Step 1: Escrever os testes**

```typescript
import { describe, it, expect } from 'vitest';
import { podeIniciarSessao, LIMITE_SESSOES_POR_DIA } from './limiteSessoes';

describe('podeIniciarSessao', () => {
  it('permite quando está abaixo do limite', () => {
    expect(podeIniciarSessao(0)).toBe(true);
    expect(podeIniciarSessao(LIMITE_SESSOES_POR_DIA - 1)).toBe(true);
  });

  it('bloqueia quando atinge o limite', () => {
    expect(podeIniciarSessao(LIMITE_SESSOES_POR_DIA)).toBe(false);
  });

  it('bloqueia quando passa do limite', () => {
    expect(podeIniciarSessao(LIMITE_SESSOES_POR_DIA + 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd apex-smart-solutions/pratica-vendas && npm test`
Expected: FAIL — `Cannot find module './limiteSessoes'`

- [ ] **Step 3: Implementar `lib/limiteSessoes.ts`**

```typescript
export const LIMITE_SESSOES_POR_DIA = 10;

export function podeIniciarSessao(sessoesHoje: number): boolean {
  return sessoesHoje < LIMITE_SESSOES_POR_DIA;
}
```

- [ ] **Step 4: Rodar todos os testes e confirmar que passam**

Run: `npm test`
Expected: 3 testes em PASS

- [ ] **Step 5: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/lib/limiteSessoes.ts apex-smart-solutions/pratica-vendas/lib/limiteSessoes.test.ts
git commit -m "feat: add daily session limit check"
```

---

## Task 8: Glue de acesso a dados (usuários, cenários, sessões, mensagens)

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/db/usuarios.ts`
- Create: `apex-smart-solutions/pratica-vendas/db/cenarios.ts`
- Create: `apex-smart-solutions/pratica-vendas/db/sessoesPratica.ts`
- Create: `apex-smart-solutions/pratica-vendas/db/mensagens.ts`
- Create: `apex-smart-solutions/pratica-vendas/db/seed.ts`

Este arquivo depende de `sql` (Task 2), que precisa de um Postgres real — não tem teste automatizado (mesma razão do Task 2: sem banco de teste provisionado neste ambiente). A correção fica por conferência manual depois que o Task 12 provisionar o banco.

**Interfaces:**
- Consumes: `sql` (Task 2), `gerarHashSenha`/`verificarSenha` (Task 3), `CENARIOS_INICIAIS` (Task 5).
- Produces: `buscarUsuarioPorLogin(usuario: string)`, `criarUsuario(...)`, `listarCenariosAtivos()`, `buscarCenarioPorId(id)`, `contarSessoesHoje(usuarioId)`, `criarSessao(usuarioId, cenarioId)`, `buscarSessao(id)`, `finalizarSessao(id, nota, feedback)`, `listarSessoesPorUsuario(usuarioId)`, `listarTodasSessoes()` (admin), `adicionarMensagem(sessaoId, remetente, texto)`, `listarMensagens(sessaoId)`. Usados pelo Task 9.

- [ ] **Step 1: Implementar `db/usuarios.ts`**

```typescript
import { sql } from './client';

export type Usuario = { id: string; nome: string; usuario: string; senhaHash: string; papel: 'consultor' | 'admin' };

export async function buscarUsuarioPorLogin(usuario: string): Promise<Usuario | null> {
  const linhas = await sql<{ id: string; nome: string; usuario: string; senha_hash: string; papel: string }[]>`
    select id, nome, usuario, senha_hash, papel from usuarios where usuario = ${usuario}
  `;
  if (linhas.length === 0) return null;
  const l = linhas[0];
  return { id: l.id, nome: l.nome, usuario: l.usuario, senhaHash: l.senha_hash, papel: l.papel as 'consultor' | 'admin' };
}

export async function criarUsuario(nome: string, usuario: string, senhaHash: string, papel: 'consultor' | 'admin') {
  await sql`insert into usuarios (nome, usuario, senha_hash, papel) values (${nome}, ${usuario}, ${senhaHash}, ${papel})`;
}
```

- [ ] **Step 2: Implementar `db/cenarios.ts`**

```typescript
import { sql } from './client';

export type Cenario = { id: string; titulo: string; descricao: string; promptIaCliente: string; categoria: string };

export async function listarCenariosAtivos(): Promise<Cenario[]> {
  const linhas = await sql<{ id: string; titulo: string; descricao: string; prompt_ia_cliente: string; categoria: string }[]>`
    select id, titulo, descricao, prompt_ia_cliente, categoria from cenarios where ativo = true order by titulo
  `;
  return linhas.map((l) => ({ id: l.id, titulo: l.titulo, descricao: l.descricao, promptIaCliente: l.prompt_ia_cliente, categoria: l.categoria }));
}

export async function buscarCenarioPorId(id: string): Promise<Cenario | null> {
  const linhas = await sql<{ id: string; titulo: string; descricao: string; prompt_ia_cliente: string; categoria: string }[]>`
    select id, titulo, descricao, prompt_ia_cliente, categoria from cenarios where id = ${id}
  `;
  if (linhas.length === 0) return null;
  const l = linhas[0];
  return { id: l.id, titulo: l.titulo, descricao: l.descricao, promptIaCliente: l.prompt_ia_cliente, categoria: l.categoria };
}
```

- [ ] **Step 3: Implementar `db/sessoesPratica.ts`**

```typescript
import { sql } from './client';

export type SessaoPratica = {
  id: string;
  usuarioId: string;
  cenarioId: string;
  iniciadoEm: Date;
  finalizadoEm: Date | null;
  nota: number | null;
  feedback: string | null;
};

export async function contarSessoesHoje(usuarioId: string): Promise<number> {
  const linhas = await sql<{ total: string }[]>`
    select count(*)::text as total from sessoes_pratica
    where usuario_id = ${usuarioId} and iniciado_em >= current_date
  `;
  return Number(linhas[0].total);
}

export async function criarSessao(usuarioId: string, cenarioId: string): Promise<string> {
  const linhas = await sql<{ id: string }[]>`
    insert into sessoes_pratica (usuario_id, cenario_id) values (${usuarioId}, ${cenarioId}) returning id
  `;
  return linhas[0].id;
}

export async function buscarSessao(id: string): Promise<SessaoPratica | null> {
  const linhas = await sql<{
    id: string; usuario_id: string; cenario_id: string; iniciado_em: Date; finalizado_em: Date | null; nota: number | null; feedback: string | null;
  }[]>`select * from sessoes_pratica where id = ${id}`;
  if (linhas.length === 0) return null;
  const l = linhas[0];
  return { id: l.id, usuarioId: l.usuario_id, cenarioId: l.cenario_id, iniciadoEm: l.iniciado_em, finalizadoEm: l.finalizado_em, nota: l.nota, feedback: l.feedback };
}

// só atualiza se ainda não tiver sido finalizada — evita dupla avaliação (Review Focus).
// retorna quantas linhas foram afetadas: 0 = já estava finalizada, 1 = acabou de finalizar agora.
export async function finalizarSessao(id: string, nota: number, feedback: string): Promise<number> {
  const resultado = await sql`
    update sessoes_pratica set finalizado_em = now(), nota = ${nota}, feedback = ${feedback}
    where id = ${id} and finalizado_em is null
  `;
  return resultado.count;
}

export async function listarSessoesPorUsuario(usuarioId: string): Promise<SessaoPratica[]> {
  const linhas = await sql<{
    id: string; usuario_id: string; cenario_id: string; iniciado_em: Date; finalizado_em: Date | null; nota: number | null; feedback: string | null;
  }[]>`select * from sessoes_pratica where usuario_id = ${usuarioId} order by iniciado_em desc`;
  return linhas.map((l) => ({ id: l.id, usuarioId: l.usuario_id, cenarioId: l.cenario_id, iniciadoEm: l.iniciado_em, finalizadoEm: l.finalizado_em, nota: l.nota, feedback: l.feedback }));
}

export async function listarTodasSessoes(): Promise<(SessaoPratica & { nomeUsuario: string })[]> {
  const linhas = await sql<{
    id: string; usuario_id: string; cenario_id: string; iniciado_em: Date; finalizado_em: Date | null; nota: number | null; feedback: string | null; nome_usuario: string;
  }[]>`
    select s.*, u.nome as nome_usuario from sessoes_pratica s
    join usuarios u on u.id = s.usuario_id
    order by s.iniciado_em desc
  `;
  return linhas.map((l) => ({ id: l.id, usuarioId: l.usuario_id, cenarioId: l.cenario_id, iniciadoEm: l.iniciado_em, finalizadoEm: l.finalizado_em, nota: l.nota, feedback: l.feedback, nomeUsuario: l.nome_usuario }));
}
```

- [ ] **Step 4: Implementar `db/mensagens.ts`**

```typescript
import { sql } from './client';

export type Mensagem = { id: string; sessaoId: string; remetente: 'consultor' | 'ia'; texto: string; criadoEm: Date };

export async function adicionarMensagem(sessaoId: string, remetente: 'consultor' | 'ia', texto: string): Promise<void> {
  await sql`insert into mensagens (sessao_id, remetente, texto) values (${sessaoId}, ${remetente}, ${texto})`;
}

export async function listarMensagens(sessaoId: string): Promise<Mensagem[]> {
  const linhas = await sql<{ id: string; sessao_id: string; remetente: string; texto: string; criado_em: Date }[]>`
    select * from mensagens where sessao_id = ${sessaoId} order by criado_em asc
  `;
  return linhas.map((l) => ({ id: l.id, sessaoId: l.sessao_id, remetente: l.remetente as 'consultor' | 'ia', texto: l.texto, criadoEm: l.criado_em }));
}
```

- [ ] **Step 5: Implementar `db/seed.ts`** (script de setup inicial — roda uma vez, manualmente, depois que o banco existir)

```typescript
import { sql } from './client';
import { CENARIOS_INICIAIS } from '../lib/cenarios/dados';
import { gerarHashSenha } from '../lib/auth/senha';

async function seed() {
  for (const cenario of CENARIOS_INICIAIS) {
    await sql`
      insert into cenarios (titulo, descricao, prompt_ia_cliente, categoria)
      values (${cenario.titulo}, ${cenario.descricao}, ${cenario.promptIaCliente}, ${cenario.categoria})
      on conflict do nothing
    `;
  }

  const senhaAdminHash = await gerarHashSenha(process.env.SEED_SENHA_ADMIN || 'troque-esta-senha');
  await sql`
    insert into usuarios (nome, usuario, senha_hash, papel)
    values ('Rafael', 'rafael', ${senhaAdminHash}, 'admin')
    on conflict (usuario) do nothing
  `;

  console.log('Seed concluído: cenários inseridos, usuário admin "rafael" criado (troque a senha no primeiro login).');
  await sql.end();
}

seed().catch((e) => {
  console.error('Erro no seed:', e);
  process.exit(1);
});
```

- [ ] **Step 6: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/db/
git commit -m "feat: add data access layer and initial seed script"
```

---

## Task 9: Integração com a IA (roleplay e avaliação)

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/lib/ia/cliente.ts`

Sem teste automatizado (chama a API real da Anthropic) — validado manualmente no piloto (Task 12).

**Interfaces:**
- Consumes: `construirPromptCliente` (Task 5), `construirPromptAvaliacao` (Task 6).
- Produces: `responderComoCliente(promptSistema: string, historico: {remetente: 'consultor'|'ia', texto: string}[]): Promise<string>`; `avaliarConversa(transcricao: {remetente: 'consultor'|'ia', texto: string}[]): Promise<{nota: number, feedback: string} | null>` (retorna `null` em caso de falha da API — quem chama decide o que fazer, ver Task 10).

- [ ] **Step 1: Implementar `lib/ia/cliente.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';

function obterClienteAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada — veja .env.example.');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function responderComoCliente(
  promptSistema: string,
  historico: { remetente: 'consultor' | 'ia'; texto: string }[]
): Promise<string> {
  const anthropic = obterClienteAnthropic();
  const mensagens = historico.map((m) => ({
    role: (m.remetente === 'consultor' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.texto,
  }));

  const resposta = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 300,
    system: promptSistema,
    messages: mensagens,
  });

  const bloco = resposta.content[0];
  return bloco.type === 'text' ? bloco.text : '';
}

export async function avaliarConversa(
  transcricao: { remetente: 'consultor' | 'ia'; texto: string }[]
): Promise<{ nota: number; feedback: string } | null> {
  const anthropic = obterClienteAnthropic();
  const { construirPromptAvaliacao } = await import('../avaliacao/rubrica');

  try {
    const resposta = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: construirPromptAvaliacao(transcricao) }],
    });
    const bloco = resposta.content[0];
    if (bloco.type !== 'text') return null;
    const dados = JSON.parse(bloco.text);
    if (typeof dados.nota !== 'number' || typeof dados.feedback !== 'string') return null;
    return { nota: dados.nota, feedback: dados.feedback };
  } catch (erro) {
    console.error('Falha ao avaliar conversa:', erro);
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/lib/ia/
git commit -m "feat: add Anthropic API glue for roleplay and grading"
```

---

## Task 10: Rotas de API — autenticação e prática

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/middleware.ts`
- Create: `apex-smart-solutions/pratica-vendas/app/api/auth/login/route.ts`
- Create: `apex-smart-solutions/pratica-vendas/app/api/auth/logout/route.ts`
- Create: `apex-smart-solutions/pratica-vendas/app/api/pratica/iniciar/route.ts`
- Create: `apex-smart-solutions/pratica-vendas/app/api/pratica/[sessaoId]/mensagem/route.ts`
- Create: `apex-smart-solutions/pratica-vendas/app/api/pratica/[sessaoId]/encerrar/route.ts`

Sem teste automatizado (rotas Next.js dependem de banco e API reais) — cobre os 5 itens do Review Focus via validação explícita em código; conferido manualmente no piloto.

**Interfaces:**
- Consumes: tudo dos Tasks 3-9.

- [ ] **Step 1: Implementar `middleware.ts`** (protege tudo exceto `/login` e as rotas de auth)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from './lib/auth/sessao';

export async function middleware(req: NextRequest) {
  const rotasPublicas = ['/login', '/api/auth/login'];
  if (rotasPublicas.some((r) => req.nextUrl.pathname.startsWith(r))) {
    return NextResponse.next();
  }

  const token = req.cookies.get('sessao')?.value;
  const dados = token ? await verificarTokenSessao(token) : null;
  if (!dados) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (req.nextUrl.pathname.startsWith('/admin') && dados.papel !== 'admin') {
    return NextResponse.redirect(new URL('/cenarios', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 2: Implementar `app/api/auth/login/route.ts`** (mensagem genérica em qualquer erro de login — Review Focus)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { buscarUsuarioPorLogin } from '@/db/usuarios';
import { verificarSenha, gerarHashSenha } from '@/lib/auth/senha';
import { criarTokenSessao } from '@/lib/auth/sessao';

const MENSAGEM_ERRO_GENERICA = { erro: 'Usuário ou senha inválidos.' };

export async function POST(req: NextRequest) {
  const { usuario, senha } = await req.json();
  if (!usuario || !senha) {
    return NextResponse.json(MENSAGEM_ERRO_GENERICA, { status: 401 });
  }

  const registro = await buscarUsuarioPorLogin(usuario);

  // usuário não existe: ainda assim gasta o tempo de um bcrypt.compare, pra não vazar
  // por tempo de resposta se o usuário existe ou não (Review Focus).
  const hashParaComparar = registro?.senhaHash ?? (await gerarHashSenha('senha-que-nunca-bate'));
  const senhaOk = await verificarSenha(senha, hashParaComparar);

  if (!registro || !senhaOk) {
    return NextResponse.json(MENSAGEM_ERRO_GENERICA, { status: 401 });
  }

  const token = await criarTokenSessao({ usuarioId: registro.id, papel: registro.papel });
  const resposta = NextResponse.json({ ok: true, papel: registro.papel });
  resposta.cookies.set('sessao', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
  return resposta;
}
```

- [ ] **Step 3: Implementar `app/api/auth/logout/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export async function POST() {
  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.set('sessao', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return resposta;
}
```

- [ ] **Step 4: Implementar `app/api/pratica/iniciar/route.ts`** (aplica o limite diário — Review Focus)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { contarSessoesHoje, criarSessao } from '@/db/sessoesPratica';
import { podeIniciarSessao, LIMITE_SESSOES_POR_DIA } from '@/lib/limiteSessoes';

export async function POST(req: NextRequest) {
  const dados = await verificarTokenSessao(req.cookies.get('sessao')?.value ?? '');
  if (!dados) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });

  const { cenarioId } = await req.json();
  if (!cenarioId) return NextResponse.json({ erro: 'cenarioId obrigatório.' }, { status: 400 });

  const sessoesHoje = await contarSessoesHoje(dados.usuarioId);
  if (!podeIniciarSessao(sessoesHoje)) {
    return NextResponse.json(
      { erro: `Você já usou as ${LIMITE_SESSOES_POR_DIA} práticas de hoje. Volte amanhã.` },
      { status: 429 }
    );
  }

  const sessaoId = await criarSessao(dados.usuarioId, cenarioId);
  return NextResponse.json({ sessaoId });
}
```

- [ ] **Step 5: Implementar `app/api/pratica/[sessaoId]/mensagem/route.ts`** (rejeita mensagem vazia — Review Focus)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { buscarSessao } from '@/db/sessoesPratica';
import { buscarCenarioPorId } from '@/db/cenarios';
import { adicionarMensagem, listarMensagens } from '@/db/mensagens';
import { construirPromptCliente } from '@/lib/cenarios/prompt';
import { responderComoCliente } from '@/lib/ia/cliente';

export async function POST(req: NextRequest, { params }: { params: { sessaoId: string } }) {
  const dados = await verificarTokenSessao(req.cookies.get('sessao')?.value ?? '');
  if (!dados) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });

  const { texto } = await req.json();
  if (!texto || !texto.trim()) {
    return NextResponse.json({ erro: 'Mensagem vazia.' }, { status: 400 });
  }

  const sessao = await buscarSessao(params.sessaoId);
  if (!sessao || sessao.usuarioId !== dados.usuarioId) {
    return NextResponse.json({ erro: 'Sessão não encontrada.' }, { status: 404 });
  }
  if (sessao.finalizadoEm) {
    return NextResponse.json({ erro: 'Esta sessão já foi encerrada.' }, { status: 400 });
  }

  const cenario = await buscarCenarioPorId(sessao.cenarioId);
  if (!cenario) return NextResponse.json({ erro: 'Cenário não encontrado.' }, { status: 404 });

  await adicionarMensagem(sessao.id, 'consultor', texto.trim());
  const historico = await listarMensagens(sessao.id);

  let respostaIa: string;
  try {
    respostaIa = await responderComoCliente(
      construirPromptCliente(cenario),
      historico.map((m) => ({ remetente: m.remetente, texto: m.texto }))
    );
  } catch (erro) {
    console.error('Falha ao chamar a IA no roleplay:', erro);
    return NextResponse.json(
      { erro: 'A simulação falhou temporariamente. Tente enviar a mensagem de novo.' },
      { status: 502 }
    );
  }

  await adicionarMensagem(sessao.id, 'ia', respostaIa);
  return NextResponse.json({ resposta: respostaIa });
}
```

- [ ] **Step 6: Implementar `app/api/pratica/[sessaoId]/encerrar/route.ts`** (nunca avalia duas vezes, e falha de API não consome o limite diário — Review Focus)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { buscarSessao, finalizarSessao } from '@/db/sessoesPratica';
import { listarMensagens } from '@/db/mensagens';
import { avaliarConversa } from '@/lib/ia/cliente';

export async function POST(req: NextRequest, { params }: { params: { sessaoId: string } }) {
  const dados = await verificarTokenSessao(req.cookies.get('sessao')?.value ?? '');
  if (!dados) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });

  const sessao = await buscarSessao(params.sessaoId);
  if (!sessao || sessao.usuarioId !== dados.usuarioId) {
    return NextResponse.json({ erro: 'Sessão não encontrada.' }, { status: 404 });
  }
  if (sessao.finalizadoEm) {
    // já foi avaliada (clique duplo, ou outra aba) — devolve o resultado que já existe, não chama a IA de novo.
    return NextResponse.json({ nota: sessao.nota, feedback: sessao.feedback });
  }

  const mensagens = await listarMensagens(sessao.id);
  const resultado = await avaliarConversa(mensagens.map((m) => ({ remetente: m.remetente, texto: m.texto })));

  if (!resultado) {
    // falha da IA: não marca finalizado_em, então não conta pro limite diário e pode tentar de novo.
    return NextResponse.json(
      { erro: 'Não foi possível avaliar a conversa agora. Tente encerrar de novo em instantes.' },
      { status: 502 }
    );
  }

  const linhasAfetadas = await finalizarSessao(sessao.id, resultado.nota, resultado.feedback);
  if (linhasAfetadas === 0) {
    // corrida: outra requisição finalizou entre o buscarSessao e agora — busca o resultado real salvo.
    const sessaoAtualizada = await buscarSessao(sessao.id);
    return NextResponse.json({ nota: sessaoAtualizada?.nota, feedback: sessaoAtualizada?.feedback });
  }

  return NextResponse.json(resultado);
}
```

- [ ] **Step 7: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/middleware.ts apex-smart-solutions/pratica-vendas/app/api/
git commit -m "feat: add auth and practice API routes with rate limiting and idempotent grading"
```

---

## Task 11: Páginas (login, cenários, chat, histórico, admin)

**Files:**
- Create: `apex-smart-solutions/pratica-vendas/app/layout.tsx`
- Create: `apex-smart-solutions/pratica-vendas/app/login/page.tsx`
- Create: `apex-smart-solutions/pratica-vendas/app/cenarios/page.tsx`
- Create: `apex-smart-solutions/pratica-vendas/app/pratica/[sessaoId]/page.tsx`
- Create: `apex-smart-solutions/pratica-vendas/app/historico/page.tsx`
- Create: `apex-smart-solutions/pratica-vendas/app/admin/page.tsx`

Sem teste automatizado (componentes React de página, verificados manualmente — ver Task 12).

**Interfaces:**
- Consumes: `listarCenariosAtivos`, `buscarCenarioPorId`, `listarMensagens`, `listarSessoesPorUsuario`, `listarTodasSessoes` (Task 8); rotas do Task 10.

- [ ] **Step 1: Implementar `app/layout.tsx`**

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f3f4f6' }}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Implementar `app/login/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const router = useRouter();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    const resposta = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    if (!resposta.ok) {
      const dados = await resposta.json();
      setErro(dados.erro || 'Erro ao entrar.');
      return;
    }
    router.push('/cenarios');
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: 24, background: '#fff', borderRadius: 12 }}>
      <h1 style={{ fontSize: 20 }}>Prática de Vendas — Apex</h1>
      <form onSubmit={enviar}>
        <input placeholder="Usuário" value={usuario} onChange={(e) => setUsuario(e.target.value)} style={{ width: '100%', padding: 10, marginBottom: 8 }} />
        <input placeholder="Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} style={{ width: '100%', padding: 10, marginBottom: 8 }} />
        {erro && <p style={{ color: '#b3101f', fontSize: 13 }}>{erro}</p>}
        <button type="submit" style={{ width: '100%', padding: 10, background: '#d0112e', color: '#fff', border: 'none', borderRadius: 8 }}>Entrar</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Implementar `app/cenarios/page.tsx`** (client component — precisa do `sessaoId` que a rota `iniciar` devolve, pra navegar até o chat certo)

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Cenario = { id: string; titulo: string; descricao: string };

export default function CenariosPage() {
  const [cenarios, setCenarios] = useState<Cenario[]>([]);
  const [erro, setErro] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/cenarios')
      .then((r) => r.json())
      .then(setCenarios);
  }, []);

  async function iniciar(cenarioId: string) {
    setErro('');
    const resposta = await fetch('/api/pratica/iniciar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cenarioId }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      setErro(dados.erro);
      return;
    }
    router.push(`/pratica/${dados.sessaoId}`);
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
      <h1>Escolha um cenário pra praticar</h1>
      {erro && <p style={{ color: '#b3101f' }}>{erro}</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        {cenarios.map((c) => (
          <button
            key={c.id}
            onClick={() => iniciar(c.id)}
            style={{ textAlign: 'left', padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, cursor: 'pointer' }}
          >
            <strong>{c.titulo}</strong>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{c.descricao}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implementar `app/api/cenarios/route.ts`** (a página do Step 3 busca a lista por aqui)

```typescript
import { NextResponse } from 'next/server';
import { listarCenariosAtivos } from '@/db/cenarios';

export async function GET() {
  const cenarios = await listarCenariosAtivos();
  return NextResponse.json(cenarios);
}
```

- [ ] **Step 5: Implementar `app/pratica/[sessaoId]/page.tsx`** (chat)

```tsx
'use client';
import { useState } from 'react';

export default function PraticaPage({ params }: { params: { sessaoId: string } }) {
  const [mensagens, setMensagens] = useState<{ remetente: 'consultor' | 'ia'; texto: string }[]>([]);
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState<{ nota: number; feedback: string } | null>(null);
  const [erro, setErro] = useState('');

  async function enviar() {
    if (!texto.trim()) return;
    setErro('');
    const textoEnviado = texto;
    setMensagens((m) => [...m, { remetente: 'consultor', texto: textoEnviado }]);
    setTexto('');

    const resposta = await fetch(`/api/pratica/${params.sessaoId}/mensagem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: textoEnviado }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      setErro(dados.erro);
      return;
    }
    setMensagens((m) => [...m, { remetente: 'ia', texto: dados.resposta }]);
  }

  async function encerrar() {
    setErro('');
    const resposta = await fetch(`/api/pratica/${params.sessaoId}/encerrar`, { method: 'POST' });
    const dados = await resposta.json();
    if (!resposta.ok) {
      setErro(dados.erro);
      return;
    }
    setResultado(dados);
  }

  return (
    <div style={{ maxWidth: 600, margin: '20px auto', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, minHeight: 400, marginBottom: 12 }}>
        {mensagens.map((m, i) => (
          <div key={i} style={{ textAlign: m.remetente === 'consultor' ? 'right' : 'left', margin: '8px 0' }}>
            <span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: 10, background: m.remetente === 'consultor' ? '#d0112e' : '#e5e7eb', color: m.remetente === 'consultor' ? '#fff' : '#181818' }}>
              {m.texto}
            </span>
          </div>
        ))}
      </div>
      {erro && <p style={{ color: '#b3101f' }}>{erro}</p>}
      {!resultado ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviar()} style={{ flex: 1, padding: 10 }} placeholder="Digite sua mensagem..." />
          <button onClick={enviar} style={{ padding: '10px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8 }}>Enviar</button>
          <button onClick={encerrar} style={{ padding: '10px 16px', background: '#181818', color: '#fff', border: 'none', borderRadius: 8 }}>Encerrar</button>
        </div>
      ) : (
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2>Nota: {resultado.nota}/100</h2>
          <p>{resultado.feedback}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Implementar `app/historico/page.tsx`**

```tsx
import { cookies } from 'next/headers';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { listarSessoesPorUsuario } from '@/db/sessoesPratica';

export default async function HistoricoPage() {
  const token = cookies().get('sessao')?.value ?? '';
  const dados = await verificarTokenSessao(token);
  if (!dados) return null;

  const sessoes = await listarSessoesPorUsuario(dados.usuarioId);

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
      <h1>Seu histórico</h1>
      <table style={{ width: '100%', background: '#fff', borderRadius: 10, borderCollapse: 'collapse' }}>
        <tbody>
          {sessoes.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: 10 }}>{new Date(s.iniciadoEm).toLocaleDateString('pt-BR')}</td>
              <td style={{ padding: 10 }}>{s.nota != null ? `${s.nota}/100` : 'Em andamento'}</td>
              <td style={{ padding: 10, fontSize: 13, color: '#6b7280' }}>{s.feedback ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Implementar `app/admin/page.tsx`**

```tsx
import { listarTodasSessoes } from '@/db/sessoesPratica';

export default async function AdminPage() {
  const sessoes = await listarTodasSessoes();

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 24 }}>
      <h1>Todas as sessões de prática</h1>
      <table style={{ width: '100%', background: '#fff', borderRadius: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 10 }}>Consultor</th>
            <th style={{ textAlign: 'left', padding: 10 }}>Data</th>
            <th style={{ textAlign: 'left', padding: 10 }}>Nota</th>
          </tr>
        </thead>
        <tbody>
          {sessoes.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: 10 }}>{s.nomeUsuario}</td>
              <td style={{ padding: 10 }}>{new Date(s.iniciadoEm).toLocaleDateString('pt-BR')}</td>
              <td style={{ padding: 10 }}>{s.nota != null ? `${s.nota}/100` : 'Em andamento'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add apex-smart-solutions/pratica-vendas/app/
git commit -m "feat: add login, scenario picker, chat, history and admin pages"
```

---

## Task 12: Provisionamento e deploy (manual — Rafael)

Nenhum destes passos pode ser feito por um assistente de IA: exigem login/OAuth em contas do Rafael (Vercel, provedor de banco).

- [ ] **Step 1: Criar um projeto novo na Vercel** apontando pra pasta `apex-smart-solutions/pratica-vendas`.

- [ ] **Step 2: Provisionar um banco Postgres** (Vercel Postgres, ou Neon direto) e copiar a `DATABASE_URL`.

- [ ] **Step 3: Rodar o schema no banco novo**

Run (com `DATABASE_URL` configurada no ambiente): `psql "$DATABASE_URL" -f apex-smart-solutions/pratica-vendas/db/schema.sql`

- [ ] **Step 4: Gerar uma nova chave de API da Anthropic**, revogando a que foi colada no chat durante o brainstorming (nota de segurança da spec, seção 9).

- [ ] **Step 5: Gerar o `SESSION_SECRET`**

Run: `openssl rand -hex 32`

- [ ] **Step 6: Configurar as 3 variáveis de ambiente na Vercel** (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`) e localmente em `.env.local` (mesmo formato do `.env.example`, nunca commitado).

- [ ] **Step 7: Rodar o seed**

Run: `cd apex-smart-solutions/pratica-vendas && npx tsx db/seed.ts`
Expected: mensagem confirmando cenários inseridos e usuário "rafael" criado.

- [ ] **Step 8: Deploy**

Run: `cd apex-smart-solutions/pratica-vendas && npx vercel --prod` (ou pelo painel da Vercel, conectando o repositório)

- [ ] **Step 9: Testar o fluxo completo manualmente** — login com o usuário "rafael", escolher um cenário, trocar pelo menos 3 mensagens, encerrar e conferir que a nota/feedback fazem sentido, checar o histórico e o painel admin.

- [ ] **Step 10: Criar um usuário por consultor** (via `criarUsuario`, Task 8, ou uma tela de admin futura — nesta v1 pode ser feito rodando um script simples uma vez).
