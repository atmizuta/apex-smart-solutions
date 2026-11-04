# Leads direto da Meta no painel: Edge Function `leads-meta` (design)

- **Data:** 04/11/2026
- **Pedido do Rafael:** tirar a planilha da **entrada** dos leads. O lead do formulário da Meta cai direto no painel, sem depender da guia do mês.
- **Seção do REGRAS:** §137 (a próxima livre em 04/11; §134, §135 e §136 já foram usadas).
- **Status:** design aprovado no brainstorming de 04/11 (abordagem A: busca a cada 1 min), aguardando a revisão desta spec.
- **Fora desta spec:** desligar o espelho da planilha (supervisão e diretoria) e o botão "Baixar leads (Excel)". Isso vira outra spec depois que esta estiver de pé.

## 1. Contexto (como funciona hoje)

- O formulário ativo é o **"Formulário LEADS CLARO B2B APEX 20/08 OK"** (ids `f:…4201`), com anúncios em `fb`, `ig` e `an`.
- Uma integração da Meta com o Google Sheets grava cada lead novo na planilha "Leads Google", quase em tempo real. Leitura de 04/11 com a conta de serviço:
  - a guia de entrada `FORM- LEADS CLARO B2B APEX - AGOSTO` (gid 0) está **parada desde 26/10 07:12**;
  - os leads novos caem **direto na guia do mês** (`LEADS CLARO B2B APEX - NOVEMBRO`: 141 leads até 04/11 19:06);
  - o formato é o da exportação da própria Meta: ids com prefixo (`l:` lead, `ag:` anúncio, `as:` conjunto, `c:` campanha, `f:` formulário), `lead_status = CREATED`, `platform` em `fb`/`ig`/`an` (vazio no orgânico), `created_time` no fuso da conta de anúncios (`-05:00`), telefone com `p:+55…`. Por isso a integração é **provavelmente a nativa da Meta**, e não Zapier ou Make. Confirmar em Meta Business Suite → Central de leads → Integrações.
- A Edge Function `planilha-espelho` roda a cada 10 s (job 24, §112). Ela lê a guia de entrada e as guias do mês (atual e anterior) e manda ao banco, pela RPC `leads_entrada`, os ids que o banco ainda não tem. Depois esvazia a fila `leads_espelho` escrevendo as classificações na guia do mês.
- A RPC `leads_entrada(p_leads jsonb)` (`20261026120100_leads_kanban_rpcs.sql`) insere em `public.leads` com chave `(aba, id)`, `aba = leads_mes_aba(created_time)`, e **sempre** chama `leads_espelho_enfileirar(aba, id)` para o lead novo.
- **Problemas conhecidos:**
  - a entrada depende de a guia do mês existir com "CLARO B2B" e o mês por extenso no título. Em 03/11, uma guia "NOV" deixou 71 leads presos na fila, e o lead novo do formulário não entrava (resolvido renomeando a guia);
  - a integração Meta→Sheets não é nossa: se alguém a mudar ou ela cair, o lead some em silêncio.

## 2. Objetivo e critérios de sucesso

1. Todo lead do formulário entra no painel **em até ~1 min**, exista ou não a guia do mês.
2. **Nenhum lead se perde:** uma rodada que falha é recuperada pela seguinte.
3. **Nenhuma duplicata**, nem no banco nem na planilha, inclusive no período em que os dois caminhos rodam juntos.
4. A troca é feita por `config`, sem publicar o painel, e dá para voltar atrás no mesmo minuto.
5. O gestor fica sabendo no painel quando a busca na Meta para.

## 3. Desenho

### 3.1 Edge Function `leads-meta`

Mesmo molde da `planilha-espelho`: deps injetadas, `fetch` falso nos testes e `x-cron-secret` na porta.

| Arquivo | O que faz |
|---|---|
| `index.ts` | porta (cron secret), lê `config`, monta as deps reais (Supabase e Graph API), grava o status |
| `rodada.ts` | uma rodada: busca → converte → grava (ou só conta no ensaio) → avança o cursor |
| `meta.ts` | chamadas à Graph API: leads do formulário com paginação, nome do formulário, formulários da Página |
| `converter.ts` | lead da Graph API → objeto no formato da planilha (o mesmo que a `leads_entrada` já recebe) |
| `*.test.ts` | um arquivo de teste por módulo |

