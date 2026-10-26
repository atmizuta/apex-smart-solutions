# Meus leads: Kanban no painel com espelho na planilha (design)

- **Data:** 26/10/2026
- **Pedido do Rafael:** os consultores param de acessar a planilha "Leads Google". No painel entra uma aba onde eles pegam e classificam os leads com as mesmas tabulações. A planilha é atualizada sozinha.
- **Seção do REGRAS:** §112 (reservada).
- **Status:** design aprovado no brainstorming de 26/10, aguardando a revisão desta spec.

## 1. Contexto (como funciona hoje)

- O formulário do Facebook grava **todo lead novo** na guia de entrada **"FORM- LEADS CLARO B2B APEX - AGOSTO"** (gid 0). O nome engana: ela não é uma guia de mês.
- Alguém do time **copia à mão** cada lead para a guia do mês ("LEADS CLARO B2B APEX - OUTUBRO"). É nessa guia que os consultores trabalham:
  - digitam o nome na coluna CONSULTOR/VENDEDOR para pegar o lead;
  - preenchem STATUS (18 opções), OBS, CONVERTEU? e RECEITA.
- A Edge Function `sync-leads` lê as guias em CSV pelo gid a cada 10 min, numa via só (planilha → banco), e grava em `public.leads` com a chave `(aba, id)`.
- O painel só **lê**: Digital, "Meus leads para tratar", Atender agora, Mesa do Supervisor, Boletim, Biometria e Lead × Mailing.
- **Problemas conhecidos:**
  - O time recria e apaga guias, o gid muda e a sync quebra calada. Aconteceu em 14/09, 01/10 e 26/10 (§60, §111).
  - A cópia da guia de entrada para a guia do mês é manual. Lead da madrugada só aparece quando alguém copia.
  - Dois consultores podem digitar o nome no mesmo lead.
  - A planilha está como "qualquer pessoa com o link pode ver" e o ID dela está no repositório público. Nome, telefone e CNPJ dos leads ficam legíveis por qualquer pessoa.

## 2. Objetivo e critérios de sucesso

1. Na equipe de leads, o consultor pega, classifica e acompanha os leads **só pelo painel**, numa aba única **"Meus leads"** em Kanban.
2. A planilha continua sendo uma ferramenta **permanente da supervisão e da diretoria, só de leitura**, e é atualizada sozinha. A edição manual na planilha não é fonte de verdade: o painel a sobrescreve quando mexe naquele lead.
3. O lead novo aparece no painel em até ~10 min depois de entrar no formulário, **sem cópia manual**. O painel escreve a linha na guia do mês.
4. Dois consultores **nunca** ficam com o mesmo lead.
5. Guia recriada ou renomeada não derruba mais a integração: a guia é achada pelo **nome do mês** e a linha pelo **id do lead**.
6. O link público da planilha pode ser fechado.

## 3. Decisões do Rafael (brainstorming de 26/10)

| Tema | Decisão |
|---|---|
| Papel da planilha | Espelho permanente, só leitura, para supervisão e diretoria |
| Quem distribui | O próprio consultor **pega** o lead no painel |
| Quem pode pegar | Só quem está em `leads_equipe` |
| Limite de leads por consultor | **Nenhum** |
| Redistribuição | Admin e supervisor podem passar o lead a outro consultor ou devolvê-lo aos Livres |
| Cópia entrada → guia do mês | O **painel assume**; acaba a cópia manual |
| Guia do mês novo | **O time continua criando** na planilha. O painel nunca cria guia |
| Campos que o consultor preenche | STATUS, OBS, CONVERTEU? e RECEITA. O NEO sugere a venda pelo CNPJ e o painel avisa quando há divergência |
| Formato | **Kanban** numa aba só, com os Livres como primeira coluna |
| "Meus leads para tratar" | **Substituída e absorvida** pelo Kanban |
| Integração com o Google | Fila no banco + Edge Function com **conta de serviço** do Google (abordagem A) |
| Dados nos Livres | Telefone, e-mail e CNPJ **escondidos até pegar** |

## 4. Arquitetura

