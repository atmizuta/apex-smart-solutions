# CRM Fibra — Dashboard e Navegação (Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir a navegação e as telas de Dashboard/Carteira de Leads do CRM Fibra com sidebar, cards de KPI, gráfico de composição e paginação de verdade, mantendo a identidade visual Apex/Claro.

**Architecture:** Introduz Tailwind CSS + shadcn/ui (style "new-york") como stack de componentes, mapeando os tokens de cor "Sinal de Ápice" já existentes para as variáveis de tema do shadcn. Sidebar via `SidebarProvider`/`Sidebar` do shadcn substitui a topbar atual. Lógica de exibição/formatação (visibilidade do menu admin, rótulos/cores de camada, montagem de URL de filtro/paginação, dados do donut) fica isolada em pequenos módulos `lib/` puros e testados; a paginação da carteira de leads passa a ser feita no servidor (um `.range()` por página, com `count: "exact"`), em vez de carregar a tabela inteira.

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v3, shadcn/ui, recharts, lucide-react, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-crm-fibra-dashboard-redesign-design.md`

## Status: Task 1 já está completo

Task 1 (instalação e configuração do Tailwind CSS + shadcn/ui) já foi executado e commitado nesta branch (`feature/crm-fibra-dashboard-redesign`, commit `78df2a6`) durante a escrita deste plano — o CLI do shadcn precisou ser verificado ao vivo (seu comando `init` padrão depende de uma chamada de rede que falhou neste ambiente; o workaround usado está documentado na mensagem do commit) e os arquivos gerados foram inspecionados pra garantir que as instruções abaixo, nos próximos tasks, usem a API real dos componentes instalados, não suposições. A execução deste plano (por subagente ou nativa) começa no **Task 2**.

Conteúdo do Task 1, para referência de quem revisar:
- `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `lib/utils.ts` (hand-written)
- `components/ui/{button,card,table,badge,separator,tooltip,input,sheet,skeleton,avatar,pagination,sidebar,chart}.tsx` + `hooks/use-mobile.tsx` (via `npx shadcn@latest add`)
- `app/globals.css`: adiciona `@tailwind base/components/utilities`, mapeia `--background`, `--primary`, etc. para os tokens Apex existentes (`--sinal`, `--bordo`...), e um bloco `--sidebar-*` em HSL (convenção própria do componente sidebar do shadcn — ver comentário no arquivo)
- Verificado: `tsc --noEmit` limpo, suite de testes 66/66, `next build` de produção com sucesso

## Global Constraints

- Não remover nem renomear as variáveis CSS já existentes antes deste plano (`--sinal`, `--carmim`, `--bordo`, `--grafite`, `--cinza`, `--papel`, `--rosa`) — telas fora de escopo (login, consultores, lead detail) dependem delas.
- Tamanho de página padrão da carteira de leads: **25** (constante `TAMANHO_PAGINA_PADRAO`).
- Stack de UI já decidida e instalada (Task 1): Tailwind CSS v3 + shadcn/ui, style "new-york". Não trocar de biblioteca nem reinstalar.
- Biblioteca de gráfico: `recharts`, via o wrapper `ChartContainer`/`ChartTooltip` do shadcn (`components/ui/chart.tsx`).
- Não introduzir `@testing-library/react` nem testes de renderização de componente — este projeto testa lógica pura em `lib/` (sem DOM) e verifica telas manualmente; mantenha esse padrão.
- Next.js 16 App Router: `params`/`searchParams` são `Promise` — todo handler de página novo precisa `await` neles, igual ao código já existente.
- `/atualizar-base` (Task 6) é só um placeholder — não implementar upload de planilha aqui; é um sub-projeto futuro à parte.

## Review Focus

- Seção "Administração" da sidebar aparecendo pra consultor comum (vazamento de função admin) — testado no Task 2 (`lib/sidebar-visibilidade.test.ts`).
- Trocar filtro ou busca na carteira sem resetar pra página 1 (usuário cai numa página vazia sem explicação) — testado no Task 5 (`lib/leads-urls.test.ts`: o link de filtro nunca inclui `pagina=`).
- Cálculo do donut de renovação dando "sem elegibilidade" negativo quando a base está vazia ou os números não batem exatamente — testado no Task 3 (`lib/camadas.test.ts`).
- Pedir uma página de paginação além do que existe (ex. página 50 de um filtro com 2 resultados) quebrando a tela em vez de mostrar lista vazia — testado no Task 5 (`lib/leads.test.ts`).
- Variáveis CSS Apex existentes sendo removidas/renomeadas sem querer ao mexer em `globals.css` — já verificado no Task 1 (build + suite completa passando com os tokens originais intactos); Global Constraint acima deixa isso explícito pros tasks seguintes.

---

