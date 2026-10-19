# CRM Fibra — Proposta com fatura, comparativo e exportação (Sub-projeto 5) — Design

## Contexto

Sub-projeto 5 de 5 do redesign do CRM Fibra (ver
`docs/superpowers/specs/2026-10-01-crm-fibra-dashboard-redesign-design.md`). A ficha do lead
(`/leads/[cnpj]`) tem as abas Cliente, Linhas, Proposta e Abordagem, no ar em
`fibra.apexsmart.com.br`. Hoje a aba **Proposta** é uma lista de planos do catálogo com valor: não
sabe o que o cliente paga, não compara e não gera documento.

O painel de clientes (`painel_clientes_apex.html`, aba *Gerar Proposta* + *Analisar Fatura*,
`REGRAS_NEGOCIO.md` seções 4 e 20 a 35) já faz isso há semanas: lê a fatura Claro em PDF, sugere o
plano de cada linha pelo consumo, compara o que o cliente paga com a proposta e emite Word, PDF e PDF
do cliente. Este sub-projeto leva esse fluxo para o CRM, com melhorias, e **substitui** o construtor
simples da aba Proposta. O WhatsApp com link direto (`wa.me`) já existe na aba Cliente; aqui ele passa a
enviar também o comparativo.

Fora desta entrega: upload de planilha da base (sub-projeto 4), ler fatura escaneada com IA, motor de
renovação/incremento/passaporte/comissão do painel, proposta timbrada editável e modo manual
completo (ver "Pendências fora de escopo").

## Decisões do usuário

- **Escopo:** a aba Proposta vira o gerador do painel, com a fatura como porta de entrada (não uma aba
  separada, não só o comparativo).
- **Fatura:** anexar PDF **e** digitar. Só PDF com texto é lido automaticamente; escaneado ou foto cai na
  digitação. A fatura **não sai do navegador** (nada de IA, nada enviado a terceiros).
- **Igual ou parecido com o painel, e melhor:** mesmas regras de leitura, média de várias faturas,
  sugestão por consumo (90% / 40%), consolidar valores, Claro Monitor como benefício, validade de 1
  dia, três formatos de documento; acrescenta PNG, tabela editável e análise salva no lead.
- **Execução e publicação:** como nos sub-projetos anteriores, "implemente e publica com o meu Ok": o
  DDL no banco de produção, o merge/push e o deploy pedem OK próprio, um a um.

## Decisões tomadas nesta spec (para conferir)

1. **Telefone da linha mascarado.** O CRM só mostra telefone ao dono do lead (`lib/lead-contatos.ts`), mas
   toda proposta salva é visível a todos os consultores. Por isso a linha da fatura vira um rótulo
   `(17) ••••• 9652` (DDD + 4 últimos dígitos) assim que sai do leitor; o número completo existe só
   dentro das funções de leitura e média, nunca na tela, no banco ou nos documentos. Trocar para número
   completo é uma linha, mas exigiria checar o dono.
2. **Sugestão automática só com Pós Nacional.** O "Pós 30GB regional" lista DDDs de um jeito que não bate
   com a regra RSC/RSI do painel; fica como escolha manual. Por isso não existe o campo "DDD do endereço
   fiscal" obrigatório do painel.
3. **Sem motor de fibra próprio.** Fibra, banda larga e Claro Monitor vêm do catálogo (convergentes,
   banda larga, adicional), como hoje.
4. **Claro Monitor** é identificado pela descrição do item (começa com "Claro Monitor"), como benefício
   que **soma no total sem aparecer como linha** (regra do painel, seção 31.3).
5. **Exportar sem salvar é permitido** (o consultor manda o comparativo na hora). Salvar continua sendo
   um passo à parte e a proposta salva continua **imutável**: para mudar, cria-se outra.
6. **Mensagens de WhatsApp fixas e editáveis**, que **nunca afirmam economia**: o comparativo pode ser
   um aumento.
7. **PNG compacto:** agrupa por plano (não lista linha a linha) para não ficar muito alto, porque o
   WhatsApp corta o centro de imagens altas (lição da aba Biometria, seção 85 do `REGRAS_NEGOCIO.md`).

## Arquitetura

Tudo que toca a fatura e os arquivos acontece **no navegador**. O servidor só guarda a proposta.

