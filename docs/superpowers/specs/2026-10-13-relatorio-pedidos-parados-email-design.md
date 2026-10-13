# Relatório diário de pedidos parados (Antifraude e Entrega) por e-mail — design

Data: 13/10/2026. Pedido do Rafael.

## 1. Objetivo

Todo dia útil de manhã, a executiva da Claro que acompanha a operação da Apex recebe por e-mail um Excel com
**todos os pedidos parados em Antifraude e em Entrega**, cada um com a sua criticidade. Ela confere o status de
cada pedido e repassa ao back office, que repassa aos consultores.

**Fase seguinte (fora deste design):** depois que ela devolver o primeiro arquivo preenchido, definimos as
categorias de retorno padronizadas para o back office. A coluna "Retorno" deste Excel existe para isso.

### Decisões do Rafael (13/10/2026)

| Tema | Decisão |
|---|---|
| Destinatário | A executiva da Claro, sem cópia. O endereço fica **só no banco** (§4.4), nunca no repositório público. |
| Remetente | `corporativo@apexsmart.com.br` (caixa Hostinger), nome de exibição "Apex Smart Solutions". |
| Quando | Segunda a sexta, às **08:00** (Brasília). Não envia em feriado nacional. |
| Etapas | `ANTIFRAUDE (NEOCRM)` e `ENTREGA (NEOCRM)`. |
| Período | **Sem corte de data:** todo pedido que estiver nessas etapas na hora do envio (hoje são 105; 2 cadastrados há mais de 90 dias). |
| Operação | Apex e Campinas no mesmo Excel, com a coluna Operação. |
| Dados do cliente | Vão completos (nome e CNPJ). A executiva já acompanha a operação e tem acesso a esses dados. |
| Contagem | **Dias úteis** (seg–sex, sem feriados nacionais), como o painel já conta. |
| Criticidade | 🟡 **Baixa** 0–3 · 🟠 **Média** 4–6 · 🔴 **Alta** 7+ dias úteis. Todos os pedidos entram, inclusive os de 0 dia. |
| Teste | Primeiro envio vai para o e-mail do Rafael. Só depois de ele aprovar o arquivo o destinatário passa a ser a executiva. |

## 2. Arquitetura

Tudo no servidor, sem depender de computador ligado. Mesmo esquema das rotinas que já existem
(`sync-producao`, `alerta-sync-producao`):

```
pg_cron (seg–sex 11:00 UTC = 08:00 SP)
  └─ net.http_post → Edge Function relatorio-pedidos-parados   (header x-cron-secret, sem JWT)
        1. feriado nacional?            → registra "pulado: feriado" e para
        2. já enviou com sucesso hoje?  → registra "pulado: já enviado" e para (exceto com "forcar")
        3. lê destinatários (tabela própria) → vazio: erro; inativo: pulado
        4. lê pedidos em ANTIFRAUDE/ENTREGA (producao_pedidos_neo + histórico de etapas + operação)
        5. agrupa por pedido, conta dias úteis na etapa, classifica criticidade
        6. gera o .xlsx
        7. envia por SMTP Hostinger (smtp.hostinger.com:465, TLS)
        8. grava o resultado em relatorio_envio_log
```

### Unidades (pasta `supabase/functions/relatorio-pedidos-parados/`)

| Arquivo | O que faz | Depende de |
|---|---|---|
| `regras.ts` | Puro: feriados nacionais (fixos + móveis pela Páscoa), dias úteis entre duas datas no fuso de São Paulo, faixa de criticidade, agrupamento das linhas em pedidos, ordenação. | nada |
| `planilha.ts` | Recebe a lista de pedidos já classificados e devolve os bytes do `.xlsx`. | ExcelJS |
| `email.ts` | Monta assunto, corpo HTML e texto do e-mail a partir do resumo. Puro. | nada |
| `relatorio.ts` | Orquestra os passos 1–8 recebendo dependências injetadas (`agora`, `lerPedidos`, `lerDestinatarios`, `jaEnviouHoje`, `enviar`, `registrar`), para testar sem banco nem SMTP. | os três acima |
| `index.ts` | Confere o `x-cron-secret`, cria as dependências reais (Supabase service role, denomailer) e chama `relatorio.ts`. | supabase-js, denomailer |

