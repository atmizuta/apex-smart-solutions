# CRM Fibra

App separado do painel de clientes existente, para consultores selecionados
trabalharem os segmentos de fibra e renovação. Ver
`docs/superpowers/specs/2026-09-25-crm-leads-fibra-renovacao-design.md` para
o desenho completo.

## Setup

1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`: do projeto Supabase
     "apex" (`mdgfboijyqfkggcrhptn`) — a **service role key**, não a anon key.
   - `CRM_FIBRA_SESSION_SECRET`: uma string aleatória de pelo menos 32
     caracteres.
3. Rode a migração (`db/schema.sql`) contra o projeto Supabase — ver Task 4
   do plano de implementação.
4. Crie o primeiro admin: adicione `SEED_ADMIN_NOME`, `SEED_ADMIN_USERNAME` e
   `SEED_ADMIN_SENHA` ao mesmo `.env.local` (o arquivo que já tem
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) e rode `npm run seed:admin`.

   Nota: se você não tiver a SUPABASE_SERVICE_ROLE_KEY à mão localmente, um admin também pode ser criado por uma inserção SQL direta na tabela `crm_fibra.consultores`, com a senha hasheada via bcrypt (12 rounds) antes de inserir — foi assim que o primeiro admin desta instância foi criado.

5. `npm run dev` e abra `http://localhost:3000/login`

## Testes

`npm test` roda todos os testes automatizados (Vitest).

## Checklist de verificação manual

Depois de rodar as migrações e o seed:

1. Abra `/dashboard` sem estar logado → deve redirecionar para `/login`.
2. Faça login com usuário/senha errados → mensagem de erro genérica, sem
   dizer se o usuário existe ou não.
3. Faça login com as credenciais do admin criado pelo seed → deve entrar em
   `/dashboard` e ver a topbar com seu nome e papel `admin`.
4. Vá em `/consultores`, crie um novo consultor (papel `consultor`).
5. Em outra aba/navegador anônimo, faça login com o novo consultor → deve
   entrar normalmente.
6. Volte pro admin, desative esse consultor em `/consultores`.
7. Na aba onde o consultor estava logado, recarregue qualquer página
   protegida (ex: `/dashboard`) **sem fazer logout manual** → deve
   redirecionar para `/login`, mesmo que o cookie de sessão dele ainda não
   tenha expirado. Isso confirma a checagem viva de `ativo` no banco
   (Task 10), não só a validade do token.
8. Tente acessar `/consultores` logado como um consultor comum (não admin)
   → deve redirecionar para `/dashboard`.
9. Clique em "Sair" → deve voltar para `/login` e qualquer página protegida
   volta a redirecionar.

## Leads & Carteira (Plano 2)

A segmentação (`crm_fibra.leads_segmentados`) lê `public.clientes` ao vivo —
não há cópia de dado. Se a base de clientes parecer errada (poucos
resultados, números estranhos), confirme com o time se `public.clientes`
está na sua versão correta antes de desconfiar do CRM Fibra.

**Migração do Plano 2 aplicada em produção (2026-09-30):** `public.clientes` foi restaurada pra sua versão correta (6.532 linhas, confirmadas contra a análise original) e as tabelas `atribuicoes`/`mensagens` + a view `leads_segmentados` foram aplicadas no mesmo projeto Supabase. `camada_renovacao` usa a regra atual do painel (`tempo_contrato_voz > 15`), não o campo `apto_renovacao` (deprecado desde 11/08/2026 — ver `REGRAS_NEGOCIO.md` do painel).

### Checklist de verificação manual (além do checklist do Plano 1)

1. Logado como consultor, abra `/dashboard` → os 6 cartões devem mostrar
   números plausíveis (não zero, a menos que a base realmente esteja vazia).
2. Clique em qualquer cartão → deve ir para `/leads` já filtrado pela
   camada certa.
3. Em `/leads`, digite um texto de busca com vírgula e parênteses, por
   exemplo `Acme, (Ltda)` → a lista não deve quebrar nem retornar todos os
   resultados sem filtro.
4. Clique em um lead sem dono → deve aparecer o botão "Atribuir a mim".
   Clique nele → deve sumir o botão e aparecer o formulário de mensagem.
5. **Teste a disputa de atribuição:** com dois logins de consultor
   diferentes (duas abas anônimas), abram o mesmo lead sem dono e cliquem
   em "Atribuir a mim" quase ao mesmo tempo nas duas — um deve conseguir,
   o outro deve ver uma mensagem de erro clara (não travar, não duplicar
   o dono).
6. Escreva uma mensagem em branco (só espaços) e tente enviar pelo
   WhatsApp ou registrar ligação → deve aparecer erro, nada deve ser
   salvo.
7. Escreva uma mensagem de verdade e clique "Enviar pelo WhatsApp" → deve
   abrir uma aba nova do WhatsApp com o número e o texto certos, e a
   mensagem deve aparecer no histórico da página ao voltar.