### Task 2: AppSidebar — navegação em sidebar substituindo a topbar

**Files:**
- Create: `crm-fibra/lib/sidebar-visibilidade.ts`
- Create: `crm-fibra/lib/sidebar-visibilidade.test.ts`
- Create: `crm-fibra/components/app-sidebar.tsx`
- Modify: `crm-fibra/app/(protected)/layout.tsx`
- Delete: `crm-fibra/app/(protected)/top-bar.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores além do Task 1 (componentes shadcn já instalados).
- Produces: `AppSidebar({ nome, papel, children }: { nome: string; papel: "admin" | "consultor"; children: React.ReactNode })` — usado pelo `layout.tsx`. `deveMostrarAdministracao(papel): boolean`, exportado de `lib/sidebar-visibilidade.ts`. O item "Atualizar base" linka para `/atualizar-base`, que só existe a partir do Task 6 — referência futura intencional (mesmo padrão já usado no Plano 2 deste projeto para o Task 7↔9).

- [ ] **Step 1: Escreva o teste de `deveMostrarAdministracao`**

Crie `crm-fibra/lib/sidebar-visibilidade.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deveMostrarAdministracao } from "./sidebar-visibilidade";

describe("deveMostrarAdministracao", () => {
  it("retorna true para admin", () => {
    expect(deveMostrarAdministracao("admin")).toBe(true);
  });

  it("retorna false para consultor", () => {
    expect(deveMostrarAdministracao("consultor")).toBe(false);
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npm test -- sidebar-visibilidade`
Expected: FAIL — `Cannot find module './sidebar-visibilidade'`

- [ ] **Step 3: Implemente `lib/sidebar-visibilidade.ts`**

```ts
export function deveMostrarAdministracao(papel: "admin" | "consultor"): boolean {
  return papel === "admin";
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `npm test -- sidebar-visibilidade`
Expected: PASS (2 testes)

- [ ] **Step 5: Crie o componente `AppSidebar`**

Crie `crm-fibra/components/app-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users2, UserCog, UploadCloud, LogOut } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { deveMostrarAdministracao } from "@/lib/sidebar-visibilidade";

const ITENS_PRINCIPAIS = [
  { href: "/dashboard", rotulo: "Dashboard", Icone: LayoutDashboard },
  { href: "/leads", rotulo: "Carteira de Leads", Icone: Users2 },
];

const ITENS_ADMIN = [
  { href: "/consultores", rotulo: "Consultores", Icone: UserCog },
  { href: "/atualizar-base", rotulo: "Atualizar base", Icone: UploadCloud },
];

export function AppSidebar({
  nome,
  papel,
  children,
}: {
  nome: string;
  papel: "admin" | "consultor";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function sair() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="font-head text-lg font-semibold uppercase tracking-wide text-sidebar-primary">
              CRM Fibra
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {ITENS_PRINCIPAIS.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(item.href)}
                      tooltip={item.rotulo}
                    >
                      <Link href={item.href}>
                        <item.Icone />
                        <span>{item.rotulo}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {deveMostrarAdministracao(papel) && (
            <SidebarGroup>
              <SidebarGroupLabel>Administração</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {ITENS_ADMIN.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname.startsWith(item.href)}
                        tooltip={item.rotulo}
                      >
                        <Link href={item.href}>
                          <item.Icone />
                          <span>{item.rotulo}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex flex-col px-2 py-1 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
                <span className="font-medium text-sidebar-foreground">{nome}</span>
                <span className="capitalize">{papel}</span>
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={sair} tooltip="Sair">
                <LogOut />
                <span>Sair</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 6: Troque o layout protegido pra usar o `AppSidebar`**

Substitua o conteúdo de `crm-fibra/app/(protected)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId } from "@/lib/consultores";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { AppSidebar } from "@/components/app-sidebar";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    redirect("/login");
  }

  // Authoritative check: even a still-valid, correctly-signed JWT is
  // rejected if the consultor was deactivated since it was issued. This
  // runs on every request to a protected page, unlike the middleware
  // (Task 9 of Plan 1), which only checks the token's signature/expiry
  // for speed.
  const consultor = await buscarConsultorPorId(getSupabaseAdmin(), session.consultorId);
  if (!consultor || !consultor.ativo) {
    redirect("/login");
  }

  return (
    <AppSidebar nome={consultor.nome} papel={consultor.papel}>
      {children}
    </AppSidebar>
  );
}
```

- [ ] **Step 7: Apague o `top-bar.tsx`, agora sem uso**

Run: `rm "crm-fibra/app/(protected)/top-bar.tsx"`

- [ ] **Step 8: Verifique o build**

Run: `cd crm-fibra && npx tsc --noEmit && npm test`
Expected: tsc sem erros; suite de testes toda passando (incluindo os 2 novos de `sidebar-visibilidade`)

- [ ] **Step 9: Commit**

```bash
git add crm-fibra/lib/sidebar-visibilidade.ts crm-fibra/lib/sidebar-visibilidade.test.ts crm-fibra/components/app-sidebar.tsx "crm-fibra/app/(protected)/layout.tsx" "crm-fibra/app/(protected)/top-bar.tsx"
git commit -m "feat(crm-fibra): replace topbar with collapsible sidebar navigation"
```

---

### Task 3: Componentes compartilhados — `lib/camadas.ts`, `KpiCard`, `CamadaBadges`

**Files:**
- Create: `crm-fibra/lib/camadas.ts`
- Create: `crm-fibra/lib/camadas.test.ts`
- Create: `crm-fibra/components/kpi-card.tsx`
- Create: `crm-fibra/components/camada-badges.tsx`

**Interfaces:**
- Consumes: `ContagemCamadas`, `LeadSegmentado` de `@/lib/leads` (já existem, sem mudança).
- Produces: `rotuloCamadaRenovacao(camada): string`, `corCamadaRenovacao(camada): string`, `dadosDonutRenovacao(contagem: ContagemCamadas): FatiaRenovacao[]` (de `lib/camadas.ts` — Task 4 consome `dadosDonutRenovacao`). `KpiCard({ rotulo, valor, href, Icone })` e `CamadaBadges({ camadaFibra, camadaRenovacao })` (Task 4 e 5 consomem).

- [ ] **Step 1: Escreva os testes de `lib/camadas.ts`**

Crie `crm-fibra/lib/camadas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rotuloCamadaRenovacao, corCamadaRenovacao, dadosDonutRenovacao } from "./camadas";

describe("rotuloCamadaRenovacao", () => {
  it("traduz cada camada pro rótulo em português", () => {
    expect(rotuloCamadaRenovacao("apto_agora")).toBe("Apto agora");
    expect(rotuloCamadaRenovacao("apto_1_mes")).toBe("Apto em 1 mês");
    expect(rotuloCamadaRenovacao("apto_2_meses")).toBe("Apto em 2 meses");
  });
});

describe("corCamadaRenovacao", () => {
  it("retorna uma classe de cor diferente para cada camada", () => {
    const cores = [
      corCamadaRenovacao("apto_agora"),
      corCamadaRenovacao("apto_1_mes"),
      corCamadaRenovacao("apto_2_meses"),
    ];
    expect(new Set(cores).size).toBe(3);
  });
});

describe("dadosDonutRenovacao", () => {
  it("calcula sem elegibilidade como o restante do total", () => {
    const resultado = dadosDonutRenovacao({
      fibraCandidato: 0,
      aptoAgora: 10,
      apto1Mes: 2,
      apto2Meses: 3,
      semDono: 0,
      total: 20,
    });
    expect(resultado).toEqual([
      { nome: "Apto agora", valor: 10 },
      { nome: "Apto em 1 mês", valor: 2 },
      { nome: "Apto em 2 meses", valor: 3 },
      { nome: "Sem elegibilidade", valor: 5 },
    ]);
  });

  it("nunca retorna sem elegibilidade negativo quando total é 0", () => {
    const resultado = dadosDonutRenovacao({
      fibraCandidato: 0,
      aptoAgora: 0,
      apto1Mes: 0,
      apto2Meses: 0,
      semDono: 0,
      total: 0,
    });
    expect(resultado.find((f) => f.nome === "Sem elegibilidade")?.valor).toBe(0);
  });

  it("nunca retorna sem elegibilidade negativo mesmo se os números de entrada forem inconsistentes", () => {
    const resultado = dadosDonutRenovacao({
      fibraCandidato: 0,
      aptoAgora: 100,
      apto1Mes: 100,
      apto2Meses: 100,
      semDono: 0,
      total: 50,
    });
    expect(resultado.find((f) => f.nome === "Sem elegibilidade")?.valor).toBe(0);
  });
});
```

- [ ] **Step 2: Rode os testes e confirme que falham**

Run: `cd crm-fibra && npm test -- camadas`
Expected: FAIL — `Cannot find module './camadas'`

- [ ] **Step 3: Implemente `lib/camadas.ts`**

```ts
import type { ContagemCamadas, LeadSegmentado } from "./leads";

export type CamadaRenovacao = NonNullable<LeadSegmentado["camadaRenovacao"]>;

const ROTULOS: Record<CamadaRenovacao, string> = {
  apto_agora: "Apto agora",
  apto_1_mes: "Apto em 1 mês",
  apto_2_meses: "Apto em 2 meses",
};

const CORES: Record<CamadaRenovacao, string> = {
  apto_agora: "border-green-200 bg-green-100 text-green-800",
  apto_1_mes: "border-amber-200 bg-amber-100 text-amber-800",
  apto_2_meses: "border-orange-200 bg-orange-100 text-orange-800",
};

export function rotuloCamadaRenovacao(camada: CamadaRenovacao): string {
  return ROTULOS[camada];
}

export function corCamadaRenovacao(camada: CamadaRenovacao): string {
  return CORES[camada];
}

export interface FatiaRenovacao {
  nome: string;
  valor: number;
}

export function dadosDonutRenovacao(contagem: ContagemCamadas): FatiaRenovacao[] {
  const semElegibilidade = Math.max(
    contagem.total - contagem.aptoAgora - contagem.apto1Mes - contagem.apto2Meses,
    0
  );
  return [
    { nome: rotuloCamadaRenovacao("apto_agora"), valor: contagem.aptoAgora },
    { nome: rotuloCamadaRenovacao("apto_1_mes"), valor: contagem.apto1Mes },
    { nome: rotuloCamadaRenovacao("apto_2_meses"), valor: contagem.apto2Meses },
    { nome: "Sem elegibilidade", valor: semElegibilidade },
  ];
}
```

- [ ] **Step 4: Rode os testes e confirme que passam**

Run: `cd crm-fibra && npm test -- camadas`
Expected: PASS (5 testes)

- [ ] **Step 5: Crie o `KpiCard`**

Crie `crm-fibra/components/kpi-card.tsx`:

```tsx
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function KpiCard({
  rotulo,
  valor,
  href,
  Icone,
}: {
  rotulo: string;
  valor: number;
  href: string;
  Icone: LucideIcon;
}) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-primary">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icone className="h-5 w-5" />
          </div>
          <div>
            <div className="font-head text-2xl font-semibold text-foreground">
              {valor.toLocaleString("pt-BR")}
            </div>
            <div className="text-xs text-muted-foreground">{rotulo}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 6: Crie o `CamadaBadges`**

Crie `crm-fibra/components/camada-badges.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { corCamadaRenovacao, rotuloCamadaRenovacao } from "@/lib/camadas";
import type { LeadSegmentado } from "@/lib/leads";

export function CamadaBadges({
  camadaFibra,
  camadaRenovacao,
}: {
  camadaFibra: LeadSegmentado["camadaFibra"];
  camadaRenovacao: LeadSegmentado["camadaRenovacao"];
}) {
  if (!camadaFibra && !camadaRenovacao) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {camadaFibra === "fibra_candidato" && (
        <Badge variant="outline" className="border-sky-200 bg-sky-100 text-sky-800">
          Fibra
        </Badge>
      )}
      {camadaRenovacao && (
        <Badge variant="outline" className={corCamadaRenovacao(camadaRenovacao)}>
          {rotuloCamadaRenovacao(camadaRenovacao)}
        </Badge>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verifique o build**

Run: `cd crm-fibra && npx tsc --noEmit && npm test`
Expected: tsc sem erros; suite de testes toda passando

- [ ] **Step 8: Commit**

```bash
git add crm-fibra/lib/camadas.ts crm-fibra/lib/camadas.test.ts crm-fibra/components/kpi-card.tsx crm-fibra/components/camada-badges.tsx
git commit -m "feat(crm-fibra): add camada formatting helpers, KpiCard and CamadaBadges"
```

---

### Task 4: Dashboard — cards de KPI + donut de renovação

**Files:**
- Create: `crm-fibra/components/renovacao-donut.tsx`
- Modify: `crm-fibra/app/(protected)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `contarPorCamada` de `@/lib/leads` (sem mudança de assinatura); `dadosDonutRenovacao` e `FatiaRenovacao` de `@/lib/camadas` (Task 3); `KpiCard` de `@/components/kpi-card` (Task 3).
- Produces: nada consumido por tasks seguintes.

Sem teste novo neste task: a lógica de dados (`dadosDonutRenovacao`) já foi testada no Task 3; `dashboard/page.tsx` não tinha teste próprio antes deste plano (mesmo padrão do projeto) e `RenovacaoDonut` é puramente apresentacional.

- [ ] **Step 1: Crie o `RenovacaoDonut`**

Crie `crm-fibra/components/renovacao-donut.tsx`:

```tsx
"use client";

import { Cell, Pie, PieChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { FatiaRenovacao } from "@/lib/camadas";

const CORES = ["#16a34a", "#f59e0b", "#fb923c", "#9ca3af"];

const chartConfig = {
  valor: { label: "Leads" },
} satisfies ChartConfig;

export function RenovacaoDonut({ dados }: { dados: FatiaRenovacao[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Composição de renovação</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[280px]">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="nome" />} />
            <Pie data={dados} dataKey="valor" nameKey="nome" innerRadius={60} outerRadius={100}>
              {dados.map((_, index) => (
                <Cell key={index} fill={CORES[index % CORES.length]} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="mt-4 flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
          {dados.map((fatia, index) => (
            <li key={fatia.nome} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: CORES[index % CORES.length] }}
              />
              {fatia.nome} ({fatia.valor})
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Reescreva `dashboard/page.tsx`**

Substitua o conteúdo de `crm-fibra/app/(protected)/dashboard/page.tsx`:

```tsx
import { Clock3, Clock9, LayoutGrid, RefreshCw, UserX, Wifi } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { contarPorCamada } from "@/lib/leads";
import { dadosDonutRenovacao } from "@/lib/camadas";
import { KpiCard } from "@/components/kpi-card";
import { RenovacaoDonut } from "@/components/renovacao-donut";

export default async function DashboardPage() {
  const contagem = await contarPorCamada(getSupabaseAdmin());

  const cards = [
    { rotulo: "Candidatos a fibra", valor: contagem.fibraCandidato, href: "/leads?camada=fibra_candidato", Icone: Wifi },
    { rotulo: "Aptos a renovar agora", valor: contagem.aptoAgora, href: "/leads?camada=apto_agora", Icone: RefreshCw },
    { rotulo: "Aptos em 1 mês", valor: contagem.apto1Mes, href: "/leads?camada=apto_1_mes", Icone: Clock3 },
    { rotulo: "Aptos em 2 meses", valor: contagem.apto2Meses, href: "/leads?camada=apto_2_meses", Icone: Clock9 },
    { rotulo: "Sem consultor atribuído", valor: contagem.semDono, href: "/leads?camada=sem_dono", Icone: UserX },
    { rotulo: "Total de clientes na base", valor: contagem.total, href: "/leads?camada=todos", Icone: LayoutGrid },
  ];

  return (
    <div className="space-y-6">
      <h2>Dashboard</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <KpiCard key={c.rotulo} rotulo={c.rotulo} valor={c.valor} href={c.href} Icone={c.Icone} />
        ))}
      </div>
      <RenovacaoDonut dados={dadosDonutRenovacao(contagem)} />
    </div>
  );
}
```

- [ ] **Step 3: Verifique o build**

Run: `cd crm-fibra && npx tsc --noEmit && npm test`
Expected: tsc sem erros; suite de testes toda passando

- [ ] **Step 4: Commit**

```bash
git add crm-fibra/components/renovacao-donut.tsx "crm-fibra/app/(protected)/dashboard/page.tsx"
git commit -m "feat(crm-fibra): redesign dashboard with KPI cards and renovação donut chart"
```

---

### Task 5: Carteira de Leads — paginação server-side, badges e tabela redesenhada

**Files:**
- Create: `crm-fibra/lib/leads-urls.ts`
- Create: `crm-fibra/lib/leads-urls.test.ts`
- Modify: `crm-fibra/lib/leads.ts`
- Modify: `crm-fibra/lib/leads.test.ts`
- Modify: `crm-fibra/app/(protected)/leads/filtro-bar.tsx`
- Modify: `crm-fibra/app/(protected)/leads/page.tsx`

**Interfaces:**
- Consumes: `CamadaBadges` de `@/components/camada-badges` (Task 3); `listarConsultores` de `@/lib/consultores` (já existe).
- Produces: `listarLeadsSegmentados(client, filtro, busca?, pagina = 1, tamanhoPagina = TAMANHO_PAGINA_PADRAO): Promise<{ leads: LeadSegmentado[]; total: number }>` — mudança de assinatura e de retorno em relação ao que existia antes deste plano (antes retornava `LeadSegmentado[]` direto). `TAMANHO_PAGINA_PADRAO` exportado de `lib/leads.ts`. `hrefCarteiraFiltrada(filtro, busca)` e `hrefCarteiraPagina(filtro, busca, pagina)` de `lib/leads-urls.ts`.

- [ ] **Step 1: Escreva os testes de `lib/leads-urls.ts`**

Crie `crm-fibra/lib/leads-urls.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hrefCarteiraFiltrada, hrefCarteiraPagina } from "./leads-urls";

