# Conversão dos leads em Meus leads + perfil Agência + fim da aba Digital (§138)

**Data:** 05/11/2026 · **Pedido:** Rafael · **Seção do REGRAS:** §138 (fases §138.1, §138.2, §138.3)

## 1. Por que

Os leads vão deixar de passar pela planilha do Google (§137, webhook da Meta). A planilha era onde a
agência de marketing, a supervisão e a diretoria acompanhavam o resultado dos anúncios. Sem ela, o
painel precisa de uma tela de **conversão** clara: mês a mês, todos os consultores, quantos leads,
quantos convertidos, taxa e receita, com a agência entrando por **login próprio**.

Junto com isso, tudo que é de lead passa a morar em **Meus leads**: a aba **Digital** deixa de existir
(a conversão antiga é apagada; o Monitoramento Leads muda de casa).

## 2. Decisões do Rafael (brainstorming de 04–05/11)

| Tema | Decisão |
|---|---|
| Acesso da agência | Login próprio no painel (perfil novo "Agência"); vê só Meus leads → Conversão |
| Visual | O do redesign de Meus leads (§126), não o da Digital antiga |
| Onde fica | Sub-aba **Conversão** dentro de Meus leads |
| Quem vê a Conversão | Agência, admin, supervisor **e consultor** (todos veem a equipe inteira) |
| Mês do lead convertido | Mês em que o lead **chegou** (a guia do lead: AGOSTO, SETEMBRO…), como na planilha |
| Layout | Ideia A: cartões dos meses no topo + 4 números do mês + ranking por receita |
| Repique | Cartão separado no fim ("recontato"), fora das comparações |
| Leads sem dono | Linha "Ainda sem consultor" no ranking |
| Monitoramento Leads | Vai **inteiro** (10 blocos) para a sub-aba Monitoramento de Meus leads, visual novo, sem mudar a lógica |
| Conversão antiga | Apagada (Meus leads e retornos, Falha comercial, Funil por status, conferência NeoCRM, Atualizar agora) |
| "Meus leads para tratar" | Sai |
| Entrega | 3 fases publicadas separadamente |

Maquete aprovada: `.superpowers/brainstorm/733-1793822400/content/conversao-layout.html` (ideia A; local, fora do git).

## 3. Segurança do perfil Agência (parte mais delicada)

### 3.1 O problema

O banco hoje só conhece `admin`, `supervisor` e `consultor` (`profiles_role_check`). Várias regras foram
escritas pensando que **todo login é da casa**:

- 7 tabelas leem para qualquer login: `clientes`, `producao_pedidos_neo`, `producao_pedidos_manual`,
  `config`, `cobertura_kmz`, `leads_status_opcoes`, `objecoes_respostas`;
- ~50 funções RPC executáveis por qualquer login, parte delas sem checar perfil (ex.: `leads_pegar`,
  `producao_meus_pedidos`, `reconciliacao_neocrm`, `discador_*`, `bf_*`), e as que checam costumam tratar
  "não é admin/supervisor" como consultor.

Esconder abas no painel não protege nada: com a sessão da agência dá para chamar a API direto.

### 3.2 Caminho escolhido (recomendado): papel de banco próprio, negado por padrão

O Supabase deixa um **gancho de token** (Auth → Hooks → *Custom Access Token*) trocar o claim `role`
do JWT. O PostgREST faz `SET ROLE` para esse papel em cada requisição. Então:

1. `create role agencia nologin noinherit;` e `grant agencia to authenticator;`
2. O papel recebe **só** `execute` em duas funções `security definer`:
   - `public.meu_perfil()`: devolve a linha do próprio usuário em `profiles`. O login da agência lê o
     perfil por ela, não pela tabela, porque o esquema `auth` não dá `usage` ao Postgres para repassar,
     e a policy de `profiles` chama `auth.uid()` (levantamento de 05/11);
   - `public.conversao_resumo()`.
   O `usage` no esquema `public` já vem do `PUBLIC`.
3. **Funções abertas ao `PUBLIC`:** todo papel herda o que o `PUBLIC` tem. Em 05/11, 19 funções nossas
   (fora as de extensão) davam `execute` ao `PUBLIC`. A migration troca isso por `execute` explícito
   para `anon, authenticated, service_role` (o comportamento deles não muda) e ajusta os privilégios
   padrão do esquema, para funções futuras também não nascerem abertas ao `PUBLIC`.