A versão da Graph API fica numa constante única (`GRAPH_VERSAO`), a atual no dia da implementação.

### 3.2 Rodada (a cada 1 min, 24 h)

1. Lê `config.leads_meta`: `{ "modo": "...", "page_id": "...", "form_ids": ["..."], "cursor": "2026-11-04T22:06:57Z" }`. Com `modo = desligado`, sai cedo.
2. Para cada `form_id`:
   - `GET /{form_id}/leads?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data&filtering=[{"field":"time_created","operator":"GREATER_THAN","value":<cursor − 15 min, unix>}]&limit=100`, seguindo `paging.next` até o fim;
   - `GET /{form_id}?fields=name` uma vez por rodada (para `form_name`).
3. Converte cada lead (3.3).
4. Conforme o modo (3.4), grava pela `leads_entrada` ou só registra o ensaio.
5. **Só se tudo deu certo**, avança `cursor` para o maior `created_time` visto e grava `leads_meta_status.ultima_ok`. Com erro, o cursor fica onde está e o erro vai para `leads_meta_status.ultimo_erro`.
6. Uma vez por hora (`leads_meta_status.forms_checado_em`): `GET /{page_id}/leadgen_forms?fields=id,name,status`. Se houver formulário `ACTIVE` fora de `form_ids`, grava o aviso (seção 5).

A volta de 15 min sobre o cursor, junto com o dedupe por id da `leads_entrada`, deixa a rodada idempotente: repetir lead não tem efeito, e perder uma rodada não perde lead.

### 3.3 Conversão (Graph API → formato da planilha)

| Campo da `leads_entrada` | Origem na Graph API | Regra |
|---|---|---|
| `id` | `id` | `"l:" + id` |
| `criado_em_lead` | `created_time` (`+0000`) | ISO como veio; é o mesmo instante da planilha (`-05:00`), então `leads_mes_aba` dá a mesma `aba` |
| `ad_id`, `adset_id`, `campaign_id` | idem | prefixos `ag:`, `as:`, `c:`; vazio fica `null` (lead orgânico) |
| `form_id` | `form_id` | `"f:" + form_id` |
| `ad_name`, `adset_name`, `campaign_name` | idem | como vieram |
| `form_name` | `/{form_id}?fields=name` | como veio |
| `is_organic` | `is_organic` | booleano |
| `platform` | `platform` | como veio (`fb`/`ig`/`an`; vazio no orgânico) |
| `tipo_empresa`, `qtd_linhas`, `cnpj` | `field_data` `qual_o_tipo_da_sua_empresa?`, `qual_a_quantidade_de_linhas?`, `qual_o_seu_cnpj?` | primeiro valor de `values` |
| `email`, `full_name`, `city`, `state` | `field_data` com os mesmos nomes | primeiro valor de `values` |
| `phone_number` | `field_data.phone_number` | `"p:" + valor` (como a planilha grava; o painel já tira o `p:`) |
| `lead_status` | não vem na Graph API | `"CREATED"` |

O nome exato das perguntas no `field_data` só se confirma com o primeiro lead real do ensaio (etapa 0). A tabela de nomes fica num objeto só em `converter.ts`, como o `CAMPOS_FORM` da `planilha-espelho`. Pergunta desconhecida é ignorada e contada em `leads_meta_status.campos_desconhecidos`, para aparecer na conferência.

### 3.4 Modos (`config.leads_meta.modo`)

| Modo | O que a rodada faz |
|---|---|
| `desligado` | sai cedo (estado inicial no deploy) |
| `ensaio` | busca e converte, **não grava** em `leads`. Guarda em `leads_meta_status.ensaio` os últimos 50 `{ id, aba, ja_existia }`, sem nome, telefone, e-mail nem CNPJ |
| `paralelo` | grava pela `leads_entrada2` com `p_espelho = false` e `p_origem = 'meta'`. A planilha continua recebendo a linha pela integração da Meta, e o espelho só a atualiza quando o consultor classificar |
| `principal` | grava com `p_espelho = true` e `p_origem = 'meta'`. Vale depois que a integração nativa Meta→Sheets for desligada: o espelho passa a acrescentar o lead novo na guia do mês |

### 3.5 Banco (uma migration, com rollback)