```
Facebook ─▶ guia de ENTRADA (FORM-…) ──(sync-leads, 10 min, modo painel: só INSERE lead novo)──▶ public.leads
                                                                                                    │
  consultor ──[Pegar]──────▶ RPC leads_pegar()          (atômico; só leads_equipe)                  │
  consultor ──[Classificar]▶ RPC leads_classificar()    (dono ou admin/supervisor)                  ├─▶ leads_historico
  supervisor ─[Redistribuir]▶ RPC leads_redistribuir()  (admin/supervisor)                          │
                                                                                                    ▼
                                                                    fila public.leads_espelho (1 item por lead)
                                                                                                    │ pg_cron, 1 min
                                                                                                    ▼
                                         Edge Function planilha-espelho (conta de serviço, Google Sheets API v4)
                                         1. lista as guias (spreadsheets.get) e acha a do mês do lead pelo NOME
                                         2. acha a linha pelo id (coluna "id") ou cria a linha no fim da guia
                                         3. escreve CONSULTOR|VENDEDOR, STATUS, OBS, CONVERTEU?, RECEITA pelo nome do cabeçalho
```

**Princípios**
- **O banco é a fonte da verdade** dos campos de trabalho: dono/consultor, status, OBS, converteu, receita e retorno.
- **O lead é identificado pelo id do Facebook.** A coluna `aba` passa a ser sempre o **mês de criação em horário de SP** ("OUTUBRO"), e não a guia de onde ele foi lido. A guia de entrada nunca vira `aba`.
- **O item da fila é idempotente:** "deixe a linha deste lead igual ao banco agora". Repetir não estraga nada, e vários cliques no mesmo lead viram uma escrita só.

## 5. Componentes

### 5.1 Banco: `public.leads` (colunas novas)

| Coluna | Tipo | Uso |
|---|---|---|
| `dono_id` | uuid → profiles | Consultor dono no painel (nulo = Livre) |
| `pego_em` | timestamptz | Quando foi pego |
| `classificado_em` / `classificado_por` | timestamptz / uuid | Última classificação |
| `retorno_em` | date | Data de retorno (status AGENDADO RETORNO) |
| `aba_planilha` | text | Nome da guia onde a linha foi escrita (preenchido pelo espelho) |

- A coluna `consultor` (texto, nome da planilha) **continua** e passa a ser preenchida pelas RPCs com `leads_equipe.nome_planilha` do dono. Com isso, os relatórios que já usam `consultor` não mudam.
- As colunas `categoria` e `converteu` continuam com o mesmo significado de hoje.
- Índice novo: `(dono_id)` e `(aba) where dono_id is null`, para listar os Livres.

### 5.2 Banco: tabelas novas

- **`leads_status_opcoes`**: `status` (texto exato da planilha), `grupo` (andamento | convertido | perdido), `ordem`, `ativo`.
  - Começa com as 18 tabulações de hoje (`edge_function_sync_leads.ts`, listas STATUS_*), com a grafia exata da planilha.
  - O painel monta a lista do Classificar a partir dela, e a categorização passa a ler daqui.
- **`leads_historico`**: `id`, `lead_aba`, `lead_id`, `acao` (pegar | classificar | redistribuir | devolver), `por` (uuid), `em`, `antes` (jsonb), `depois` (jsonb).
- **`leads_espelho`** (fila): `lead_aba`, `lead_id` (únicos juntos), `pedido_em`, `tentativas`, `proxima_em`, `ultimo_erro`, `feito_em`.
  - Um lead tem **no máximo um item pendente**: um clique novo atualiza `pedido_em` em vez de criar outro item.

### 5.3 Banco: funções (security definer, com `search_path` fixo)

- **`leads_pegar(p_aba, p_id)`**
  - Exige que quem chama esteja em `leads_equipe` (pelo `profile_id`).
  - Faz `update … set dono_id = auth.uid(), consultor = nome_planilha, pego_em = now() where dono_id is null`.
  - Se nenhuma linha mudou, devolve "já foi pego por <nome>".
  - Grava o histórico e enfileira o espelho.
- **`leads_classificar(p_aba, p_id, p_status, p_obs, p_converteu, p_receita, p_retorno)`**
  - Exige que quem chama seja o dono do lead, ou admin ou supervisor.
  - O status precisa existir em `leads_status_opcoes` (ativo).
  - Recalcula `categoria` e `converteu` com a mesma regra de hoje: CONVERTEU? = sim, ou status de venda.
  - Grava o histórico e enfileira o espelho.