4. Função `public.apex_token_hook(event jsonb) returns jsonb`: se `profiles.role = 'agencia'` para
   `event->>'user_id'`, troca `claims.role` para `'agencia'`; em **qualquer** outro caso devolve o evento
   intacto. Tem `exception when others then return event` (um erro no gancho nunca derruba o login
   dos outros). `grant execute … to supabase_auth_admin`, `revoke … from authenticated, anon, public`;
   `grant select on public.profiles to supabase_auth_admin` + policy de leitura para ele.
5. **Ativar o gancho é manual** (Rafael, no dashboard: Authentication → Hooks → Custom Access Token →
   `public.apex_token_hook`). Desligar é o mesmo interruptor: é o "voltar atrás" da segurança.

Resultado: tudo que não foi concedido ao papel `agencia` é **negado pelo próprio Postgres**: as 7
tabelas, as ~50 RPCs, Storage e qualquer função criada no futuro, sem precisar lembrar de colocar
trava nelas.

**Efeito colateral conhecido:** o claim muda no próximo token (até 1 h). Trocar o perfil de alguém
para/de "Agência" vale depois de sair e entrar de novo.

### 3.3 Plano B (se o Rafael não quiser mexer no gancho do Auth)

`eh_agencia()` + `ALTER POLICY` nas 7 tabelas + trava `if eh_agencia() then raise exception` no começo de
cada RPC que devolve lead, cliente ou produção. Funciona, mas é uma lista longa de `create or replace`
em produção e toda RPC nova precisa lembrar da trava. Fica registrado só como alternativa.

### 3.4 Outros ajustes de perfil (valem nos dois caminhos)

- `profiles_role_check` passa a aceitar `'agencia'` (troca da constraint em `begin/commit`, comando
  pequeno, por causa do problema do conector com DROP; ver memória do conector).
- `profiles_update` e `profiles_delete`: o admin passa a poder editar/remover perfis `'agencia'`
  (`ALTER POLICY`, sem DROP). Supervisor não mexe em Agência.
- Criação de usuário: o seletor de perfil ganha "Agência" **só para admin**; `podeGerenciar` aceita
  `'agencia'` para admin; o caminho que cria o usuário (localizar no plano) aceita o perfil.
- Operação: a agência não tem `operacao` relevante; fica `'apex'`.
- **Edge Functions com `verify_jwt`** (quick-api, reset-password, send-email-lote, caderno-ia,
  diag-gemini-tmp, mailing-api, verificar-cnpj) não passam pelo papel do banco quando usam a chave de
  serviço. Cada uma é conferida; a que usa a chave de serviço sem lista de perfis permitidos passa a
  recusar o token com `role = 'agencia'` (403).
- Ordem segura: ligar o gancho **antes** de existir qualquer login de agência (para todo o resto ele
  não muda nada, então dá para conferir que admin, supervisor e consultor continuam entrando), e só
  depois criar o login da agência.

### 3.6 Achados fora do escopo (avisar o Rafael, tratar à parte)

- `profiles_update` aceita `auth.uid() = id` no `with check` sem travar o `role`: hoje um consultor
  consegue, pela API, mudar o próprio perfil para admin.
- 12 funções `security definer` executáveis pelo `anon` (sem login). A migration desta fase mantém
  o comportamento do `anon` de propósito; revisar em outra tarefa.

### 3.5 Teste de segurança (obrigatório antes de ativar o gancho)

`supabase/tests/agencia_acesso_check.sql`, rodado em transação com `rollback`:
`set local role agencia; set local request.jwt.claims = '{"sub":"<uuid de teste>","role":"agencia"}'`, e confere:

- **falha** `select` em `clientes`, `leads`, `producao_pedidos_neo`, `producao_pedidos_manual`, `config`;
- **falha** `leads_ficha`, `leads_kanban3`, `leads_pegar`, `producao_meus_pedidos`, `reconciliacao_neocrm`;
- **falha** `select` em `profiles` (a agência lê o perfil só pela `meu_perfil()`);
- **funciona** `conversao_resumo()` e `meu_perfil()`.