```
PDF da fatura ──(pdfjs-dist, no navegador)──▶ texto
texto ──▶ extrairLinhasFatura ──▶ mesclarFaturas (média de 1 a 6) ──▶ LinhaAtual[]   (editável na tela)
LinhaAtual[] + catálogo ──▶ sugerirPlano ──▶ itens da nova proposta (agrupados por plano)
situação atual + itens ──▶ montarModeloDocumento ──▶ ModeloDocumento  (dado puro, testável)
ModeloDocumento ──▶ Word (docx) | PDF consultor (jsPDF) | PDF cliente (jsPDF) | PNG (prévia → imagem)
Salvar proposta ──(Server Action)──▶ crm_fibra.propostas + proposta_itens + situacao_atual
```

As bibliotecas pesadas (`pdfjs-dist`, `jspdf`, `docx`, `html-to-image`) são carregadas **sob demanda**
(`import()` ao clicar), para não pesar nas outras abas. A lógica de negócio fica em funções puras,
testadas em Node (Vitest), como nos sub-projetos anteriores; os desenhadores de arquivo são finos.

### Arquivos

Novos (todos em `crm-fibra/`):

- `lib/fatura/tipos.ts` — `LinhaAtual`, `SituacaoAtual`, `validarSituacaoAtual`, `rotuloDaLinha`.
- `lib/fatura/extrair.ts` — `normalizarAcentosPdf`, `extrairLinhasFatura` (porte de `extractFaturaLinhas`).
- `lib/fatura/mesclar.ts` — `mesclarFaturas` (porte de `mesclarLinhasFaturas`).
- `lib/fatura/sugestao.ts` — `sugerirPlano` (porte de `sugerirPlanoConsumo`) e constantes dos limiares.
- `lib/fatura/pdf-texto.ts` — `lerTextoDoPdf(file)` (só navegador, `pdfjs-dist`).
- `lib/proposta/agrupar.ts` — agrupa linhas escolhidas em itens ("10× Pós 12GB").
- `lib/proposta/modelo-documento.ts` — `montarModeloDocumento` (dado puro).
- `lib/documentos/docx.ts`, `pdf-consultor.ts`, `pdf-cliente.ts`, `png.ts`, `baixar.ts` — desenhadores.
- `lib/documentos/mensagens-whatsapp.ts` — modelos de mensagem.
- `public/marca/apex-logo.png`, `public/marca/claro-logo.jpg` — logos extraídos do painel publicado
  (ativos de marca já públicos; o repositório não tem os arquivos soltos).
- `app/(protected)/leads/[cnpj]/proposta-workspace.tsx`, `situacao-atual.tsx`, `nova-proposta.tsx`,
  `comparativo.tsx`, `comparativo-cartao.tsx`, `exportar.tsx` — telas da aba.
- `db/rollback-proposta-fatura.sql`.

Alterados: `db/schema.sql` (+ teste), `lib/propostas.ts`, `lib/proposta-rascunho.ts`, `lib/catalogo.ts`,
`app/(protected)/leads/[cnpj]/{aba-proposta,propostas-salvas,actions,page}.tsx` (+ testes),
`app/(protected)/catalogo/{novo-plano-form,actions}.tsx|ts`, `lib/ia/abordagem.ts` (quantidade nos
itens), `README.md`, `package.json`/lockfile. `proposta-builder.tsx` é absorvido por `nova-proposta.tsx`.

## Modelo de dados (schema `crm_fibra`)

DDL idempotente em `db/schema.sql`; produção tem 0 propostas, então não há dado a migrar.

```sql
alter table crm_fibra.catalogo_planos
  add column if not exists franquia_gb integer check (franquia_gb is null or franquia_gb > 0);
update crm_fibra.catalogo_planos
   set franquia_gb = (substring(nome from '^Pós ([0-9]+)GB'))::int
 where categoria in ('pos_nacional', 'pos_regional') and franquia_gb is null and nome ~ '^Pós [0-9]+GB';

alter table crm_fibra.proposta_itens
  add column if not exists quantidade integer not null default 1 check (quantidade between 1 and 1000),
  add column if not exists franquia_gb integer check (franquia_gb is null or franquia_gb > 0);

alter table crm_fibra.propostas add column if not exists situacao_atual jsonb;
```

- **`proposta_itens.valor` continua sendo o subtotal da linha** (quantidade × valor unitário), para que
  `total = soma dos valor` e tudo que já lê itens (histórico, Abordagem por IA) siga correto. O
  unitário é `valor / quantidade`, arredondado a centavos.
- `franquia_gb` do item é uma cópia (a proposta guarda o próprio retrato, como já faz com descrição e
  valor); só itens de Pós têm. É o que permite consolidar "2× 40GB, 4× 12GB" depois.