1. **`leads_entrada2(p_leads jsonb, p_espelho boolean, p_origem text)`** (nova; a lógica da `leads_entrada` mudou para cá)
   - lead novo: insere como hoje, mais `origem_entrada = p_origem` e `meta_visto_em = now()` quando `p_origem = 'meta'`; só chama `leads_espelho_enfileirar` se `p_espelho`;
   - lead que já existe e `p_origem = 'meta'`: `update leads set meta_visto_em = now() where id = … and meta_visto_em is null` (marca que a Meta também o viu);
   - `p_origem` fora de `planilha`/`meta` é recusado.
   - **`leads_entrada(p_leads jsonb)`** continua existindo e passa a chamar `leads_entrada2(p_leads, true, 'planilha')`: a `planilha-espelho` não muda.
   - Sem `DROP` (o conector do Supabase recusa comando com `DROP`); `revoke` de `public, anon, authenticated` nas duas, como hoje.
   - **`leads_meta_cursor(p_cursor timestamptz)`**: grava só o `cursor` dentro de `config.leads_meta` (`jsonb_set`) e nunca para trás, para não desfazer uma troca de `modo` feita no meio de uma rodada. Só service role.
2. **`leads.origem_entrada text`** (`'planilha'` | `'meta'`, `null` nos leads antigos) e **`leads.meta_visto_em timestamptz`**.
3. **`config`**:
   - `leads_meta` = `{ "modo": "desligado", "page_id": "", "form_ids": [], "cursor": null }`;
   - `leads_meta_status` = `{}` (preenchido pela função: `ultima_ok`, `ultimo_erro`, `erro_em`, `inseridos`, `vistos`, `invalidos`, `campos_desconhecidos`, `forms_fora`, `forms_checado_em`, `ensaio`).
4. **`leads_meta_aviso() returns text`** (security definer; `execute` só para `authenticated`, com `revoke` de `public, anon`; o texto não tem dado pessoal, e o painel só chama para gestor, com `kbGestor()`, igual ao aviso do espelho): monta o aviso a partir de `leads_meta` e `leads_meta_status` (seção 5). Vazio quando está tudo bem.
5. **`leads_kanban_versao`** (definição mais recente em `20261027190000_leads_apagar_versao_dono.sql`): passa a incluir `leads_meta_aviso()` na conta, ao lado do `leads_espelho_aviso`, para o aviso aparecer sem recarregar.
6. **Cron** `leads-meta` a cada 1 min (`* * * * *`), no padrão do `sync-leads-auto`: `net.http_post` com `x-cron-secret` vindo do Vault (`sync_producao_cron_secret`, o mesmo valor que a função lê em `SYNC_CRON_SECRET`, como a `planilha-espelho` e a `sync-leads`), `timeout_milliseconds := 50000`.

### 3.6 Painel

Uma mudança só, em `_template.html` (por volta da linha 4381, onde o gestor lê `leads_espelho_aviso`): o painel chama também `leads_meta_aviso()` e mostra os dois avisos no mesmo lugar e com o mesmo visual. Nada muda para o consultor.

### 3.7 Segredo

- `META_PAGE_TOKEN`: só como secret da Edge Function, nunca no repositório, em log nem em `config`.
- O ideal é o token de um **usuário do sistema** do Business Manager dono da Página, com `leads_retrieval` e `pages_show_list` (e `pages_read_engagement`, para listar os formulários), porque não expira. Um token de Página de usuário comum vence e é mais frágil.
- O app precisa estar autorizado no **Leads Access Manager** da Página.

## 4. Etapas da virada (cada uma com ok do Rafael)

| Etapa | Duração | O que fazer | Passa para a próxima quando |
|---|---|---|---|
| **Deploy** | — | migration, função e cron com `modo = desligado` | checagem SQL ok; rodada sai cedo sem erro |
| **0. Ensaio** | 1–2 dias úteis | token no secret, `page_id` e `form_ids` no `config`, `modo = ensaio` | os nomes do `field_data` batem; todo lead que a planilha recebeu no período está no ensaio; um lead conferido à mão (CNPJ, telefone, aba iguais aos da planilha) |
| **1. Paralelo** | ~5 dias úteis | `modo = paralelo` | a checagem diária (seção 6) mostra **zero** lead só-planilha (sem `meta_visto_em`) e zero só-Meta que a planilha nunca recebeu |
| **2. Troca** | um momento combinado | desligar a integração nativa Meta→Sheets e, no mesmo minuto, `modo = principal` | o lead seguinte aparece no painel e, pelo espelho, na guia do mês, sem linha duplicada |

