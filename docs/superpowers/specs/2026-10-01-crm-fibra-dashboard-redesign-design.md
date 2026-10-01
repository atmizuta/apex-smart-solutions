# CRM Fibra — Redesign do Dashboard e Navegação

**Data:** 2026-10-01
**Sub-projeto:** 1 de 5 (dashboard + navegação). Os demais — card de lead em tela
cheia, abordagem de vendas por IA, upload de planilha, exportação de
comparativo de fatura — têm specs e planos próprios, na ordem definida durante
o brainstorming.

## Contexto e motivação

O dashboard e a carteira de leads atuais (`app/(protected)/dashboard/page.tsx`,
`app/(protected)/leads/page.tsx`) usam estilo inline manual, sem biblioteca de
componentes, e a tabela de leads renderiza **todas** as linhas que batem no
filtro de uma vez — no filtro "Todos" isso é 6.532 linhas numa tabela só, sem
paginação. O usuário (que vai operar isso com os consultores reais) descreveu
o estado atual como "inutilizável" e "não dá pra verificar". Este sub-projeto
reconstrói o front-end: navegação em sidebar, dashboard com cards + gráfico de
composição, e carteira de leads paginada com indicadores visuais de status.

Referência visual: [Sales Management Dashboard (Figma Community)](https://www.figma.com/community/file/1116262005816244863/sales-management-dashboard)
— sidebar fina recolhível, cards de KPI com ícone, tabelas com indicadores
visuais, cantos arredondados. A paleta não é copiada: mantém-se a identidade
"Sinal de Ápice" já usada no login do CRM Fibra (`--sinal: #E30613`,
`--bordo: #520C07`, `--grafite`, `--cinza`, `--papel`, `--rosa`, Barlow
Condensed/Barlow).

## Fora de escopo (sub-projetos futuros)

- Card de lead em tela cheia (dados do cliente → linhas → proposta)
- Builder de proposta por linha e abordagem de vendas gerada por IA (Gemini)
- Upload de planilha para `public.clientes` (a tela "Atualizar base" deste
  sub-projeto é só um placeholder/link; a função de verdade é um sub-projeto
  à parte, por escrever numa tabela de produção já restaurada de uma
  corrupção recente)
- Exportação de comparativo de fatura (PNG/Word/PDF) e link direto pro
  WhatsApp

## Decisões já validadas com o usuário

- Manter a identidade visual clara da Apex/Claro, aplicada à estrutura do
  layout de referência (não migrar pra tema escuro)
- Dashboard e Carteira de Leads continuam como páginas separadas (clicar num
  card de KPI navega pra `/leads` filtrada, como hoje)
- O menu admin mostra as mesmas seções do consultor (Dashboard, Carteira) mais
  uma seção "Administração" (Consultores, Atualizar base)
- Gráfico de composição: um donut só para `camada_renovacao` (Apto agora /
  Apto em 1 mês / Apto em 2 meses / Sem elegibilidade) — não dá pra combinar
  com `camada_fibra` no mesmo donut porque são dimensões independentes (um
  lead pode ser candidato a fibra e apto a renovar ao mesmo tempo; um donut
  único faria os pedaços passarem de 100%)
- Tabela de leads ganha paginação de verdade e badges de status por linha

## Arquitetura

### Stack de UI (novo)

Introduz Tailwind CSS + shadcn/ui neste app (não existe hoje — o app usa
estilo inline). Decisão tomada para que os componentes fiquem reutilizáveis
pelos 4 sub-projetos seguintes, em vez de cada tela reconstruir sua própria
estilização do zero.

Dependências novas: `tailwindcss`, `postcss`, `autoprefixer`, `recharts`
(gráfico de donut — é o que os componentes de chart do shadcn usam por baixo),
`lucide-react` (ícones), `class-variance-authority`, `clsx`, `tailwind-merge`.
Componentes shadcn copiados para `components/ui/`: `button`, `card`, `table`,
`badge`, `separator`, `tooltip`, `pagination`, `sidebar`, `chart`.

Os tokens de cor existentes em `app/globals.css` (`--sinal`, `--bordo`,
`--grafite`, `--cinza`, `--papel`, `--rosa`) são preservados e mapeados para
as variáveis de tema que o shadcn espera (`--primary`, `--background`, etc.),
não substituídos — qualquer componente shadcn novo herda a paleta Apex
automaticamente.

### Navegação (sidebar)

Novo componente `components/app-sidebar.tsx` substitui
`app/(protected)/top-bar.tsx`. Sidebar fixa à esquerda, recolhível para modo
só-ícone (estado persistido em cookie, padrão do componente `sidebar` do
shadcn). Logo Apex no topo; nome + papel do usuário e botão "Sair" no rodapé
(hoje isso fica numa topbar horizontal).

Itens (todo usuário autenticado):
- Dashboard → `/dashboard`
- Carteira de Leads → `/leads`

Seção "Administração" (renderizada só quando `papel === 'admin'`, com
separador visual):
- Consultores → `/consultores`
- Atualizar base → `/atualizar-base` (página placeholder: título, texto "em
  breve", sem lógica — o sub-projeto 4 implementa de verdade)

`app/(protected)/layout.tsx` passa a renderizar essa sidebar (via o
`SidebarProvider`/`SidebarInset` do shadcn) em vez do `<TopBar>` atual. A
checagem de sessão/`ativo` ao vivo que já existe nesse layout (Task 10 do
Plano 1) não muda — só a casca visual em volta do `children`.

### Dashboard (`app/(protected)/dashboard/page.tsx`)

Continua chamando `contarPorCamada` (sem mudança de assinatura — já retorna
tudo que a tela precisa: `fibraCandidato`, `aptoAgora`, `apto1Mes`,
`apto2Meses`, `semDono`, `total`).

Layout: grid de 6 `KpiCard` (novo componente `components/kpi-card.tsx` —
ícone + número grande + rótulo, link para `/leads?camada=X`, mesmo
comportamento de clique de hoje) seguido de um card com o donut de renovação
(componente `components/renovacao-donut.tsx`, usando `recharts` via o
wrapper `chart` do shadcn). O donut é derivado dos mesmos 4 números que já
vêm de `contarPorCamada` — "Sem elegibilidade" = `total - aptoAgora -
apto1Mes - apto2Meses`. Nenhuma nova consulta ao banco.

### Carteira de Leads (`app/(protected)/leads/page.tsx`)

**Paginação server-side** (mudança real de comportamento, não só visual): a
assinatura de `listarLeadsSegmentados` em `lib/leads.ts` passa a receber
`pagina` e `tamanhoPagina` (padrão 25) e retornar `{ leads, total }`, usando
`.range()` para buscar só a página pedida em vez de paginar internamente até
trazer a tabela inteira (como `buscarTodasAsLinhas` faz hoje) — hoje uma busca
sem filtro transfere as 6.532 linhas pro servidor Next.js a cada carregamento
de página, mesmo mostrando só uma fração. `contarPorCamada` (usado só no
dashboard, 6 números agregados) não muda — está fora do caminho que causa o
problema de volume.

A página lê `pagina` de `searchParams` (um novo parâmetro de URL, junto de
`camada` e `busca` que já existem) e renderiza controles de paginação
(componente `pagination` do shadcn) abaixo da tabela.

**Badges de status por linha**: novo componente `components/camada-badge.tsx`
— renderiza uma etiqueta colorida por `camada_fibra`/`camada_renovacao` do
lead (ex.: "Fibra", "Apto agora"), adicionada como coluna na tabela. O "Dono"
ganha um indicador visual simples (iniciais em círculo) em vez de só o texto
"Atribuído"/"Sem dono".

Filtros (`FiltroBar`) e busca mantêm a lógica atual
(`sanitizarBusca`/`.ilike`), só com o visual redesenhado (pills do shadcn em
vez de `<button>` com estilo inline); ao trocar filtro ou busca, a página
reseta para `pagina=1`.

### Responsividade

O componente `sidebar` do shadcn já vem com comportamento mobile embutido
(vira um drawer/sheet sobre o conteúdo em telas estreitas, em vez de
empurrar o layout) — usado como vem, sem customização extra. Cards de KPI e
tabela usam grid responsivo (`grid-cols-1` em telas estreitas, `grid-cols-3`
ou mais em telas largas), mesmo padrão simples que as páginas atuais já
seguem.

### Tela placeholder "Atualizar base"

`app/(protected)/atualizar-base/page.tsx`: gate de admin idêntico ao de
`/consultores` (redireciona pra `/dashboard` se não for admin), conteúdo
estático ("Em breve") — sem lógica de upload. O sub-projeto 4 substitui o
conteúdo desta página.

## Testes

- `lib/leads.test.ts`: novos casos para `listarLeadsSegmentados` cobrindo
  paginação (`.range()` chamado com os offsets certos por página, `total`
  correto vindo de uma contagem separada)
- Teste do gate de admin na nova página `/atualizar-base` (mesmo padrão do
  teste já existente para `/consultores`)
- Teste de que a seção "Administração" da sidebar só renderiza para
  `papel === 'admin'`
- Sem mudança nos testes de `consultores.ts`, `auth/*`, `whatsapp.ts` — fora
  do escopo deste sub-projeto

## Riscos e decisões em aberto

- Introduzir Tailwind + shadcn é a maior mudança estrutural deste
  sub-projeto; o plano de implementação deve ter uma task inicial só de
  setup (instalar, configurar, mapear tokens de cor) com um critério de
  verificação visual antes de tocar nas páginas de verdade.
- Paginação server-side muda o contrato de `listarLeadsSegmentados` — qualquer
  código futuro que já dependa da assinatura antiga (nenhum existe hoje fora
  da própria página de leads) precisa ser atualizado junto.
