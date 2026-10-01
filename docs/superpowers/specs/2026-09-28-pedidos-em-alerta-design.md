# Pedidos em Alerta — design (28/09/2026)

Nova aba **"Pedidos em Alerta"** dentro do Dashboard de Produção do painel de clientes Apex
(`_template.html` → iframe do dashboard embutido em `PRODUCAO_DASHBOARD_TPL_B64`). Mostra os pedidos
que **já viraram venda mas estão parados** em etapas pós-venda do NeoCRM, com três níveis de alerta por
cor, e exporta um Excel colorido para enviar ao back office.

## 1. Objetivo e público

- **Para quem:** gestão da Apex (perfis **admin** e **supervisor**) e o back office da Claro, que recebe o
  Excel.
- **Problema:** pedidos ganhos ficam esquecidos em Antifraude, Portabilidade ou Entrega. Sem uma lista
  priorizada, ninguém cobra a tempo e a venda atrasa ou se perde.
- **Sucesso:** ao abrir a aba, a gestão vê na hora quantos pedidos estão parados e há quanto tempo, filtra
  por etapa, nível ou consultor e exporta em um clique um Excel pronto para o back office, com as linhas
  vermelhas, laranjas e amarelas.

## 2. Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Etapas monitoradas | `ANTIFRAUDE (NEOCRM)`, `PORTABILIDADE EM ANDAMENTO (NEOCRM)`, `PORTABILIDADE EM TRATATIVA (NEOCRM)`, `ENTREGA (NEOCRM)` |
| Tempo parado | **Dias úteis** (seg–sex, sem feriados nacionais) desde a data da **ATUALIZACAO** |
| Faixas | 0–2: não aparece · 3–5: 🟡 **Mínimo** · 6–9: 🟠 **Médio** · 10+: 🔴 **Máximo** |
| Data de referência | **Data da última subida da planilha** ("Atualizado em" do dashboard), não o relógio de quem abre a tela |
| Linha da lista | 1 linha por **pedido**, com Nº, Cliente, CPF/CNPJ, Consultor, Grupo, Etapa, Produtos, Qtd., Valor total, Cadastro, Última atualização, Dias úteis parado e Nível |
| Filtros | Aba **independente** da barra lateral: sempre todos os grupos e sem filtro de período, com filtros próprios de Etapa, Nível e Consultor |
| Quem vê | **Só admin e supervisor** (`ADMIN_MODE` do dashboard). Para o consultor o botão da aba nem existe |
| Layout | Placar + matriz Etapa × Nível clicável + filtros + tabela única ordenada do mais parado ao menos parado |
| Excel | ExcelJS carregada sob demanda, com a linha inteira colorida por nível, aba "Resumo" e exportação do que está filtrado |

## 3. Regra de cálculo

### 3.1 Seleção e agrupamento

1. Parte de `DATA` (os registros de `producao_pedidos` já entregues ao iframe). Não depende de nenhum
   filtro da barra lateral.
2. Mantém só registros cuja `etapa` é **exatamente** uma das 4 etapas acima.
3. Agrupa por `numero_pedido`. Registro sem `numero_pedido` é descartado, porque não há pedido para
   cobrar.
4. Para cada pedido:
   - `atualizacao`: a **mais recente** entre as linhas. Na exportação atual todas as linhas de um pedido
     têm a mesma, mas não é garantido.
   - `etapa`: a da linha com a `atualizacao` mais recente.
   - `cadastro`: a mais antiga.
   - `cliente`, `cnpj`, `usuario` (consultor), `grupo`: o primeiro valor não vazio.
   - `produtos`: produtos distintos, em ordem alfabética, unidos por ` + `.
   - `qtd`: soma de `quantidade` (mesma regra da Visão Diária).
   - `valor`: soma de `valor` (mesma regra do resto do dashboard).
5. Pedido sem `atualizacao` válida é descartado.

### 3.2 Dias úteis

- Datas convertidas para o dia em **horário de São Paulo** (`spParts()` que já existe). O horário não
  importa, só o dia.