8. Abra um lead cujo cliente não tenha telefone válido na base → deve
   aparecer o aviso de contato manual, não um botão de WhatsApp quebrado.

## Card de lead + propostas (Plano 3)

A página `/leads/[cnpj]` tem três abas (Cliente, Linhas, Proposta). A aba Proposta monta uma
proposta linha a linha a partir do catálogo de planos Claro-empresas
(`crm_fibra.catalogo_planos`, 22 itens iniciais), que o admin edita em `/catalogo`.

**Migração aplicada em produção (2026-10-13):** `db/schema.sql` (idempotente) criou
`catalogo_planos`, `propostas` e `proposta_itens`, semeou o catálogo e acrescentou
`linhas_voz`/`valor_contrato` ao **fim** da view `leads_segmentados`. `db/rollback-lead-card.sql`
desfaz tudo (e apaga as propostas salvas). **Ordem de publicação:** aplicar a migração ANTES de
publicar o código — o código novo lê tabelas que só existem depois dela.

### Checklist de verificação manual (Plano 3)

1. Em `/leads`, clique num lead → a página abre com as abas Cliente, Linhas e Proposta; a aba
   Cliente mostra os mesmos dados e o histórico de mensagens de antes.
2. Aba Linhas → linhas fixas, linhas de voz, valor do contrato e ARPU preenchidos (ou "-" quando a
   base não tem) e os selos de camada.
3. Aba Proposta → escolha "600 Mega (G1 Padrão)" e adicione; depois adicione "Claro Monitor" →
   total R$ 64,90; remova uma linha → o total atualiza.
4. Escolha "Oferta avulsa", digite uma descrição e "149,90" → a linha entra com R$ 149,90; digite
   "abc" no valor → aparece erro e nada entra.
5. Salvar proposta → mensagem "Proposta salva.", o construtor esvazia e a proposta aparece em
   "Propostas salvas" com o selo "Mais recente", o seu nome e a hora de Brasília.
6. Salve uma segunda proposta com outra combinação → as duas ficam listadas, a nova primeiro.
7. Como admin em `/catalogo`: mude o valor de um plano e salve → a proposta antiga continua com o
   valor antigo; desative um plano → ele some do seletor da aba Proposta; reative → ele volta.
8. Como consultor comum, abra `/catalogo` → redireciona para `/dashboard`.
9. Troque de aba no meio de uma proposta ainda não salva → as linhas continuam lá ao voltar.

## Abordagem por IA (Plano 4)

A ficha `/leads/[cnpj]` ganhou a aba **Abordagem**: o consultor clica em *Gerar abordagem* e o
Gemini monta cinco mensagens de WhatsApp (abordagem, sondagem, malefícios, benefícios,
finalização) com os dados do lead e a proposta mais recente. Cada geração fica salva em
`crm_fibra.abordagens`; a aba mostra a mais recente.

**Migração aplicada em produção (2026-10-19):** `db/schema.sql` (idempotente) criou
`crm_fibra.abordagens`. `db/rollback-abordagens.sql` desfaz (e apaga os roteiros salvos).
**Ordem:** aplicar a migração ANTES de publicar o código; para desfazer, republique antes o código
anterior (a ficha lê essa tabela e quebraria sem ela).

**Chave da IA:** variável `GEMINI_API_KEY` no projeto Vercel, só no servidor (`.env.example` traz
só o nome). Modelo: `gemini-3.1-flash-lite`. A cota gratuita é **compartilhada** com o app de
prática (Apex Mind) enquanto os dois usarem a mesma chave; para separar, crie uma chave só do CRM
e troque a variável, sem mexer no código.

**Dados enviados ao Google:** razão social (sem a raiz do CNPJ nem o CPF que MEIs costumam ter
no nome), cidade, cobertura de fibra, linhas fixas e de voz, segmentação (fibra/renovação) e a
proposta (descrição, valor e total). Nunca CNPJ, CPF, telefones, e-mail, ids, valor do contrato
nem ARPU. O prompt proíbe afirmar economia em reais, descrever como parte da proposta o que não
está nos itens e prometer recursos que não estejam nos dados; havendo proposta, ela é final (o
modelo não sugere outros planos). O texto é um rascunho: o consultor lê antes de colar no WhatsApp.

### Checklist de verificação manual (Plano 4)

1. Abra um lead e a aba Abordagem → estado vazio com o botão "Gerar abordagem".
2. Gere num lead sem proposta → 5 cartões de WhatsApp curtos, sem preço de plano, status "sem
   proposta".
3. Monte e salve uma proposta, volte à aba → aviso "Há uma proposta mais nova"; gere de novo →
   status "com a proposta de …" e os benefícios citam os planos e o total.
4. Clique em Copiar num cartão e cole no WhatsApp → o texto vem inteiro.
5. Recarregue a página → o mesmo roteiro continua lá (sem nova chamada à IA).
6. Troque de aba e volte → o roteiro continua na tela.
7. Peça a outro consultor para gerar no mesmo lead → os dois conseguem; a aba mostra o mais
   recente.