Os feriados e a contagem de dias úteis seguem a regra do Dashboard (seção 48.2 do REGRAS), **copiada** para
`regras.ts`, porque a Edge Function não enxerga o código do painel. Há uma diferença de propósito: o Carnaval fica na
segunda e na terça (Páscoa − 48 e − 47). O painel usa − 47 e − 46, que marca a terça e a Quarta de Cinzas, e
esse erro será corrigido à parte.

## 3. Regras dos dados

- **Fonte:** `producao_pedidos_neo`, que a `sync-producao` atualiza de hora em hora, no minuto 59. Às 08:00 valem
  os dados da sincronização das 07:59, ou da última que terminou com sucesso.
- **Uma linha por pedido** (`numero_pedido`), como na seção 48.2:
  - o valor é a soma de `valor`, e a Qtd. é a soma de `quantidade`;
  - produtos distintos unidos por " + ";
  - vale o CADASTRO mais antigo e a ATUALIZACAO mais recente;
  - pedido sem número é ignorado.
- **Desde quando está na etapa:** `producao_na_etapa_desde(numero, etapa, atualizacao)`, já existente (§76).
  É o último registro do histórico de etapas com a etapa atual; sem histórico, vale a última ATUALIZACAO. É a
  mesma regra dos Pedidos Parados (§53.3) e do Boletim.
  - Em 13/10, 98 dos 105 pedidos davam o mesmo resultado que contar pela ATUALIZACAO.
  - Nos outros 7, a ATUALIZACAO mudou sem o pedido sair da etapa, então ela esconderia o tempo real de parada.
- **Dias parados:** dias úteis **depois** do dia (em São Paulo) da entrada na etapa até o **dia do envio**. Exemplos:
  - entrou na sexta, envio na segunda = 1 dia;
  - entrou hoje = 0 dias.
- **Criticidade:**
  - 0–3 Baixa;
  - 4–6 Média;
  - 7+ Alta.
  - As faixas ficam em constante própria (`FAIXAS = { media: 4, alta: 7 }`) e **não** mudam os níveis da aba
    Pedidos em Alerta do painel (3–5 / 6–9 / 10+), que continuam como estão.
- **Operação:** pelo vínculo `producao_pedidos_neo.usuario_id → consultor_neo → profiles.operacao`.
  - Sem vínculo = Apex, mesma regra da §78.
  - Rótulos: "Apex" e "Campinas".
- **Ordem:** dias parados (maior primeiro), depois etapa, depois número do pedido (numérico).

## 4. O que é enviado

### 4.1 E-mail

- **De:** `Apex Smart Solutions <corporativo@apexsmart.com.br>`.
- **Assunto:** `Pedidos parados — Antifraude e Entrega — 14/10/2026 (105 pedidos, 18 em alta)`.
- **Corpo (HTML simples, com versão em texto):**
  - uma frase de abertura;
  - uma tabelinha Etapa × Criticidade com totais;
  - a data e hora da última sincronização dos dados;
  - a orientação: "a coluna Retorno da planilha é para o status de cada pedido".
- **Aviso de dados velhos:** se a última sincronização com sucesso tiver mais de 3 horas na hora do envio, o corpo
  ganha uma linha de aviso. O e-mail sai mesmo assim.
- **Sem nenhum pedido parado:** o e-mail sai sem anexo e diz que não há pedidos parados nessas etapas.
- **Anexo:** `PedidosParados_AAAA-MM-DD.xlsx`.

### 4.2 Excel

O padrão visual é o mesmo do Excel de Pedidos em Alerta (§48.4).

**Aba "Pedidos Parados":**
- linha 1: título;
- linha 2: data de referência, horário da última sincronização e legenda das faixas;
- linha 3: cabeçalho congelado, com filtro automático em todas as colunas;
- uma linha por pedido, com estas colunas:

  | Criticidade | Dias parados | Etapa | Nº do pedido | Operação | Consultor | Cliente | CNPJ | Produto(s) | Qtd. | Valor (R$) | Cadastro | Na etapa desde | Última atualização | Retorno |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