- **`leads_redistribuir(p_aba, p_id, p_novo_dono)`**
  - Só admin e supervisor. `p_novo_dono` nulo devolve o lead aos Livres (consultor = vazio).
  - Grava o histórico e enfileira o espelho.
- **`leads_kanban(p_dono)`** (leitura)
  - Devolve os Livres e os leads do dono pedido (o próprio usuário; admin e supervisor podem pedir qualquer um ou todos).
  - **Livre** = `dono_id` nulo **e** `categoria = 'sem_contato'` (sem status). Lead antigo com status e sem dono não aparece nos Livres: vai para a lista de vínculo da virada.
  - Coluna do Kanban vem da `categoria`: sem_contato → Meus novos, andamento → Em andamento, convertido → Convertido, perdido → Perdido. Venda no NEO pelo CNPJ também leva o lead para Convertido.
  - Já vem com a venda do NEO pelo CNPJ (a mesma ligação do `monitor_leads_leads`/§88) e o relógio do "Atender agora".
  - **Nos Livres, telefone, e-mail e CNPJ vêm nulos** para consultor. Admin e supervisor veem tudo.
- As permissões de escrita direta em `leads` continuam bloqueadas para quem não é admin: toda mudança passa pelas RPCs.

### 5.4 Edge Function `planilha-espelho` (nova)

- **Autenticação:**
  - chamada pelo pg_cron com `x-cron-secret`, o mesmo padrão da `sync-leads`;
  - conta de serviço do Google no secret **`GOOGLE_SA_JSON`**, nunca no repositório;
  - token OAuth (JWT assinado, escopo `spreadsheets`) gerado a cada rodada.
- **Rodada (a cada 1 min):**
  1. Pega até 100 itens pendentes com `proxima_em <= now()`.
  2. Chama `spreadsheets.get` uma vez para listar as guias e escolhe a do mês do lead. A regra é: o título contém o nome do mês, não começa com "FORM-" e é a guia ativa daquele mês. Se houver mais de uma (por exemplo "SETEMBRO" e "SETEMBRO 26"), vale a que já contém o id do lead; se nenhuma contém, vale a mais recente.
  3. Lê o cabeçalho de cada guia usada (a linha com `created_time` na 2ª coluna, como no `parseSheetCsv`) e acha as colunas pelo nome: CONSULTOR, VENDEDOR, VENDEDORA, CONSULTORA ou a coluna sem nome antes de STATUS (regra do §60/§98); STATUS; OBS; CONVERTEU?; RECEITA.
  4. Lê a coluna `id` da guia e acha a linha de cada lead.
     - Se achar, escreve os 5 campos.
     - Se não achar (lead novo, ou linha apagada pelo time), **acrescenta a linha no fim** com todas as colunas do formulário na ordem do cabeçalho mais os 5 campos.
  5. Tudo vai num único `values.batchUpdate` (mais um `append` para as linhas novas) por guia, por rodada.
  6. Em caso de sucesso, marca `feito_em` e `leads.aba_planilha`. Em caso de falha, `tentativas + 1`, espera crescente (1, 2, 5, 10, 30 min) e grava `ultimo_erro`.
- **Guia do mês ainda não existe** (o time ainda não criou NOVEMBRO): o item fica pendente sem contar tentativa, e `config.leads_espelho_aviso` recebe "Crie a guia de NOVEMBRO na planilha". O painel não cria a guia.
- **Formato dos valores:**
  - CONVERTEU? = "sim" ou vazio;
  - RECEITA no formato brasileiro ("1.234,56");
  - STATUS com o texto exato de `leads_status_opcoes`;
  - escrita com `valueInputOption=RAW`, para o Google não reinterpretar o texto.
- **Botão de admin "Reescrever planilha":** enfileira todos os leads do mês. Serve para corrigir edição manual ou uma guia recriada.

### 5.5 Edge Function `sync-leads` (alterada)

- A leitura das guias passa a usar a **API do Sheets pela conta de serviço**: guias pelo nome, sem gid fixo. Isso permite fechar o link público e encerra o problema dos §60/§111.
- **Chave `config.leads_modo`:**
  - `planilha` = comportamento atual (padrão até a virada);
  - `painel` = modo novo.
