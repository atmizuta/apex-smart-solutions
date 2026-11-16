# Consulta de sócios (CPF e telefones) na ficha da Renovação (§156)

**Data:** 16/11/2026 · **Pedido:** Rafael ("automação para que os consultores consigam consultar o CPF do CNPJ que eles têm";
"quero fazer primeiro o de renovação. depois, quero abrir para todos os consultores, porém de uma maneira diferente")
**Seção do REGRAS:** §156 (o oficial está em §154.1 em 16/11; confirmar com `git fetch oficial` antes de escrever)
**Repositórios:** painel e banco no oficial (`atmizuta/apex-smart-solutions`); robô no `rafaangelao/apex-robo-procontact`
(ambos **públicos**: nenhum CPF, CNPJ, nome, telefone, usuário ou senha em código, teste, log ou commit).

## 1. Por que

O consultor da Renovação precisa do CPF e do telefone dos sócios do cliente (cadastro na Claro, falar com o decisor).
A Eagle tem acesso ao site da Nova Vida TI (Congonhas), que mostra os sócios de um CNPJ com CPF completo e, na página
de cada sócio, os telefones fixos e celulares. O site **não tem API** contratada; hoje a consulta é manual, com um
usuário compartilhado. A automação segue o modelo do robô do ProContact: Playwright no GitHub Actions.

## 2. Decisões do Rafael (brainstorming de 16/11)

| Tema | Decisão |
|---|---|
| Uso | **Na hora**: o consultor clica e o resultado chega em ~1–2 min |
| Volume | ~10 consultas por dia (time todo) |
| Onde | **Primeiro só na Renovação** (ficha do cliente). A abertura para todos os consultores é uma **fase 2, com outro formato**, fora desta spec |
| O que trazer | Nome, CPF e participação de cada sócio **+ telefones** (fixos e celulares, operadora, etiqueta WhatsApp) |
| Teto de sócios com telefone | **5** (os de maior participação); os demais só com nome, CPF e participação |
| Já consultado | **Mostra o guardado** com "consultado em…" e botão **Atualizar** |
| Quem consulta | Quem já vê a ficha (dono do cliente ou admin/supervisor), com **limite de 20 consultas por pessoa por dia** |
| Usuário da Nova Vida | Rafael manda o time **parar de usar** o usuário compartilhado: o robô passa a ser o único usuário |
| Arquitetura | **Opção 1**: RPC no banco grava o pedido e dispara o Actions na hora (sem Edge Function no caminho do painel) |
| Base de Mailing | **Híbrido**: a aba já abre com nome e CPF dos sócios da `mailing.socio` (Receita) quando houver; a Nova Vida complementa com telefones, participação e os clientes que a base não cobre |

**Por que híbrido (medido em 16/11, só contagens):** a `mailing.socio` (5,3 mi de linhas, índice `(cnpj, cpf)`) tem sócio
para **831 dos 1.242** clientes da carteira (67%), 1.017 sócios, todos com CPF de 11 dígitos e um `principal` por empresa;
base da Receita de **2026-09** (`mailing.carga.receita_mes`). Ela não tem telefone nem participação. A `mailing.linha` liga
CPF a telefone, mas **não tem índice por CNPJ** (consultar exigiria DDL em produção): fica fora desta fase.

## 3. Viabilidade (teste descartável de 16/11, branch `teste/login-novavida` do robô)

- O login passou de primeira com o Chromium **headless** do robô no GitHub Actions (sem disfarce): o reCAPTCHA v3 da
  Nova Vida deu nota suficiente. O desafio v2 de reserva **não está configurado** no site (`recaptchaV2SiteKey = ""`):
  se um dia o v3 reprovar, não há segunda chance (ver §9).
- **Entrar pelo Congonhas**, nunca direto pelo login: `https://congonhas.novavidatec.com.br/` redireciona para
  `login.novavidati.com.br/Auth/Login?p=<token>&...` com `ProductId=1`. Ir direto para `/Auth/Login` responde
  "Sessão expirada".