- `diasUteisDesde(dataAtualizacao, dataReferencia)` conta os dias **depois** de `dataAtualizacao` até
  `dataReferencia` **inclusive** que não são sábado, domingo nem feriado nacional. Os feriados vêm de
  `getBrazilianHolidays()`/`isHoliday()`, que já existem (fixos + Carnaval, Sexta-feira Santa e Corpus
  Christi). Se a data de referência for anterior à atualização, o resultado é 0.
- Exemplos:
  - atualizado sexta 25/09 com referência segunda 28/09 → **1**;
  - atualizado sexta 04/09 com referência quarta 09/09 → **2** (07/09 é feriado);
  - atualizado e referência no mesmo dia → **0**.

### 3.3 Nível

`nivelAlerta(dias)` → `null` (< 3), `'minimo'` (3–5), `'medio'` (6–9), `'maximo'` (≥ 10).
Os limites ficam numa constante única (`ALERTA_FAIXAS`) para ajuste futuro num lugar só.

### 3.4 Data de referência

- É o texto de `__UPDATED_AT__`, que o upload grava como
  `new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })`, por exemplo
  `"28/09/2026, 20:12:03"`. `parseDataReferencia()` extrai o `dd/mm/aaaa`.
- Se o texto não puder ser lido (ex.: `"—"`), usa **hoje em São Paulo** e a tela avisa: "data da base
  desconhecida — contando até hoje".
- **Atualização de hora em hora:** hoje o painel externo chama
  `atualizarDadosDashboard(novos)` a cada hora com os pedidos novos, mas não manda o "Atualizado em".
  O painel externo passa a buscar também `config.producao_atualizado_em` e a chamar
  `atualizarDadosDashboard(novos, updatedAt)`. O segundo argumento é opcional, para manter a
  compatibilidade. Assim a referência acompanha uma planilha nova subida por outro admin sem precisar
  recarregar.

### 3.5 Ordenação

Por dias úteis (decrescente) → etapa → nº do pedido. Os mais críticos ficam no topo.

## 4. Tela (aba "Pedidos em Alerta")

- **Botão da aba:** `data-tab="alertas"`, depois de "Visão Diária". É criado só quando `ADMIN_MODE` é
  verdadeiro, então nem aparece no HTML entregue ao consultor. `switchTab('alertas')` esconde a barra
  lateral de filtros (mesmo mecanismo da Visão Diária, com a classe `tab-alertas` no `body`).
- **Cabeçalho:** título "Pedidos em alerta" + subtítulo "Dias úteis desde a última atualização ·
  referência: base de dd/mm/aaaa hh:mm".
- **Placar (4 cards):** Em alerta (total) · 🔴 Máximo (10+) · 🟠 Médio (6–9) · 🟡 Mínimo (3–5).
- **Matriz Etapa × Nível:** linhas = as 4 etapas, colunas = 🟡/🟠/🔴/Total, com linha de total. Clicar num
  número aplica os filtros Etapa + Nível correspondentes. Clicar num total de linha ou coluna aplica só
  um deles.
- **Filtros:** selects de Etapa (todas + 4), Nível (todos + 3) e Consultor (todos + consultores presentes
  na lista de alerta), mais o link "Limpar filtros". O placar e a matriz mostram **sempre o total
  geral**. Os filtros só afetam a tabela e o Excel.
- **Botão "Exportar Excel"** alinhado à direita dos filtros. Fica desabilitado quando a tabela filtrada
  está vazia.
- **Tabela:** colunas na ordem da seção 2. A linha é pintada com o fundo claro do nível e a coluna Nível
  mostra um selo com a cor forte (MÍNIMO/MÉDIO/MÁXIMO). Valor em R$, datas em dd/mm/aaaa (a
  atualização com hh:mm). Rolagem horizontal no celular, nunca da página inteira.