- `situacao_atual` guarda `{ faturasAnalisadas, linhas[] }` (formato abaixo) ou `null` (proposta sem
  fatura). RLS, grants e a regra "só `service_role`" não mudam: são colunas de tabelas existentes.
- Rollback: `db/rollback-proposta-fatura.sql` remove as quatro colunas (perde o que elas guardam).

## Contratos (funções puras)

```ts
export interface PlanoProposto { descricao: string; valorUnitario: number }   // retrato do plano escolhido

export interface LinhaAtual {
  rotulo: string;              // "(17) ••••• 9652" ou texto digitado ("Linhas do escritório"), ≤ 60
  quantidade: number;          // 1 para linha de fatura; N para grupo digitado ("5 linhas")
  planoGb: number | null;      // franquia atual
  valorUnitario: number;       // mensalidade de UMA linha, > 0
  consumoMb: number | null;    // média do período, quando veio da fatura
  origem: "fatura" | "digitada";
  proposto: PlanoProposto | null;   // plano da nova proposta para esta linha (null = ainda sem plano)
}
export interface SituacaoAtual { faturasAnalisadas: number; linhas: LinhaAtual[] }  // 0 a 6; ≤ 500 linhas
```

`proposto` é gravado junto da linha: é ele que permite remontar o comparativo **por linha** a partir de
uma proposta salva, sem guardar a escolha em outro lugar.

### Leitura da fatura (`extrair.ts`, `mesclar.ts`)

Porte fiel do painel, com a mesma regra confirmada pelo usuário (`REGRAS_NEGOCIO.md` 22.1): cada linha
móvel tem um bloco `DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (DDD) NÚMERO`; o plano é o
`Claro Pós <N>GB` com traço dentro de *Mensalidades e Pacotes Promocionais*; a mensalidade é a
*Oferta Conjunta Claro MIX*; o consumo é o `Subtotal` depois de `Internet (MB)`.

- `normalizarAcentosPdf` remove o espaço que o pdf.js cola em cada caractere acentuado ("LIGA ÇÕ ES").
- `extrairLinhasFatura(texto)` devolve, por bloco reconhecido: `ddd`, `numero`, `valorMensal | null`,
  `planoGb | null`, `temMonitor`, `consumoMb` (0 se a seção não existe). Texto vazio ou sem bloco → `[]`.
- `mesclarFaturas(listas)` casa as linhas pelo número, e calcula média de valor e consumo, faixa
  mínima/máxima, plano mais frequente (empate: o da fatura anexada por último), `planoGbDistintos` e
  em quantas faturas a linha apareceu. Com uma fatura, nada muda.
- A conversão para `LinhaAtual` (mascarar o telefone, exigir `valorUnitario > 0`) acontece logo depois;
  linha sem valor fica marcada para o consultor preencher antes de seguir.

### Sugestão por consumo (`sugestao.ts`)

`sugerirPlano(linha, planosPosNacional)` → `{ acao: "upgrade"|"downgrade"|"manter"|"indefinido", pctFranquia, plano }`
com os limiares do painel: `LIMIAR_UPGRADE_PCT = 90`, `LIMIAR_DOWNGRADE_PCT = 40`, `MARGEM_DOWNGRADE = 0.8`,
1 GB = 1024 MB. Upgrade: o menor plano maior que o atual que cobre o consumo (senão o maior), desempate
pelo mais barato. Downgrade: o maior plano menor que o atual cujo 80% ainda cobre o consumo (senão
mantém). Manter: o plano de franquia igual ou maior mais próximo. Sem plano atual reconhecido ou sem
catálogo → `indefinido`. Entram só planos **ativos** de `pos_nacional` com `franquia_gb`.

### Itens da proposta (`agrupar.ts`, `proposta-rascunho.ts`)

Os itens da nova proposta têm **duas origens, que nunca se misturam**:

- **Derivados das linhas.** `itensDasLinhas(linhas, catalogo)` soma as linhas pelo plano escolhido
  (`proposto`) e gera um item por plano:
  `{ catalogoPlanoId, descricao: descricaoDoPlano(plano), quantidade: n, franquiaGb, valor: n × plano.valor }`
  (soma em centavos, como `somarValores`). São recalculados sempre que o consultor troca o plano de uma
  linha e **não são editáveis à mão**, o que garante que a tabela por linha e o total nunca divergem. Cada
  linha da fatura já nasce com o plano sugerido selecionado (como no painel). Linha sem plano proposto
  não gera item e aparece com aviso.