- a linha inteira fica na cor clara da criticidade, e a célula "Criticidade" na cor forte;
- Nº do pedido e CNPJ são gravados como texto, o valor em R$, e as datas como datas reais do Excel no horário
  de São Paulo;
- a etapa aparece sem o sufixo " (NEOCRM)";
- "Retorno" vem em branco, com largura grande e quebra de linha, para a executiva preencher.

**Aba "Resumo":** matriz Etapa × Criticidade (Alta, Média, Baixa, Total), com o total geral.

**Biblioteca:** ExcelJS 4.4.0 (`npm:exceljs@4.4.0`), a mesma versão usada no painel.
- **Risco:** a ExcelJS pode não rodar no Edge Runtime do Supabase.
- **Por isso o primeiro passo do plano é uma prova:** gerar um arquivo mínimo colorido numa função de teste.
- **Se não funcionar:** gerar o `.xlsx` direto, montando o XML e compactando com `fflate`. As colunas, cores e filtro
  continuam os mesmos.

### 4.3 Segredos (Edge Function → Secrets; nunca no repositório)

- `SMTP_USER`: o endereço da caixa `corporativo@apexsmart.com.br`.
- `SMTP_PASS`: a senha dessa caixa. **O Rafael grava ele mesmo**, com um comando que o Claude passa, e a senha nunca
  aparece na conversa.
- `SYNC_CRON_SECRET`: já existe. É reaproveitado, como faz a `alerta-sync-producao`, então o `pg_cron` lê o mesmo
  `sync_producao_cron_secret` do Vault.
- **Host e porta:** `smtp.hostinger.com` e 465 por padrão. Podem ser trocados pelos secrets opcionais `SMTP_HOST` e
  `SMTP_PORT`.

### 4.4 Destinatários (no banco, fora do repositório)

- Ficam na tabela nova `relatorio_destinatarios` (§5), com uma linha por relatório: `para text[]`, `cc text[]` e
  `ativo boolean`.
- **Não ficam na `config`:** a política `config_select` deixa qualquer usuário logado, consultor inclusive, ler essa
  tabela.
- Trocar ou incluir alguém é um `update` nessa linha, sem publicar nada de novo. `ativo = false` pausa o envio
  agendado sem desligar o job.
- Os endereços são gravados direto no banco (SQL), nunca numa migration.

## 5. Banco (migration aditiva + rollback)

`supabase/migrations/20261013100000_relatorio_pedidos_parados.sql`:

- **Tabela `relatorio_destinatarios`:** `relatorio` (chave primária, `'pedidos_parados'`), `para text[]`, `cc text[]`,
  `ativo boolean default true`, `atualizado_em`.
  - RLS ligada; só admin lê e grava. A função usa service role.
- **Tabela `relatorio_envio_log`:** `id`, `relatorio` (`'pedidos_parados'`), `modo` (`agendado` | `teste` | `reenviar`), `executado_em`, `data_ref` (date),
  `status` (`enviado` | `pulado` | `erro`), `motivo`, `qtd_pedidos`, `destinatarios` (text[]), `erro`.
  - RLS ligada; só admin lê. Só a função grava (service role).
- **Job do `pg_cron` `relatorio-pedidos-parados`:** `0 11 * * 1-5` (UTC), `net.http_post` com `x-cron-secret` do
  Vault e body `{"modo":"agendado"}`.
- A migration **não** grava destinatários. Sem a linha em `relatorio_destinatarios`, o job registra `erro: sem destinatário`
  e não envia nada. Assim, publicar a função e o job não manda e-mail para ninguém antes do teste.

O rollback fica em `supabase/rollback/20261013100000_relatorio_pedidos_parados_rollback.sql`: desagenda o job e
apaga as duas tabelas.

### Chamada manual (teste e reenvio)

É o mesmo endpoint, com o `x-cron-secret`.