- **No modo `painel`:**
  - lê **só a guia de entrada** (título começa com "FORM-");
  - para cada id que não existe em `leads`, **insere** com `aba` = mês de criação (SP), `primeira_sync_em = now()` e sem dono (vai para os Livres);
  - lead que já existe: atualiza só os campos do formulário (nome, telefone, e-mail, CNPJ, cidade…) e **nunca** `dono_id`, `consultor`, `status`, `obs`, `converteu`, `receita` ou `retorno_em`;
  - todo lead inserido entra na fila do espelho, e é assim que a linha chega à guia do mês.
- A trava de mês do §62 não se aplica à guia de entrada no modo painel, porque o mês vem da data do lead.
- `config.leads_sync_erro` continua sendo o lugar do erro da leitura. O espelho usa `config.leads_espelho_aviso`.

### 5.6 Painel: aba "Meus leads" (`_template.html`)

- **Menu:** um `<button data-tab="meusLeads">` no grupo da Digital, no formato dos outros. Aparece para quem está em `leads_equipe` e para admin e supervisor.
- **Kanban com 5 colunas:**

| Coluna | Conteúdo | Ações |
|---|---|---|
| **Livres** | Leads sem dono, os mais novos primeiro, "há X min". Empresa, cidade e linhas; **sem telefone, e-mail ou CNPJ** | **Pegar**. Mostra os 20 mais novos e um "ver mais", com o contador no topo |
| **Meus novos** | Peguei e ainda não classifiquei | Relógio do Atender agora, **Ligar** (`registrar_contato_lead`), **WhatsApp** (mensagens do §64), **Classificar** |
| **Em andamento** | Status do grupo andamento | Retorno **Amanhã / Em 3 dias** (`leads_followups`, como hoje), **Reclassificar** |
| **Convertido** | Status de venda, ou venda no NEO | Receita; selo "✓ NEO" quando bate com o NEO; aviso quando diverge |
| **Perdido** | Status de perda do mês corrente | Recolhida por padrão; "para resgatar" (CLIENTE NÃO RESPONDE, §64) destacado |

- **Card:** empresa (full_name), cidade, linhas, telefone (depois de pegar), status atual e o início da última OBS.
- **Classificar** (modal `.overlay/.modal`):
  - status agrupado (Andamento, Convertido, Perdido) a partir de `leads_status_opcoes`;
  - OBS;
  - "Converteu?" e "Receita", visíveis para status de venda e pré-preenchidos quando o NEO achou venda pelo CNPJ;
  - data de retorno quando o status é AGENDADO RETORNO.
- **Arrastar o card** entre colunas abre o Classificar filtrado no grupo da coluna de destino.
- **Divergência com o NEO:** o consultor marcou "não converteu" e o NEO tem venda pelo CNPJ, ou o contrário. O card mostra um selo de aviso, e a lista aparece para admin e supervisor.
- **Admin e supervisor:**
  - seletor "Consultor: Todos / <nome>";
  - **Redistribuir** em cada card;
  - botão "Reescrever planilha" (só admin);
  - faixa com `leads_espelho_aviso` e com o atraso da fila.
- **Mesa do Supervisor:** um card com o tamanho dos Livres, o lead livre mais antigo e o atraso da planilha.
- **Atualização:** recarga a cada 30 s com a aba visível. Quem tenta pegar um lead que outro já pegou recebe `mostrarAviso("Esse lead já foi pego por <nome>", 'info')` e o card some.
- **Celular:** as colunas rolam para o lado e os Livres ficam fixos à esquerda.
- **Design:** segue o CLAUDE.md, só com classes e variáveis existentes (`.card`, `.badge`, `.btn`, `.filterPill`, `var(--…)`). Nenhuma mudança no estilo-base, no menu ou no cabeçalho.
- **"Meus leads para tratar"** (sub-aba da Digital, §61/§64) é removida no passo 3 da virada. Até lá ela convive, só com leitura.

## 6. Virada

1. **Preparação, sem efeito para ninguém.**
   - O Rafael cria a conta de serviço no Google Cloud com um roteiro passo a passo, entrega o JSON por arquivo local (nunca no chat nem no repositório) e compartilha a planilha com o e-mail da conta como **editora**.
   - Migration aplicada e funções publicadas, com `leads_modo = planilha` e o cron do espelho desligado.
   - **Ensaio a seco:** a `planilha-espelho` com `dry_run` calcula, para os leads de outubro, a guia, a linha e os valores que escreveria, e grava só no log. O Rafael confere.