- **Manuais.** Qualquer item do catálogo (agora com quantidade: fibra convergente, banda larga, Claro
  Monitor, Pós para linhas novas) e oferta avulsa (descrição, quantidade e valor unitário), como o
  construtor de hoje, com remover.

`validarItensProposta` passa a exigir quantidade inteira de 1 a 1000 e `franquiaGb` nulo ou inteiro > 0.

### Modelo do documento (`modelo-documento.ts`)

`montarModeloDocumento({ cliente, consultor, situacaoAtual, itens, opcoes: { consolidar, vendedor }, agora })`
devolve dado puro e já formatado:

```ts
interface ModeloDocumento {
  cliente: { razaoSocial: string; cnpj: string };
  consultor: string;                       // opcoes.vendedor || consultor
  emitidoEm: string; validoAte: string;    // emissão + 1 dia (regra do painel, seção 9)
  situacaoAtual: { itens: LinhaTabela[]; total: number; nota: string } | null;
  porLinha: LinhaComparada[] | null;       // só quando há linhas da fatura com plano e consumo
  novaProposta: { consolidado: boolean; itens: LinhaTabela[]; total: number };
  beneficios: { movel: boolean; badges: { label: string; desc: string }[] };
  resumo: { atual: number | null; proposto: number; diferenca: number | null; tipo: "economia"|"aumento"|"igual"|null };
}
```

- **Situação atual** agrupa por (plano, valor unitário): `5× 10GB — R$ 50,00/linha — R$ 250,00`. Nota:
  "Valor aproximado, pode conter variações devido a utilização ou encargos financeiros do período"
  (origem fatura) ou "Valores informados pelo consultor." (digitada).
- **Nova proposta** itemizada: `desc` = descrição do item, `qtd× valor unitário`, subtotal. Com
  `consolidar`, os itens com `franquiaGb` viram uma linha só: `N linha(s) — 2× 40GB, 4× 12GB — valor
  total consolidado` (GB do maior para o menor; mesma franquia soma); convergentes, banda larga,
  adicionais e avulsos continuam itemizados.
- **Claro Monitor** não vira linha: seu valor entra no `total` e ele aparece em `beneficios.badges`, depois
  de Ligações, WhatsApp e Waze ilimitados (estes três só quando `movel`, isto é, há item com `franquiaGb`).
  Invariante testada: `soma(itens visíveis) + valor do Monitor = total`.
- **`resumo`** só existe com situação atual. `diferenca = proposto − atual`; `tipo` pelo sinal.
- `porLinha` (comparativo por linha da fatura): rótulo, plano atual, consumo médio, plano proposto,
  valor atual → proposto e diferença; vem do `proposto` gravado em cada linha (por isso também existe
  nas propostas salvas). Linha sem `proposto` aparece com "sem plano proposto".

## Interface da aba Proposta

Uma página rolável com quatro cartões, na ordem do raciocínio do consultor:

1. **Situação atual** — "Anexar fatura(s)" (PDF, 1 a 6, até 10 MB cada). Tabela editável (rótulo, qtd,
   plano GB, mensalidade, consumo, remover) + "Adicionar linha" digitando (inclusive grupo: qtd 5).
   Avisos do painel: "média de N faturas", linha achada em X de Y faturas, plano mudou no período.
   PDF sem texto / nenhuma linha reconhecida: mensagem clara e a tabela fica pronta para digitar.
2. **Nova proposta** — cada linha da fatura mostra a sugestão (selo upgrade / downgrade / manter com % da
   franquia) e um seletor de plano, já preenchido com a sugestão e trocável por linha; os itens agrupados
   ("10× Pós 12GB") aparecem sozinhos logo abaixo. Seletor do catálogo + oferta avulsa para os itens
   manuais. Total.
3. **Comparativo** — cartões (linhas, mensalidade atual, nova mensalidade, economia ou aumento) e a
   tabela atual × nova. Opções: **Consolidar valores** e **Vendedor** (nome editável, padrão: o consultor
   logado).
4. **Exportar e enviar** — Word, PDF consultor, PDF cliente, PNG; "Copiar imagem"; "Salvar proposta";
   WhatsApp (abaixo).

Sem situação atual, os cartões 1 e 3 ficam recolhidos e a aba funciona como a proposta de hoje, só que
com quantidade e exportação. Em **Propostas salvas**, cada proposta ganha "Exportar" com os mesmos
formatos, a partir do retrato salvo.

## Documentos