E o gancho é testado chamando `apex_token_hook` com eventos de exemplo de cada perfil (admin,
supervisor, consultor, agência, usuário sem perfil): só a agência muda de `role`.

## 4. Dados: `conversao_resumo()`

```
conversao_resumo() returns table(
  aba text,             -- AGOSTO, SETEMBRO, …, REPIQUE
  ordem timestamptz,    -- min(criado_em_lead) da aba, para ordenar os cartões
  consultor text,       -- nome no lead; vazio/nulo → null (= "Ainda sem consultor")
  leads int,
  convertidos int,      -- converteu = true
  receita numeric,      -- soma de receita onde converteu = true
  conv_sem_receita int  -- convertidos com receita nula ou 0
)
```

- `security definer`, `set search_path = public`, `stable`. Ignora `apagado_em is not null`.
- Quem pode: admin; supervisor/consultor da operação Apex; agência. Outros → exceção.
- `revoke all … from public, anon`; `grant execute … to authenticated, agencia`.
- Nome do consultor: `nullif(trim(consultor), '')`; se nulo e `dono_id` existe, usa `profiles.nome` do dono.
- Só números agregados: nenhum nome de cliente, telefone, e-mail, CNPJ ou id de lead sai daqui.
- Tamanho: poucas dezenas de linhas (meses × consultores); sem paginação.

## 5. Tela: Meus leads → Conversão (Fase 1)

Sub-abas de Meus leads ao final das 3 fases: **Hoje · Quadro · Lista · Equipe · Monitoramento · Conversão**
(cada perfil vê só as suas; agência vê só Conversão e não vê a barra de sub-abas).

**Cartões dos meses** (topo, rolam para o lado quando não cabem; mais recente à direita):
nome do mês, receita, "N de M leads · T%", barrinha proporcional ao mês de maior receita. O mês atual
(pelo calendário de SP) leva a etiqueta "em andamento". O **Repique** vem num cartão separado no fim,
etiqueta "recontato". Clicar num cartão escolhe o mês. Abre no mês atual.

**Quatro números do mês escolhido:** Leads recebidos · Convertidos · Taxa de conversão
(convertidos ÷ leads) · Receita (com "ticket médio R$ X" = receita ÷ convertidos). Em **mês fechado**,
cada um compara com o mês anterior (%, e a taxa em pontos percentuais); verde quando melhora,
vermelho quando piora. No **mês em andamento** e no Repique não há comparação; aparece
"em andamento: dia D de N".

**Ranking "Consultores em <mês>":** ordem por receita, empate por convertidos. Colunas: posição,
consultor, leads, convertidos, taxa, receita (com barra proporcional ao primeiro). Cor da taxa
contra a média do mês: verde ≥ média; vermelho < 80% da média; neutro entre os dois; com menos
de 10 leads fica sempre neutro com a etiqueta "poucos leads". Linha "Ainda sem consultor" no fim
(sem posição). Rodapé com o total do mês.

**Aviso de gestor** (admin e supervisor; agência e consultor não veem): "N convertidos de <mês>
estão sem receita · ver na Lista", que abre Meus leads → Lista na visão Convertidos com o filtro
Mês daquele mês (os sem receita aparecem com receita vazia; não há visão nova).

**Estados:** carregando (esqueleto); erro ("Não foi possível carregar a conversão. Tentar de novo");
mês sem leads ("Nenhum lead neste mês ainda"). Canto: "Atualizado às HH:MM". Carrega ao abrir a
sub-aba e ao trocar de mês, reaproveitando a resposta (uma chamada traz todos os meses).

**Visual:** tokens e componentes do redesign (§126): cantos 8 px, botões planos, controle
segmentado, tabela limpa; cores só por variável; o único verde é `--st-ganho` (regra do CLAUDE.md;
a §126 já segue isso). O pedido explícito do Rafael é usar a linguagem da §126, não o `.card`/`table.tbl` da Digital. Em tela estreita: cartões rolam, números em 2×2, tabela esconde a barra de receita.

**Login da agência:** depois do login, o painel mostra só o botão Meus leads no menu e abre direto
em Conversão; nenhum outro carregador (produção, boletim, kanban, alertas, notificações de lead novo)
é chamado para esse perfil.