- Campos do login: `#sUsuario`, `#sSenha`, `#sCliente`; botão `#submitEntrar`. O envio é AJAX com resposta JSON
  (`sucesso`, `mensagem`, `requiresCaptchaChallenge`).
- Critério de logado: estar em `congonhas.novavidatec.com.br` com a caixa **"Digite o CPF ou CNPJ"** visível.
- Depois do login o site abre um SignalR (`/loginHub/negotiate`, `/login/setConnectionId`), provável controle de
  **sessão única por usuário**: dois logins simultâneos derrubam um ao outro → o robô roda **um por vez** (§5.1).
- Os endereços das páginas internas têm o documento **cifrado** (`?documento=!...`): o robô sempre passa pela caixa de busca.
- Cada página aberta (empresa, cada sócio) **conta uma consulta** no contador do usuário (plano "Ilimitado").

## 4. Banco

### 4.1 Tabela `socios_consultas` (fila + resultado; uma linha por pedido)

| coluna | tipo | uso |
|---|---|---|
| `id` | bigserial PK | |
| `cnpj_digits` | text not null | 14 dígitos |
| `carteira_id` | bigint null → `renovacao_carteira(id)` on delete set null | de onde veio o pedido |
| `origem` | text not null default `'renovacao'` | porta para a fase 2 |
| `pedido_por` | uuid not null | `auth.uid()` de quem pediu |
| `pedido_em` | timestamptz not null default now() | |
| `status` | text not null default `'pendente'`, check in (`pendente`,`consultando`,`pronto`,`sem_socios`,`erro`) | |
| `iniciado_em` | timestamptz null | quando o robô pegou |
| `concluido_em` | timestamptz null | "consultado em…" |
| `disparado_em` | timestamptz null | último `net.http_post` para o GitHub |
| `resultado` | jsonb null | ver 4.2 |
| `erro` | text null | mensagem **genérica**, sem dado pessoal |

Índices: `(cnpj_digits, pedido_em desc)`; `(pedido_por, pedido_em)`; parcial `(status) where status in ('pendente','consultando')`.

- O que a ficha mostra é o pedido mais recente do CNPJ; o resultado exibido é o do último `pronto`/`sem_socios`.
- Os pedidos antigos ficam como **registro de quem consultou o quê** (LGPD). Limpeza de pedidos antigos fica fora do escopo.

### 4.2 Formato do `resultado`

```json
{ "socios": [
    { "nome": "…", "cpf": "00000000000", "participacao": 50.0,
      "telefones_consultados": true,
      "telefones": [ { "tipo": "celular", "numero": "11900000000", "operadora": "CLARO", "whatsapp": true },
                     { "tipo": "fixo",    "numero": "1130000000",  "operadora": "VIVO",  "whatsapp": false } ] }
] }
```

- Sócios ordenados por participação (maior primeiro); `telefones_consultados = false` a partir do 6º.
- `cpf` e `numero` só com dígitos; `participacao` em número (null se a página não trouxer).

### 4.3 RLS

- `select` para `authenticated` **somente** se existir na `renovacao_carteira` uma linha com o mesmo `cnpj_digits` que a
  pessoa pode ver: `consultor_id = auth.uid()` **ou** `get_my_role() in ('admin','supervisor')` (a mesma regra da
  `renovacao_carteira_select`).
- **Sem** `insert`/`update`/`delete` para `authenticated`: só a RPC (4.4) e a Edge Function do robô (4.6, service role).

### 4.4 RPC `socios_pedir(p_carteira_id bigint) returns jsonb` (`security definer`, `search_path` fixo)

1. Lê a linha da `renovacao_carteira`; se não existe ou a pessoa não pode vê-la (regra de 4.3 com `auth.uid()`) →
   `{ok:false, motivo:'sem_permissao'}`.