Visual do painel (seção 8 do `REGRAS_NEGOCIO.md`): faixa preta com logos Apex e Claro, título, dados do
cliente (razão social, CNPJ, emissão, consultor), tabelas com cabeçalho vermelho `#b3101f` e linhas
zebradas, benefícios, caixa de destaque, rodapé "Apex Smart Solutions — Agente Autorizado Claro Empresas"
com validade.

| Arquivo | Para quem | Diferença no destaque |
|---|---|---|
| Word (`.docx`, editável) | consultor | só mostra redução quando `proposto < atual` |
| PDF consultor | consultor | idem |
| PDF cliente | cliente | economia (verde) ou aumento (âmbar), com o valor; por linha em tabela |
| PNG | cliente / WhatsApp | prévia da tela, agrupada por plano; economia/aumento como no PDF cliente |

Título do material do cliente: "COMPARATIVO DA SUA FATURA" (com situação atual) ou "RESUMO DA PROPOSTA".
Nomes de arquivo: `proposta_<razão social>.docx|pdf`, `proposta_cliente_<razão social>.pdf`,
`comparativo_<razão social>.png` (nome sanitizado). O PNG sai de um componente React (`ComparativoCartao`,
1080 px de largura) convertido por `html-to-image` a 2×; os logos vêm de `public/marca/` (mesma origem,
sem bloqueio de CORS). Razão social longa quebra linha em todos os formatos.

## WhatsApp

- O telefone vem de `normalizarTelefone(lead)`, e **só para o dono do lead** (`contatosVisiveis`). Para
  quem não é dono, ou sem telefone utilizável, o bloco mostra o aviso de contato manual que a aba Cliente
  já usa, sem botão quebrado.
- Dois modelos fixos e editáveis, com `{cliente}` e `{consultor}`, ex.: "Olá, {cliente}! Aqui é
  {consultor}, da Apex Smart Solutions, parceiro autorizado Claro Empresas. Preparei um comparativo da
  sua fatura com a nossa proposta e vou te enviar em seguida. Qualquer dúvida, fico à disposição." Nunca
  falam em economia.
- "Enviar pelo WhatsApp" abre `wa.me/<telefone>?text=<mensagem>` **de forma síncrona no clique**
  (evita o bloqueio de pop-up) e registra a mensagem com `registrarMensagemAction(cnpj, texto, "whatsapp")`,
  como o formulário de mensagem faz hoje. O WhatsApp não aceita anexo por link: a imagem vai por
  **Copiar imagem** (colar na conversa) ou **Baixar PNG**; o bloco explica os dois passos.

## Servidor e segurança

- `salvarPropostaAction(cnpjDigits, itens, situacaoAtual)`: mesma ordem de sempre (`sessaoAtiva()` fora do
  `try`, validação, `criarProposta`, `revalidatePath`, erros genéricos ao usuário e detalhe no log).
- `validarSituacaoAtual` no servidor (nada vem do navegador sem checagem): até 500 linhas; `rotulo` texto
  ≤ 60; `quantidade` inteira 1 a 1000; `planoGb` nulo ou inteiro 1 a 1000; `valorUnitario` finito, > 0 e
  ≤ 1.000.000; `consumoMb` nulo ou finito ≥ 0; `origem` ∈ {fatura, digitada}; `faturasAnalisadas` 0 a 6;
  `proposto` nulo ou `{ descricao ≤ 300, valorUnitario > 0 }`; e **qualquer rótulo com 8 ou mais dígitos
  seguidos é recusado** (origem fatura ou digitada), para que número completo nunca seja gravado, nem por
  chamada forjada nem por digitação do consultor.
- **Cadastro do catálogo** (`/catalogo`, admin): o formulário de novo plano ganha "Franquia (GB)",
  obrigatório nas categorias Pós Nacional e Pós Regional (inteiro > 0) e ignorado nas demais; a criação
  valida isso no servidor. Editar plano existente continua mudando só valor e observação. Sem a franquia,
  um plano Pós novo não entraria na sugestão por consumo.
- A fatura (PDF) **nunca** é enviada ao servidor; só o resultado já mascarado e editado.
- A Abordagem por IA continua só com itens e total da proposta; passa a escrever `quantidade× descrição`
  quando a quantidade é maior que 1. Não recebe a situação atual (não há comparação numérica na IA).
- Sem variável de ambiente nova. Dependências novas: `pdfjs-dist`, `jspdf`, `docx`, `html-to-image`,
  versões exatas e com pelo menos duas semanas de publicadas.