**Fora (YAGNI):** detalhe por consultor, gráfico, filtro por campanha/anúncio, exportar Excel.

## 6. Fase 2: Monitoramento em Meus leads

- Sub-aba **Monitoramento** (admin e supervisor, operação Apex: `canSeeMonitoramentoLeads`).
- Os 10 blocos vão inteiros e na mesma ordem: cartões por consultor, enviar relatório de ligações
  manuais, leads sem nenhuma ligação, necessita repasse, cadência de tentativas, placar do dia,
  qualidade das ligações, inconsistências, ligações por consultor, Equipe de leads e metas.
- **Lógica intocada**: mesmas funções JS (`mlCarregar`, `mlEstado`…) e mesmas RPCs (`monitor_*`).
  Só muda o lugar no HTML e as classes visuais (as `.mlCard`/`.mlTabelaWrap` antigas dão lugar às do
  redesign; os prefixos de função `ml*` ficam, apesar de "ml" ali significar Monitoramento Leads).
- Textos com "planilha" corrigidos (ex.: "Nome na planilha de leads" → "Nome no lead").
- Placar do dia e Ligações por consultor repetem em parte a Equipe: **ficam** nesta fase; o Rafael
  decide depois de uso lado a lado.
- Todo atalho que hoje leva à Digital (`data-tab="conversao"`, `digitalSubAtivar`, links do Boletim,
  notificações) passa a abrir Meus leads na sub-aba certa.
- Critério de aceite: com os mesmos filtros, os números de cada bloco iguais antes e depois.

## 7. Fase 3: sai a Digital

- Sai do painel: o botão `tabBtnConversao`, `#panel-conversao` inteiro, a conversão antiga
  (`loadConversaoVendas`, `conversaoLeadsCache`, filtros de período, funil, falha comercial, Meus leads e
  retornos, reconciliação NeoCRM, "Atualizar agora"), "Meus leads para tratar" (`plCarregar`…), CSS e
  testes que só serviam a elas.
- **No banco nada é apagado** nesta fase (tabelas e funções antigas, como `leads_followups`,
  `meus_leads_para_tratar`, `reconciliacao_neocrm`, e a Edge Function `sync-leads` ficam paradas).
  Limpeza vira tarefa separada.
- Conferir antes: nenhuma outra aba chama funções que saem (busca por nome no HTML todo).

## 8. Testes

- `test_conversao_leads.js` (jsdom, padrão dos testes do repo): funções puras (ordem dos cartões,
  mês atual/em andamento, comparação mês a mês, cor da taxa com piso de 10 leads, ticket médio,
  linha "Ainda sem consultor") e render da sub-aba com dados falsos; agência vê só Conversão.
- `supabase/tests/conversao_resumo_check.sql`: totais por aba batem com `count/sum` direto em `leads`.
- `supabase/tests/agencia_acesso_check.sql` (seção 3.5).
- Fase 2: teste de que os 10 blocos existem dentro de Meus leads e a Digital não tem mais o Monitoramento.
- Fase 3: teste de que `#panel-conversao` e `tabBtnConversao` não existem e nenhum atalho aponta para eles.
- Sempre: contagem `<div>`/`</div>` e abrir outra aba depois da mudança.

## 9. Publicação e volta atrás

Cada fase: worktree de `oficial/main` com `fetch`; testes; prévia com dados reais para o Rafael;
comparar com o ar; backup + MD5 do ar no mesmo comando do envio; vigia aceito; §138.x no REGRAS; push.
Banco e publicação só com ok do Rafael.

- **Fase 1:** migrations (perfil, papel `agencia`, gancho, `conversao_resumo`, policies de profiles) →
  teste de segurança → painel no ar → Rafael **liga o gancho** (confere que todos ainda entram) → cria o login da agência → teste
  entrando como agência. Volta atrás: desligar o gancho + HTML do backup (o papel e a função podem
  ficar, sem efeito).
- **Fase 2:** só HTML. Volta atrás: backup.
- **Fase 3:** só HTML. Volta atrás: backup (nada foi apagado no banco).

## 10. Dados no repositório público

Esta spec, os testes e o REGRAS não levam nomes de cliente, telefones, CNPJs, valores por consultor
nem o UUID do usuário da agência. Os testes SQL usam UUID de exemplo.