- **Estado vazio:** "Nenhum pedido parado há 3 dias úteis ou mais nessas etapas. 🎉"
- **Cores:** variáveis novas no CSS do dashboard embutido, derivadas das que já existem:
  `--alerta-max: var(--perdido)`, `--alerta-med: var(--devolvido)`, `--alerta-min: var(--andamento)`,
  mais fundos claros (`--alerta-max-bg` etc.). Nenhum hex solto nas regras novas. O visual segue os
  `.card`, fontes e espaçamentos que o dashboard já usa. Nada do bloco "Sinal de Ápice" do painel
  externo é alterado.
- **Atualização de hora em hora:** `atualizarDadosDashboard` recalcula a aba se ela estiver aberta,
  mantendo os filtros escolhidos.

## 5. Exportação Excel

- **Biblioteca:** ExcelJS 4.4.0 (`https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js`),
  carregada **só no primeiro clique** em Exportar por `carregarExcelJS()` (injeta o `<script>` e reusa
  `window.ExcelJS` se já existir). Se falhar (sem internet ou CDN fora), a tela mostra "Não foi possível
  gerar o Excel agora — tente de novo" e nada quebra. O SheetJS atual continua intacto para as outras
  exportações.
- **Arquivo:** `PedidosEmAlerta_<aaaa-mm-dd da referência>.xlsx`.
- **Aba "Pedidos em Alerta":**
  - **Linha 1:** "Pedidos em Alerta — Apex / Claro" (negrito, maior).
  - **Linha 2:** "Base de dd/mm/aaaa hh:mm · dias úteis desde a última atualização · Mínimo 3–5 · Médio
    6–9 · Máximo 10+ · Filtros: <resumo ou 'todos'>".
  - **Linha 3:** cabeçalho (fundo grafite, texto branco, negrito), com filtro automático do Excel e painel
    congelado abaixo dele.
  - **Linhas 4+:** os pedidos filtrados, na ordem da tela.
    - A linha inteira tem o fundo claro do nível. A célula Nível tem a cor forte e o texto em negrito:
      branco no vermelho e no laranja, preto no amarelo.
    - CPF/CNPJ e Nº do pedido gravados como **texto**. Valor como número com formato `R$ #.##0,00`.
      Datas como data real do Excel (`dd/mm/aaaa` e `dd/mm/aaaa hh:mm`). Dias úteis como número.
    - Colunas com largura ajustada ao conteúdo.
  - **Cores do Excel:** constantes ARGB num único objeto `ALERTA_CORES_EXCEL`, que espelha os tokens
    da tela (o Excel não lê variáveis CSS).
- **Aba "Resumo":** a matriz Etapa × Nível (🟡/🟠/🔴/Total, com linha TOTAL) **dos pedidos
  exportados**.
- **Download:** `workbook.xlsx.writeBuffer()` → `Blob` → link temporário. O download fica numa função
  isolada (`baixarArquivo`) para o teste poder interceptar o buffer.

## 6. Onde o código entra

1. **Sincronização (antes de tudo):** o `main` oficial (atmizuta/apex-smart-solutions, `f80da04`) não
   tem o commit publicado em 28/09 às 19:24 (dashboard mobile + cores de status em andamento/devolvido,
   commit `d7f8140` do repositório antigo). O painel no ar em apexsmart.com.br é **idêntico** a esse
   commit. Primeiro passo: aplicar essas mudanças (`_template.html`, `painel_clientes_apex.html`,
   `test_visao_diaria.js`) no ramo e rodar `bash run_tests.sh` para confirmar que a base está verde.
   Segue a regra "junte, nunca sobrescreva" do `CLAUDE.md` e da seção 45.
2. **Dashboard embutido**, editado com `python dashboard_tpl.py extrair` / `empacotar`:
   - funções puras: `parseDataReferencia`, `diasUteisDesde`, `nivelAlerta`, `montarPedidosEmAlerta`,
     `resumirAlertas` (matriz);
   - renderização: `renderPedidosAlerta` (placar, matriz, filtros, tabela);
   - exportação: `carregarExcelJS`, `gerarExcelAlertas` (monta o workbook e devolve o buffer),
     `baixarArquivo`;
   - aba + CSS + gancho em `switchTab` e `atualizarDadosDashboard`.