describe("hrefCarteiraFiltrada", () => {
  it("nunca inclui o parâmetro pagina — trocar filtro ou busca sempre volta pra página 1", () => {
    const href = hrefCarteiraFiltrada("apto_agora", "acme");
    expect(href).not.toContain("pagina=");
  });

  it("monta camada e busca", () => {
    expect(hrefCarteiraFiltrada("apto_agora", "acme")).toBe("/leads?camada=apto_agora&busca=acme");
  });

  it("omite busca quando vazia", () => {
    expect(hrefCarteiraFiltrada("todos", "")).toBe("/leads?camada=todos");
  });
});

describe("hrefCarteiraPagina", () => {
  it("inclui filtro, busca e página", () => {
    expect(hrefCarteiraPagina("apto_agora", "acme", 3)).toBe(
      "/leads?camada=apto_agora&busca=acme&pagina=3"
    );
  });

  it("omite busca quando vazia", () => {
    expect(hrefCarteiraPagina("todos", "", 1)).toBe("/leads?camada=todos&pagina=1");
  });
});
```

- [ ] **Step 2: Rode os testes e confirme que falham**

Run: `cd crm-fibra && npm test -- leads-urls`
Expected: FAIL — `Cannot find module './leads-urls'`

- [ ] **Step 3: Implemente `lib/leads-urls.ts`**

```ts
import type { FiltroCamada } from "./leads";