2. Considera **abandonado** o pedido `consultando` com `iniciado_em` há mais de 10 min (vira `erro`, "A consulta não terminou").
3. Se já existe pedido `pendente`/`consultando` do CNPJ → devolve esse pedido. Se ele está `pendente` e
   `disparado_em` tem mais de 3 min → **dispara de novo** (passo 5) e atualiza `disparado_em`. Não conta no limite.
4. Conta os pedidos de `auth.uid()` no dia (data de São Paulo); se ≥ 20 → `{ok:false, motivo:'limite'}`.
5. Insere `pendente` e chama `net.http_post` para
   `https://api.github.com/repos/rafaangelao/apex-robo-procontact/actions/workflows/socios.yml/dispatches`
   (`ref: main`) com o token do Vault **`github_robo_token`** (o mesmo dos jobs `robo-procontact-*`).
6. Devolve `{ok:true, id, status}`.

`grant execute` só para `authenticated`; `revoke` de `public`/`anon`.

### 4.5 RPC `socios_da_base(p_carteira_id bigint) returns jsonb` (`security definer`, `stable`, `search_path` fixo)

- O schema `mailing` **não** é acessível a `authenticated` (conferido em 16/11) e continua assim: a leitura é só por esta RPC.
- Mesma checagem de permissão de 4.4 passo 1 (`sem_permissao` se a pessoa não vê o cliente).
- Devolve `{ok:true, receita_mes, socios:[{nome, cpf, principal, obito}]}` lendo `mailing.socio where cnpj = cnpj_digits`
  (usa o índice `socio_pkey`), `principal` primeiro e depois por nome; `receita_mes` da carga mais recente de `mailing.carga`.
- Sem sócio na base → `socios: []`. Só leitura: **não conta** no limite diário nem grava pedido.
- `grant execute` só para `authenticated`.

### 4.6 Edge Function `ingest-socios` (só o robô; `--no-verify-jwt`)

- Autenticação: header `x-robo-token` = secret **`INGEST_SOCIOS_TOKEN`** (novo; mesmo padrão da `ingest-ligacoes`).
- `{acao:'pegar', max}` → marca até `max` pedidos `pendente` como `consultando` (`iniciado_em = now()`, mais antigo
  primeiro, `for update skip locked`) e devolve **só** `[{id, cnpj}]`.
- `{acao:'resultado', id, status, resultado?, erro?}` → só aceita `pronto`/`sem_socios`/`erro` em pedido `consultando`;
  grava `concluido_em`. Valida o formato de 4.2 (dígitos, tamanhos) antes de gravar.
- Lógica pura em `ingest.ts` com testes (`ingest.test.ts`), como as outras `ingest-*`.

## 5. Robô (repo `apex-robo-procontact`)

### 5.1 Workflow `.github/workflows/socios.yml`

- Só `workflow_dispatch` (quem dispara é a RPC). `concurrency: { group: novavida, cancel-in-progress: false }`:
  no máximo um rodando e um esperando, e cada rodada esvazia a fila (5.3), então nenhum pedido se perde.
- `timeout-minutes: 10`. Mesmos passos do `sincronizar.yml` (checkout, Node 24, `npm ci`, Chromium com o fallback do apt),
  com **cache do Chromium** (`~/.cache/ms-playwright`, chave pela versão do Playwright) para encurtar a partida.
- Segredos: `NOVAVIDA_USUARIO`, `NOVAVIDA_SENHA`, `NOVAVIDA_EMPRESA` (já criados em 16/11), `INGEST_SOCIOS_URL`,
  `INGEST_SOCIOS_TOKEN`.

### 5.2 Arquivos (`src/socios/`, separados do código do ProContact)

| arquivo | faz |
|---|---|
| `novavida.js` | `entrar(page)` (pelo Congonhas, critério de 3), `buscarCnpj(page, cnpj)`, `lerPaginaSocios(page)`, `abrirSocio(page, i)`, `lerPaginaPessoa(page)` |
| `ler-socios.js` | funções **puras** texto/HTML → `{nome, cpf, participacao}` e `telefones[]`; ordenação e teto de 5 |
| `ingest.js` | `pegar()` e `enviarResultado()` (reaproveita `chamar` de `src/enviar.js`) |
| `main.js` | o ciclo de 5.3 e o resumo do log |