Depois da troca, a `planilha-espelho` continua lendo a guia de entrada e as guias do mês, mas não acha nada novo (o banco já tem tudo). Tirar essa leitura fica para a spec do espelho.

## 5. Erros e aviso no painel

| Situação | O que acontece |
|---|---|
| Graph API devolve erro (token vencido ou retirado, permissão, formulário apagado, limite de chamadas) | `ultimo_erro` e `erro_em` gravados; cursor parado; a próxima rodada tenta de novo |
| Lead sem id ou com `created_time` inválido | pula, soma em `invalidos`, segue com os outros |
| Pergunta nova no formulário | ignorada, listada em `campos_desconhecidos` |
| Formulário ativo fora de `form_ids` | listado em `forms_fora` |
| Rodada demora mais que o timeout | igual a erro: o cursor não anda, e a próxima rodada cobre |

**`leads_meta_aviso()`** devolve texto quando:
- `modo = paralelo` e `ultima_ok` tem mais de **30 min** (a planilha ainda cobre);
- `modo = principal` e `ultima_ok` tem mais de **5 min** (a Meta é a única porta);
- `forms_fora` não está vazio ("Formulário novo na Meta fora da busca: <nome>");
- `campos_desconhecidos` não está vazio no `ensaio` ou no `paralelo`.

O aviso some sozinho na primeira rodada ok (ou quando o `config` for corrigido).

## 6. Testes e conferência

- **Unidade (Deno, padrão da `planilha-espelho`):**
  - `converter.test.ts`: prefixos; `p:` no telefone; perguntas para `cnpj`, `tipo_empresa` e `qtd_linhas`; orgânico sem `platform` e sem anúncio; hora UTC → mesma `aba` que `-05:00`; pergunta desconhecida contada.
  - `meta.test.ts`: URL e filtro montados certo; paginação até o fim; erro HTTP e erro no corpo viram exceção.
  - `rodada.test.ts`: os quatro modos; cursor não anda com erro; cursor volta 15 min; o ensaio não grava e não guarda dado pessoal; checagem de formulários só uma vez por hora.
- **SQL** (`supabase/tests/leads_meta_check.sql`, em `begin … rollback`): `p_espelho = false` não enfileira; a chamada antiga (só `p_leads`) enfileira como antes; `origem_entrada` e `meta_visto_em` gravados; lead existente com `p_origem = 'meta'` só ganha `meta_visto_em`; `leads_meta_aviso()` nos limites de 5 e 30 min.
- **Checagem diária no paralelo** (`supabase/tests/leads_meta_paralelo.sql`, só leitura): por dia, quantos leads entraram por `meta` e por `planilha`, e a lista de ids sem `meta_visto_em` criados depois do início do paralelo.

## 7. Volta atrás

- **No ensaio ou no paralelo:** `modo = desligado`. A planilha segue sozinha, como hoje.
- **Depois da troca:** religar a integração nativa Meta→Sheets e `modo = paralelo`.
- **Migration:** rollback em `supabase/rollback/` recria `leads_entrada(jsonb)` como era, tira as duas colunas, a função `leads_meta_aviso`, as chaves de `config` e o cron, e devolve a `leads_kanban_versao` anterior.

## 8. O que depende da agência

Só o acesso. Todo o resto (código, testes, migration e deploy em `desligado`) pode ser feito antes.

1. Quem é o Business Manager dono da Página.
2. Token de usuário do sistema com `leads_retrieval`, `pages_show_list` e `pages_read_engagement` na Página, ou acesso de admin para o Rafael gerar.
3. App autorizado no Leads Access Manager.
4. Na troca (etapa 2): quem desliga a integração nativa Meta→Sheets.

## 9. Pontos a confirmar na implementação

- O nome exato das perguntas no `field_data`. É provável que seja igual ao cabeçalho da planilha, mas só se confirma no ensaio.
- Se a Graph API devolve `phone_number` já com `+55`. A planilha mostra `p:+55…`.
- O limite de chamadas da Graph API para o token escolhido. Com ~30 leads/dia e 1 chamada por minuto por formulário, a expectativa é ficar muito abaixo dele.