export function hrefCarteiraFiltrada(filtro: FiltroCamada, busca: string): string {
  const params = new URLSearchParams();
  params.set("camada", filtro);
  if (busca) params.set("busca", busca);
  return `/leads?${params.toString()}`;
}

export function hrefCarteiraPagina(filtro: FiltroCamada, busca: string, pagina: number): string {
  const params = new URLSearchParams();
  params.set("camada", filtro);
  if (busca) params.set("busca", busca);
  params.set("pagina", String(pagina));
  return `/leads?${params.toString()}`;
}
```

- [ ] **Step 4: Rode os testes e confirme que passam**

Run: `cd crm-fibra && npm test -- leads-urls`
Expected: PASS (5 testes)

- [ ] **Step 5: Atualize os testes de `listarLeadsSegmentados` em `lib/leads.test.ts`**

No topo do arquivo, a função `makeQueryFake` já repassa qualquer campo extra da resposta (inclusive `count`) sem precisar de mudança — só o comentário de tipo precisa ficar mais preciso. Troque a assinatura:

```ts
function makeQueryFake(paginas: Array<{ data?: unknown; error?: unknown; count?: unknown }>) {
```

Troque o primeiro teste do bloco `describe("listarLeadsSegmentados", ...)`:

```ts
it("mapeia as linhas para o formato da aplicação", async () => {
  const client = makeQueryFake([{ data: [rowBase], error: null, count: 1 }]);
  const result = await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");
  expect(result.leads).toEqual([leadEsperado]);
  expect(result.total).toBe(1);
});
```

Remova inteiramente o teste `"busca todas as páginas quando a base tem mais de 1000 linhas (limite do PostgREST)"` (esse comportamento de loop interno some desta função — `contarPorCamada`, que continua usando `buscarTodasAsLinhas`, já cobre separadamente o caso de mais de 1000 linhas no teste `"também pagina além de 1000 linhas"` logo abaixo, sem mudança). No lugar dele, adicione:

```ts
it("usa a página 1 e tamanho de página 25 por padrão", async () => {
  const client = makeQueryFake([{ data: [], error: null, count: 0 }]);
  await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");
  expect(client.calls).toContainEqual({ method: "range", args: [0, 24] });
});

it("usa a página e o tamanho de página pedidos no range", async () => {
  const client = makeQueryFake([{ data: [], error: null, count: 0 }]);
  await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos", undefined, 3, 25);
  expect(client.calls).toContainEqual({ method: "range", args: [50, 74] });
});

it("retorna o total vindo do count da consulta, não da quantidade de linhas da página", async () => {
  const client = makeQueryFake([{ data: [rowBase], error: null, count: 437 }]);
  const result = await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");
  expect(result.leads).toHaveLength(1);
  expect(result.total).toBe(437);
});

it("retorna lista vazia nessa página mas mantém o total quando a página pedida está além do que existe", async () => {
  const client = makeQueryFake([{ data: [], error: null, count: 2 }]);
  const result = await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos", undefined, 5, 25);
  expect(result.leads).toEqual([]);
  expect(result.total).toBe(2);
});
```

As demais asserções do bloco (`filtra por camada_fibra`, `filtra por dono_consultor_id nulo`, `sanitiza texto de busca`, `não chama .or()`) continuam exatamente como estão — não dependem do formato do retorno, só verificam `client.calls`.

- [ ] **Step 6: Rode os testes e confirme que falham do jeito certo**

Run: `cd crm-fibra && npm test -- leads.test`
Expected: FAIL nos testes que esperam `result.leads`/`result.total` e nos de `range` com página — `listarLeadsSegmentados` ainda não foi alterada.

- [ ] **Step 7: Reescreva `listarLeadsSegmentados` em `lib/leads.ts`**

Adicione a constante logo antes da função (mantenha `buscarTodasAsLinhas` como está — `contarPorCamada`, logo abaixo, continua usando ela sem mudança):

```ts
export const TAMANHO_PAGINA_PADRAO = 25;

export interface ResultadoPaginado {
  leads: LeadSegmentado[];
  total: number;
}
```

Substitua a função `listarLeadsSegmentados` inteira por:

```ts
export async function listarLeadsSegmentados(
  client: SupabaseClient,
  filtro: FiltroCamada,
  busca?: string,
  pagina: number = 1,
  tamanhoPagina: number = TAMANHO_PAGINA_PADRAO
): Promise<ResultadoPaginado> {
  const buscaLimpa = busca ? sanitizarBusca(busca) : "";

  let query = client.schema("crm_fibra").from("leads_segmentados").select("*", { count: "exact" });

  if (filtro === "fibra_candidato") {
    query = query.eq("camada_fibra", "fibra_candidato");
  } else if (filtro === "apto_agora" || filtro === "apto_1_mes" || filtro === "apto_2_meses") {
    query = query.eq("camada_renovacao", filtro);
  } else if (filtro === "sem_dono") {
    query = query.is("dono_consultor_id", null);
  }

  if (buscaLimpa) {
    query = query.or(
      `razao_social.ilike.%${buscaLimpa}%,cidade.ilike.%${buscaLimpa}%,cnpj_digits.ilike.%${buscaLimpa}%`
    );
  }

  const from = (pagina - 1) * tamanhoPagina;
  const to = from + tamanhoPagina - 1;

  const { data, error, count } = await query
    .order("razao_social", { ascending: true })
    .order("cnpj_digits", { ascending: true })
    .range(from, to);

  if (error) throw error;

  return {
    leads: ((data as LeadRow[] | null) ?? []).map(toLead),
    total: count ?? 0,
  };
}
```

- [ ] **Step 8: Rode os testes e confirme que passam**

Run: `cd crm-fibra && npm test -- leads.test`
Expected: PASS (todos os testes do arquivo, incluindo os 4 novos de paginação)

- [ ] **Step 9: Reescreva `filtro-bar.tsx`**

Substitua o conteúdo de `crm-fibra/app/(protected)/leads/filtro-bar.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hrefCarteiraFiltrada } from "@/lib/leads-urls";
import type { FiltroCamada } from "@/lib/leads";