### 5.3 Ciclo

1. `pegar(max: 10)`; fila vazia → termina (sem login).
2. Abre o navegador e faz **um** login por rodada.
3. Para cada CNPJ: busca → página da empresa → **Sócios** → lê os cartões → ordena por participação → abre até 5
   sócios e lê **Telefones fixos** e **Celulares** → `enviarResultado(pronto)`. Sem cartões de sócio ou CNPJ não
   encontrado → `sem_socios`.
4. Volta ao passo 1 até a fila esvaziar (pega pedidos que chegaram durante a rodada), com teto de 8 min de rodada.

### 5.4 Erros

| caso | o que acontece |
|---|---|
| login falha | todos os pedidos pegos viram `erro` ("Falha no login da Nova Vida"); workflow termina **vermelho** |
| uma empresa passa de 60 s | só ela vira `erro`; o robô volta para a busca e segue |
| robô morre no meio | pedido fica `consultando`; a RPC o trata como abandonado após 10 min (4.4 passo 2) |
| disparo não chega ao GitHub | pedido fica `pendente`; "Tentar de novo" na ficha redispara após 3 min (4.4 passo 3) |

### 5.5 Log público

Só contagens e tempo: `socios: 3 pedidos · 3 prontos · 0 sem sócios · 0 erros · 52 s`. Nunca CNPJ, nome, CPF, telefone
ou usuário. Mensagens de erro passam por `limparErro` (`src/erro.js`). Sem prints nem artefatos.

## 6. Painel: aba "Sócios" na ficha da Renovação

- 5ª aba em `rnFichaAbas`, depois de Histórico: `['socios', 'Sócios']`. Mesmos botões e classes da ficha
  (`kbBtn`, `kbMeta`, `rnHist`); **sem cor ou token novo** (design Sinal de Ápice intacto).
- Ao abrir a ficha, `rnAbrirFicha` também lê o pedido mais recente do CNPJ (e o último com resultado) e chama
  `socios_da_base`, junto com `dados_claro` e histórico.
- **Quem manda na tela:** se existe resultado da Nova Vida, ele é o que aparece (é mais novo e traz telefones); a base
  só aparece enquanto não houver consulta da Nova Vida. O botão chama-se **"Consultar na Nova Vida"** (ou **"Atualizar"**
  quando já há resultado dela).

| situação | tela |
|---|---|
| nunca consultado, **com sócio na base** | lista da base: nome, **CPF com botão copiar**, etiqueta "principal" e "consta óbito" quando for o caso; legenda "Fonte: Receita Federal, base de mm/aaaa · sem telefones" (mês de `receita_mes`); botão **"Consultar na Nova Vida"** + "traz os telefones, leva cerca de 2 min" |
| nunca consultado, **sem sócio na base** | "A base da Receita não tem os sócios deste CNPJ." + botão **"Consultar na Nova Vida"** + "leva cerca de 2 min" |
| `pendente`/`consultando` | "Consultando na Nova Vida… m:ss" (relógio desde `pedido_em`); a ficha relê o pedido **a cada 5 s**; a lista da base (ou o resultado anterior) continua visível abaixo |
| `pendente` há mais de 3 min | botão **"Tentar de novo"** (chama a RPC de novo) |
| `pronto` | um cartão por sócio: nome, **CPF formatado com botão copiar**, participação %, telefones com **WhatsApp** (se celular) e **Ligar**, operadora em `kbMeta`. Sem telefones consultados → "telefones não consultados" |
| `sem_socios` | "A Nova Vida não mostra sócios para este CNPJ." |
| `erro` | mensagem genérica + **"Tentar de novo"**; o resultado anterior (ou a lista da base) continua aparecendo abaixo |
| limite (resposta da RPC) | "Você já fez 20 consultas hoje. Amanhã libera de novo." |