3. **Painel externo (`_template.html`):** o timer de 1h também busca `producao_atualizado_em` e o passa
   como 2º argumento. Nenhuma outra mudança: nem schema, nem upload, nem RLS.
4. **`REGRAS_NEGOCIO.md`:** nova seção **46. Pedidos em Alerta** (regras desta spec) + referência cruzada
   na seção 16.
5. **`package.json`:** `exceljs` como dependência de desenvolvimento, só para os testes lerem o arquivo
   gerado. O navegador usa o CDN.

## 7. Testes

Novo `test_pedidos_alerta.js`, no mesmo padrão de `test_visao_diaria.js`: decodifica o template embutido
real, preenche os placeholders com **dados fictícios** e roda num jsdom.

- **Unidade:**
  - `diasUteisDesde`: sexta→segunda = 1; fim de semana não conta; 07/09 não conta; mesmo dia = 0;
    referência anterior = 0; virada de ano com o feriado de 01/01.
  - `nivelAlerta`: nas fronteiras 2/3, 5/6, 9/10.
  - `parseDataReferencia`: `"28/09/2026, 20:12:03"` → 2026-09-28; `"—"` → fallback.
- **Agrupamento:**
  - pedido com 3 linhas vira 1 linha, com qtd e valor somados e produtos distintos;
  - linhas com atualizações diferentes: vale a mais recente;
  - etapas fora da lista são ignoradas;
  - pedido sem número ou sem atualização é ignorado.
- **Tela:**
  - com `ADMIN_MODE=false` o botão `data-tab="alertas"` não existe;
  - com `true`, a aba renderiza o placar e a matriz com os totais esperados;
  - o clique na matriz filtra a tabela;
  - os filtros combinam;
  - estado vazio;
  - ordenação;
  - `atualizarDadosDashboard(novos, novaData)` recalcula a aba.
- **Excel:** injeta o `exceljs` do `node_modules` como `window.ExcelJS`, intercepta `baixarArquivo` e relê
  o buffer. Confere:
  - nome do arquivo e as 2 abas;
  - cabeçalho na linha 3, filtro automático e painel congelado;
  - cor de fundo de uma linha de cada nível e o selo;
  - CNPJ como texto; valor e datas com o tipo certo;
  - só os pedidos filtrados;
  - "Resumo" batendo com eles.
- **Conferência com a planilha real (local, fora do git):** se existir um `ExportacaoProducao*.xlsx` numa
  pasta indicada por variável de ambiente, o teste roda a extração real (`extractProducaoRecords`) + a aba
  com referência 28/09/2026 e confere o total de **61 pedidos em alerta (21 mínimo, 6 médio, 34 máximo)**.
  Esse é o número calculado de forma independente durante o design. Sem o arquivo, imprime `PULADO:`.
  Nenhum dado da planilha entra no repositório.
- **Suíte completa:** `bash run_tests.sh` inteira passando.
- **Visual:** `node demo_local.js`, com a aba aberta na demo em desktop e celular (375px) e prints para
  o usuário.

## 8. Fora de escopo (YAGNI)

- Coluna FILA do NeoCRM (exigiria mudar upload e schema). Fica para depois, se o back office pedir.
- Consultor ver os próprios pedidos (não há vínculo confiável entre o usuário do painel e o
  "Proprietário do pedido").
- Envio automático do Excel por e-mail ou WhatsApp, histórico de alertas e feriados estaduais ou
  municipais.

## 9. Entrega

- Ramo `feature/pedidos-em-alerta`, criado a partir de `oficial/main`, com commits pequenos: sync → regra
  → tela → Excel → docs. Push para o **repositório oficial** (`atmizuta/apex-smart-solutions`), conforme
  pedido do usuário.
- **Publicação no apexsmart.com.br** só com o OK explícito do usuário e seguindo o `CLAUDE.md`: comparar
  com o painel no ar antes, juntar, publicar, atualizar o `REGRAS_NEGOCIO.md` e depois levar ao `main`.