## Testes

- `extrair.test.ts`: fixtures **sintéticas** (o repositório é público: nenhum telefone, CNPJ ou nome
  reais) no formato da fatura, incluindo o espaço colado nos acentos; bloco sem dados; texto vazio;
  valor e consumo com milhar e vírgula; Monitor.
- `mesclar.test.ts`: uma fatura não muda nada; duas faturas (média, faixa, plano que mudou, linha ausente
  em uma); empate de plano.
- `sugestao.test.ts`: as quatro ações, bordas exatas em 90% e 40%, margem de 80%, catálogo sem plano
  maior/menor, plano atual fora do catálogo, `franquia_gb` nulo ignorado, plano inativo ignorado.
- `agrupar.test.ts` e `proposta-rascunho.test.ts`: soma em centavos (`39,99 × 7`); duas linhas no mesmo
  plano viram um item; linha com quantidade N conta N; linha sem `proposto` não gera item; itens
  derivados e manuais não se misturam; o total da tela, do modelo e do salvo é o mesmo número.
- `catalogo/actions.test.ts`: Franquia (GB) obrigatória em Pós, ignorada nas outras categorias, inteiro > 0.
- `modelo-documento.test.ts`: situação atual agrupada; consolidar (GB em ordem, mesma franquia soma,
  não-Pós intactos); Monitor fora das linhas e dentro do total (invariante); `resumo` nos três sinais e
  sem situação atual; validade = emissão + 1 dia; razão social longa.
- `docx.test.ts`, `pdf-*.test.ts`: geram o arquivo de verdade em Node (Packer / jsPDF) e conferem que não
  lançam e que o texto-chave está no conteúdo (título, total, nome do cliente). `png.ts` e a tela são
  conferidos no navegador (fora do Vitest).
- `pdf-texto` integração: gera um PDF sintético com jsPDF e lê de volta com `pdfjs-dist` em Node.
- `validarSituacaoAtual` e a Server Action: limites, rótulo com número completo recusado, `situacao_atual`
  nula, falha no insert não deixa cabeçalho órfão (já coberto) e erro de rede da chamada (já tratado por
  `chamarAcaoComSeguranca`, que passa a ser usado também ao salvar).
- `db/schema.test.ts`: colunas novas, `if not exists`, backfill, rollback na ordem.

## Review Focus

Entradas e falhas que os testes da spec não cobrem sozinhos e que mais provavelmente morderiam:

1. **PDF escaneado, protegido ou corrompido** → mensagem clara e tabela pronta para digitar, nunca tela
   vazia nem exceção do `pdfjs-dist` solta.
2. **Layout de fatura diferente** (o painel só foi validado com dois modelos): o leitor devolve `[]` ou
   linhas com valor nulo; a tela precisa permitir completar à mão e nunca gravar `valorUnitario` nulo.
3. **Número completo vazando** (tabela, banco, documento, log) em qualquer caminho, inclusive
   `console.error` e mensagens de erro.
4. **Arredondamento e totais** com centavos (`39,99 × 7`), consolidado + Monitor, e proposta sem item de
   Pós; total do documento sempre igual ao total da tela e ao total salvo.
5. **Arquivo grande/muitas faturas**: 6 PDFs grandes não podem travar a aba (leitura sequencial, limite de
   tamanho, indicador de progresso).

## Publicação (exige OK do usuário em cada passo)

1. Aplicar o DDL em produção (Supabase `mdgfboijyqfkggcrhptn`) e conferir colunas e backfill.
2. Merge em `oficial/main` e push (depois de `git fetch oficial`).
3. Deploy no Vercel (mesma receita do sub-projeto 2; sem variável nova) e teste sem login.
4. O usuário roda o checklist do README com uma **fatura real** (o PDF não vai para o repositório).

## Pendências fora de escopo

- Ler fatura escaneada ou foto (OCR/IA): decidido não enviar a fatura a terceiros nesta entrega.
- Compartilhar o arquivo direto no celular (Web Share) e hospedar o arquivo com link para o cliente.
- Proposta timbrada editável, modo manual completo (aparelho, valor único/parcelado), renovação/incremento
  como tipos, Claro Passaporte, meta de comissão de 10% por linha.
- Editar proposta salva ou reabri-la como rascunho.
- Usar a economia real (agora disponível pela fatura) na Abordagem por IA; hoje a IA continua proibida de
  afirmar economia.
- Telefone completo no documento do cliente (hoje mascarado, ver decisão 1).