- Rodapé do resultado: **"Consultado em dd/mm hh:mm por Nome · Atualizar"** (`rnNomeConsultor`). Atualizar chama a RPC.
- Botões WhatsApp/Ligar dos sócios usam o mesmo `data-rn-canal` dos botões do topo da ficha.
- A releitura de 5 s **para** quando a ficha fecha ou troca de cliente (confere `rnEstado.fichaId`, como `rnAbrirFicha`)
  e quando muda o usuário (`rnAplicarPermissao` limpa o estado de sócios junto com o resto).
- Mensagem da RPC `sem_permissao` → "Você não tem acesso a este cliente."

## 7. O que não muda

Abas, fila, filtros, Kanban, importação e propostas da Renovação; Meus leads (inclusive o Verificar CNPJ do §128);
o `sincronizar.yml`, os jobs `robo-procontact-*` e o código do ProContact no robô; a Base de Mailing (tabelas, cargas e
permissões do schema `mailing`: só ganha a leitura pela RPC de 4.5).

## 8. Testes

- **Robô:** `ler-socios.js` com HTML **fictício** (nomes e números inventados) cobrindo: 2 sócios; 7 sócios (teto de 5
  com telefone); sem sócios; sócio sem telefones; celular com e sem WhatsApp; participação ausente. `main.js` com
  `fetch` e página falsos: fila vazia não faz login; login falho marca todos `erro`; empresa que estoura o tempo não
  derruba as demais; log sem dados.
- **Edge Function:** `ingest.test.ts`: token errado (401); `pegar` só devolve id+cnpj; `resultado` recusa status
  inválido, pedido que não está `consultando` e formato fora de 4.2.
- **Banco (SQL no projeto, leitura + transação com rollback):** RLS (consultor não vê sócio de cliente de outro;
  supervisor vê); `socios_pedir`: sem permissão, pedido em andamento devolvido sem contar limite, 21º pedido do dia
  barrado, abandonado após 10 min, redisparo após 3 min; `socios_da_base`: sem permissão, CNPJ com e sem sócio na base,
  `principal` primeiro, não grava nada; `authenticated` continua sem acesso direto ao schema `mailing`.
- **Painel (jsdom, no padrão `test_renovacao_ficha*.js`):** os 8 estados da tabela de 6 (base com e sem sócio, em
  andamento, tentar de novo, pronto, sem sócios, erro, limite); resultado da Nova Vida tem prioridade sobre a base;
  copiar CPF; parar a releitura ao fechar a ficha e ao trocar de usuário; aba nova não quebra as outras quatro.
- **Ponta a ponta (com ok do Rafael):** um CNPJ real da carteira, conferido na tela com o que o site mostra.

## 9. Riscos

- **reCAPTCHA v3 pode mudar de ideia** (nota do IP do GitHub piora): sem v2 configurado, o login seria negado. Sinal:
  workflow vermelho com "Falha no login". Saídas: pedir à Nova Vida o **webservice/API** (preferível) ou rodar de outra máquina.
- **Termos de uso da Nova Vida** podem proibir automação: Rafael confere o contrato ou pergunta ao comercial
  (junto com o preço da API).
- **O site muda o visual** → `ler-socios.js` deixa de achar os campos → pedidos viram `erro`; os testes com HTML
  fictício ajudam a ajustar rápido.
- **Alguém volta a usar o usuário compartilhado** durante o expediente → um derruba o outro.

## 10. Fora do escopo

Fase 2 (todos os consultores, em outro formato); Meus leads; consulta em lote; limpeza de pedidos antigos; outros
dados da pessoa (nascimento, mãe, endereço, e-mail); Realtime no lugar da releitura de 5 s; telefones dos sócios a partir
da `mailing.linha` (exige índice por CNPJ: avaliar depois, com ok e fora do expediente).