2. **Virada**, em horário combinado fora do pico:
   1. Uma última rodada da sync no modo `planilha`, para trazer o estado atual (dono pelo nome, status, OBS).
   2. Preencher `dono_id` a partir de `consultor` → `leads_equipe.nome_planilha`. Nome que não casa vai para uma lista que o Rafael vincula.
   3. Limpar as duplicatas da guia de entrada que já estão no banco (os 10 leads de outubro gravados com `aba = AGOSTO`), **com o ok do Rafael**.
   4. `leads_modo = painel`, ligar o cron do espelho e liberar a aba para a equipe de leads.
   5. O dono da planilha tira o acesso de edição dos consultores.
3. **Depois de alguns dias estável:** fechar o link público, remover a "Meus leads para tratar" e registrar no REGRAS §112.

**Voltar atrás:** `leads_modo = planilha` e cron do espelho desligado. A sync volta ao modo antigo, a planilha manda de novo e os consultores voltam para ela. Nada é apagado do banco.

## 7. Erros e casos de borda

| Caso | Comportamento |
|---|---|
| Google fora do ar, ou cota estourada | A fila segura e tenta de novo com espera; o painel funciona normal; o aviso aparece depois de 15 min de atraso |
| Guia do mês não existe | Item pendente sem gastar tentativa; aviso "crie a guia <MÊS>" |
| Time apagou a linha do lead | O espelho recria a linha no fim da guia e registra no log |
| Time editou a planilha à mão | Ignorado; o painel sobrescreve quando mexer no lead ou com "Reescrever planilha" |
| Dois "Pegar" ao mesmo tempo | O update atômico garante que só um ganha; o outro recebe "já foi pego por <nome>" |
| Cabeçalho renomeado (CONSULTOR → VENDEDOR etc.) | Coluna achada pelas mesmas regras do §60/§98. Se não achar a coluna STATUS, aviso e nada é escrito naquela guia |
| Consultor saiu da equipe | Os leads dele ficam com ele até a supervisão redistribuir |
| Lead sem data de criação | Vai para a guia do mês corrente |

## 8. Testes

- **Funções puras** (Node, no padrão de `test_edge_function_sync_leads.js`):
  - escolher a guia pelo mês (inclui "SETEMBRO 26", guia FORM- e duas guias do mesmo mês);
  - achar as colunas pelo cabeçalho (CONSULTOR, VENDEDOR, coluna em branco antes de STATUS);
  - montar a linha nova na ordem do cabeçalho;
  - formatar a RECEITA;
  - juntar vários itens da fila do mesmo lead.
- **Banco** (`supabase/tests/`, rodado em transação com rollback):
  - dois `leads_pegar` no mesmo lead, em que só o primeiro ganha;
  - consultor fora de `leads_equipe` barrado;
  - quem não é dono não classifica;
  - status fora da tabela é recusado;
  - nos Livres, consultor recebe telefone, e-mail e CNPJ nulos e o supervisor recebe os dados;
  - no modo painel, a sync não sobrescreve status ou dono.
- **Painel:** testes jsdom das funções puras do Kanban (montar as colunas, divergência com o NEO, filtro do Classificar por coluna).
- **Ensaio a seco** contra a planilha real antes da virada (passo 1).

## 9. Fora do escopo (para depois)

- Distribuição automática (rodízio) e devolução automática de lead parado.
- Limite de leads por consultor (decisão do Rafael: sem limite).
- Relatórios novos e mudanças na Digital, no Boletim ou no Monitoramento, que continuam lendo `leads` como hoje.
- Painel criando guia do mês (decisão: o time cria).
- Leads da guia "LEADS FIBRA CLARO APEX - SETEMBRO" (Fibra), que hoje não entram no painel.

## 10. Segurança

- O JSON da conta de serviço fica só no secret `GOOGLE_SA_JSON` do Supabase e num arquivo local fora do repositório (em `C:/Users/acer1/apex-segredos/`, como o token do discador).
- A conta de serviço só recebe acesso de editora **a esta planilha**.
- Depois da virada, fechar "qualquer pessoa com o link". O ID da planilha no repositório deixa de expor dados.
- Nos Livres, o consultor não recebe telefone, e-mail nem CNPJ.