const OPCOES: { valor: FiltroCamada; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "fibra_candidato", rotulo: "Candidatos a fibra" },
  { valor: "apto_agora", rotulo: "Aptos agora" },
  { valor: "apto_1_mes", rotulo: "Aptos em 1 mês" },
  { valor: "apto_2_meses", rotulo: "Aptos em 2 meses" },
  { valor: "sem_dono", rotulo: "Sem dono" },
];

export function FiltroBar({
  filtroAtual,
  buscaAtual,
}: {
  filtroAtual: FiltroCamada;
  buscaAtual: string;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState(buscaAtual);

  function irPara(filtro: FiltroCamada, novaBusca: string) {
    router.push(hrefCarteiraFiltrada(filtro, novaBusca));
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {OPCOES.map((o) => (
        <Button
          key={o.valor}
          type="button"
          size="sm"
          variant={filtroAtual === o.valor ? "default" : "outline"}
          className="rounded-full"
          onClick={() => irPara(o.valor, busca)}
        >
          {o.rotulo}
        </Button>
      ))}
      <Input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") irPara(filtroAtual, busca);
        }}
        placeholder="Buscar por nome, cidade ou CNPJ"
        className="max-w-xs"
      />
      <Button type="button" size="sm" variant="secondary" onClick={() => irPara(filtroAtual, busca)}>
        Buscar
      </Button>
    </div>
  );
}
```

- [ ] **Step 10: Reescreva `leads/page.tsx`**

Substitua o conteúdo de `crm-fibra/app/(protected)/leads/page.tsx`:

```tsx
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { listarLeadsSegmentados, TAMANHO_PAGINA_PADRAO, type FiltroCamada } from "@/lib/leads";
import { listarConsultores } from "@/lib/consultores";
import { hrefCarteiraPagina } from "@/lib/leads-urls";
import { FiltroBar } from "./filtro-bar";
import { CamadaBadges } from "@/components/camada-badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const CAMADAS_VALIDAS: FiltroCamada[] = [
  "fibra_candidato",
  "apto_agora",
  "apto_1_mes",
  "apto_2_meses",
  "sem_dono",
  "todos",
];