| Body | Efeito |
|---|---|
| `{"modo":"teste","para":["..."]}` | Envia só para os endereços do body, ignora `relatorio_destinatarios`, o feriado e o "já enviado hoje". O assunto ganha o prefixo `[TESTE]`. |
| `{"modo":"reenviar"}` | Envia para os destinatários cadastrados mesmo que o envio de hoje já tenha saído (`forcar`). |

## 6. Erros

- **SMTP falhou** (senha errada, Hostinger fora do ar): grava `status = erro` com a mensagem, sem a senha.
  - Não repete na mesma execução.
  - O reenvio é manual (`reenviar`), e o dia seguinte segue normal.
- **Banco falhou ao ler os pedidos:** `status = erro`, e não envia um Excel vazio por engano.
- **Segredo ausente ou `x-cron-secret` errado:** a resposta é 401/500 e nada é enviado.
- **Duplicidade:** um envio `enviado` para o mesmo `data_ref` faz o job agendado registrar `pulado`. Isso cobre o
  `pg_cron` disparar duas vezes.
- **Aviso de falha para alguém:** fica fora desta fase. Para conferir, basta olhar o `relatorio_envio_log`.
  O Telegram da `alerta-sync-producao` pode ser ligado depois.

## 7. Testes

São testes do Deno, no mesmo formato de `sync-producao/*.test.ts`. Rodam com
`node --test "supabase/functions/relatorio-pedidos-parados/*.test.ts"` (o projeto roda os testes das Edge Functions com o Node 24, sem Deno).

- **`regras.test.ts`:**
  - feriados fixos e móveis de 2026 e 2027 (Carnaval, Sexta-feira Santa, Corpus Christi);
  - dias úteis nas fronteiras: sexta → segunda = 1, mesmo dia = 0, véspera de feriado;
  - fuso: entrada às 23:30 de São Paulo cai no dia certo;
  - faixas nas fronteiras 3/4 e 6/7;
  - agrupamento (soma, produtos distintos, cadastro mais antigo);
  - operação (sem vínculo = Apex);
  - ordenação.
- **`planilha.test.ts`:** gera o arquivo com dados fictícios e relê com a ExcelJS. Confere:
  - as abas;
  - o cabeçalho e a ordem das colunas;
  - as cores por criticidade;
  - o filtro automático e o painel congelado;
  - a coluna Retorno vazia;
  - CNPJ como texto;
  - a matriz do Resumo.
- **`email.test.ts`:** assunto, totais, aviso de dados velhos, caso sem pedidos e prefixo `[TESTE]`.
- **`relatorio.test.ts`** (dependências falsas):
  - feriado → pulado;
  - já enviado → pulado;
  - `reenviar` ignora o "já enviado";
  - sem destinatário → erro; inativo → pulado;
  - SMTP falha → erro registrado;
  - `teste` usa só os endereços do body;
  - envio normal registra `enviado` com a quantidade.

Os testes usam só dados fictícios, porque o repositório é público.

## 8. Entrada no ar

1. Migration aplicada no Supabase `apex` (tabelas de destinatários e de log + job). O job roda e registra "sem destinatário",
   sem enviar nada.
2. Edge Function publicada (`--no-verify-jwt`), e `SMTP_USER` gravado.
3. O Rafael grava o `SMTP_PASS` com o comando que o Claude passar.
4. Envio de **teste** para o e-mail do Rafael (`modo: teste`). Ele abre o Excel e aprova.
5. Gravar em `relatorio_destinatarios` o destinatário real (a executiva). A partir do dia útil seguinte, às 08:00, o envio é
   automático.
6. REGRAS_NEGOCIO.md: nova seção 81, com a regra, os segredos, como reenviar e como desligar. Commit e push no
   `main` oficial.

**Desligar:** `select cron.unschedule(jobid) from cron.job where jobname = 'relatorio-pedidos-parados';`

## 9. Fora de escopo

- As categorias de retorno para o back office, que dependem do primeiro arquivo devolvido.
- A leitura automática da planilha devolvida.
- Mudar os níveis da aba Pedidos em Alerta do painel.
- Uma tela no painel para editar destinatários ou ver o log.
- O aviso de falha por Telegram.
- Outras etapas: Portabilidade, Crédito, Biometria.