function normalizarFiltro(valor: string | undefined): FiltroCamada {
  return CAMADAS_VALIDAS.includes(valor as FiltroCamada) ? (valor as FiltroCamada) : "todos";
}

function normalizarPagina(valor: string | undefined): number {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : 1;
}

function iniciais(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ camada?: string; busca?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const filtro = normalizarFiltro(params.camada);
  const busca = params.busca ?? "";
  const pagina = normalizarPagina(params.pagina);

  const admin = getSupabaseAdmin();
  const [{ leads, total }, consultores] = await Promise.all([
    listarLeadsSegmentados(admin, filtro, busca || undefined, pagina),
    listarConsultores(admin),
  ]);
  const nomePorConsultorId = new Map(consultores.map((c) => [c.id, c.nome]));
  const totalPaginas = Math.max(Math.ceil(total / TAMANHO_PAGINA_PADRAO), 1);

  return (
    <div>
      <h2>Carteira de leads</h2>
      <FiltroBar filtroAtual={filtro} buscaAtual={busca} />
      <p className="text-sm text-muted-foreground">{total} resultado(s)</p>
      <Table className="mt-3">
        <TableHeader>
          <TableRow>
            <TableHead>Razão Social</TableHead>
            <TableHead>Cidade</TableHead>
            <TableHead>ARPU</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Dono</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((l) => (
            <TableRow key={l.cnpjDigits}>
              <TableCell>
                <Link href={`/leads/${l.cnpjDigits}`} className="font-medium hover:underline">
                  {l.razaoSocial || l.cnpjDigits}
                </Link>
              </TableCell>
              <TableCell>{l.cidade ?? "-"}</TableCell>
              <TableCell>{l.arpu != null ? `R$ ${l.arpu.toFixed(2)}` : "-"}</TableCell>
              <TableCell>
                <CamadaBadges camadaFibra={l.camadaFibra} camadaRenovacao={l.camadaRenovacao} />
              </TableCell>
              <TableCell>
                {l.donoConsultorId ? (
                  <span
                    title={nomePorConsultorId.get(l.donoConsultorId) ?? "Consultor"}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary"
                  >
                    {iniciais(nomePorConsultorId.get(l.donoConsultorId) ?? "?")}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Sem dono</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPaginas > 1 && (
        <Pagination className="mt-4">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href={hrefCarteiraPagina(filtro, busca, Math.max(pagina - 1, 1))}
                className={pagina <= 1 ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
            {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink href={hrefCarteiraPagina(filtro, busca, p)} isActive={p === pagina}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href={hrefCarteiraPagina(filtro, busca, Math.min(pagina + 1, totalPaginas))}
                className={pagina >= totalPaginas ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
```

- [ ] **Step 11: Verifique o build**

Run: `cd crm-fibra && npx tsc --noEmit && npm test`
Expected: tsc sem erros; suite de testes toda passando

- [ ] **Step 12: Commit**

```bash
git add crm-fibra/lib/leads-urls.ts crm-fibra/lib/leads-urls.test.ts crm-fibra/lib/leads.ts crm-fibra/lib/leads.test.ts "crm-fibra/app/(protected)/leads/filtro-bar.tsx" "crm-fibra/app/(protected)/leads/page.tsx"
git commit -m "feat(crm-fibra): server-side pagination, badges and redesigned table for carteira de leads"
```

---

### Task 6: Placeholder admin — "Atualizar base"

**Files:**
- Create: `crm-fibra/app/(protected)/atualizar-base/page.tsx`

**Interfaces:**
- Consumes: `verifySessionToken`, `SESSION_COOKIE_NAME` de `@/lib/auth/session`; `buscarConsultorPorId` de `@/lib/consultores`; `getSupabaseAdmin` de `@/lib/supabase-admin` — mesmo padrão de gate usado em `app/(protected)/consultores/page.tsx`.
- Produces: resolve o link "Atualizar base" da sidebar (Task 2), que apontava pra uma rota inexistente até aqui.

Sem teste novo: segue o mesmo padrão de `consultores/page.tsx`, que também não tem teste de página dedicado neste projeto — a lógica de verificação de admin (`buscarConsultorPorId` + checagem de papel) já é coberta pelos testes existentes de `lib/consultores.test.ts`.

- [ ] **Step 1: Crie a página**

Crie `crm-fibra/app/(protected)/atualizar-base/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId } from "@/lib/consultores";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export default async function AtualizarBasePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const admin = getSupabaseAdmin();
  const consultorLogado = await buscarConsultorPorId(admin, session.consultorId);
  if (!consultorLogado || !consultorLogado.ativo || consultorLogado.papel !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div>
      <h2>Atualizar base</h2>
      <p className="mt-3 max-w-prose text-sm text-muted-foreground">
        Em breve: upload de planilha para atualizar a base de clientes
        diretamente por aqui, com validação e preview antes de confirmar.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verifique o build**

Run: `cd crm-fibra && npx tsc --noEmit && npm test`
Expected: tsc sem erros; suite de testes toda passando

- [ ] **Step 3: Commit**

```bash
git add "crm-fibra/app/(protected)/atualizar-base/page.tsx"
git commit -m "feat(crm-fibra): add placeholder admin page for future base upload feature"
```
