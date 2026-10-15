# Discador automático → aba "Discador" (visão de supervisão)

**Data:** 2026-10-14
**Responsável:** Rafael
**Status:** especificação para revisão (nada construído)
**Base:** `oficial/main` em 12c9897 (REGRAS_NEGOCIO.md até a seção 80; a 81 está reservada para a migração da API de produção — esta frente usa a **seção 87**; a 82 acabou usada pela etapa TERRITÓRIO)

## 1. Objetivo e critérios de sucesso

O relatório do **discador automático** do ProContact (campanha `DISCADOR-APEX-AQUISICAO-CLARO-ABORDAGEM`) traz cada tentativa de discagem: status, consultor que atendeu, tabulação, tempos, carga de mailing e cidade. Nada disso está no painel hoje: o painel só tem as **chamadas manuais** (`ligacoes_manuais`, seção 59/65/69). O objetivo é dar à supervisão uma visão única para três decisões:

1. **Ajustar o discador:** ver contato e abandono por hora e segurar o ritmo quando o abandono dispara.
2. **Acompanhar o consultor:** atendimentos, tempo falado, tabulações e vendas de cada um.
3. **Avaliar o mailing:** qual carga, operadora de origem e cidade gera venda.

Sucesso:
- O relatório chega sozinho, de hora em hora, sem ninguém baixar arquivo.
- Depois da carga inicial, os totais da aba batem com o Excel de referência de 14/10 (seção 10).
- Uma falha do discador nunca impede a sincronização das chamadas manuais.
- Só admin/supervisor veem a aba; nome e CPF do cliente nunca chegam ao banco.

Fora de escopo nesta versão:
- placar do consultor;
- cruzar com as ligações manuais e com os leads da Digital;
- meta por carga;
- qualquer mudança no discador em si.

## 2. Contexto confirmado (Excel de 14/10, `dialer_calls_report_*.xlsx`)

- Uma aba, linha 1 = cabeçalho, 50 colunas (com nomes repetidos: `UniqueID` e `Região` aparecem duas vezes). Os cabeçalhos vêm em UTF-8 correto (com acento); normalizar sem acento/caixa, mantendo o `_` para separar colunas homônimas (`Data/Hora Fim` × `DataHora_Fim`, `Tempo Total` × `Tempo_Total`).
- Volume: 139.926 linhas de 01/10 a 14/10 (139.925 válidas) (9 dias úteis), ~15 mil por dia útil, ~20 MB o mês até o dia 14.
- `Status`: BUSY 76.548 · CHANUNAVAIL 28.981 · NOANSWER 24.425 · ANSWERED 5.932 · ABANDONED 2.619 · CONGESTION 1.413 (e mais 3 valores raros).
- 4 cargas no período: `TIM-APEX-1` 45.570 · `ICP-D-MEI-VIVO-APEX (3)` 35.830 · `TIM-APEX-1 (2)` 31.040 · `ICP-D-MEI-VIVO-APEX (2)` 27.485. Uma linha tem ID mas não tem `Status` nem carga: é descartada como inválida.
- `ID do Usuário` é **número do agente** (14 distintos com atendimento), não o login `apex.*` das chamadas manuais. Não existe hoje vínculo número → consultor.
- Datas: `DataHora_Geracao`, `DataHora_Conectado`, `DataHora_Atendimento`, `DataHora_Fim` em texto `dd/mm/aaaa hh:mm:ss`, horário de São Paulo. As colunas `Dt/Hr Início`, `Data/Hora Atendida` etc. estão em formato ISO e **3 h à frente** (UTC) — não usar.
- Tempos `Tempo_Espera`, `Tempo_Total`, `Tempo_Chamada` em `hh:mm:ss`; vazios quando não houve atendimento.
- `Documento 1` = CPF, `Documento 2` = CNPJ, `Nome/Desc` = nome do titular, `Campo 1` = operadora de origem da linha, `Campo 2` = porte (MEI), `Campo 3` = cidade, `Região` = macro-região.
- `Última Tabulação`: SEM AVANÇO, SEM CONTATO, DESCARTE, AQUISIÇÃO - PERDIDO, RETORNO, RENEGOCIAÇÃO - PERDIDO, AQUISIÇÃO - GANHO (ou vazio).

## 3. Abordagem escolhida

Estender o **robô ProContact** que já roda de hora em hora (repositório privado `apex-robo-procontact`, disparado pelo pg_cron `robo-procontact-disparo`, seção 69): na mesma execução, depois das chamadas manuais, exportar o relatório do discador de **ontem e hoje** e enviar a uma Edge Function nova. O painel lê agregados de funções SQL.

Descartadas: execução só noturna (perde o "hoje" para regular o ritmo); enviar só agregados (não cruza com venda); upload manual (depende de alguém baixar).

## 4. Dados

### 4.1 `discador_chamadas` (uma linha por tentativa)

| Coluna | Tipo | Origem / regra |
|---|---|---|
| `id` | bigint PK | `ID` |
| `gerada_em` | timestamptz not null | `DataHora_Geracao` (`-03:00`) |
| `conectada_em` | timestamptz | `DataHora_Conectado` |
| `atendida_em` | timestamptz | `DataHora_Atendimento` |
| `fim_em` | timestamptz | `DataHora_Fim` |
| `status` | text not null | `Status` como vem |
| `agente_id` | int | `ID do Usuário`; nulo se vazio |
| `seg_espera` | int | `Tempo_Espera` em segundos |
| `seg_falados` | int | `Tempo_Chamada` em segundos |
| `seg_total` | int | `Tempo_Total` em segundos |
| `tabulacao` | text | `Última Tabulação`; nulo se vazio |
| `carga_id` | int | `Cód. Carga` |
| `carga` | text | `Carga` |
| `campanha` | text | `Campanha` |
| `cnpj` | text | `Documento 2`, só dígitos, 14 posições com zero à esquerda |
| `telefone` | text | `Telefone` |
| `chave_tel` | text | DDD + 8 últimos dígitos (mesma regra de `ligacoes_manuais`) |
| `operadora_base` | text | `Campo 1` |
| `cidade` | text | `Campo 3` |
| `regiao` | text | `Região` (primeira não vazia) |
| `gravacao` | text | `Gravacao` |
| `importado_em` | timestamptz default now() | |

**Nunca gravados:** `Nome/Desc`, `Documento 1` (CPF), `Canal`, `Canal Agente`, `UniqueID`, `Integração*`, `Agent Records`. O robô os descarta antes de enviar; a função ignora qualquer campo fora da lista acima.

Índices: `gerada_em`; `(agente_id, gerada_em)`; `(carga_id, gerada_em)`; `cnpj`.
RLS: `select` só admin/supervisor; sem `insert/update/delete` para usuários (a função grava com service role).

### 4.2 Apoio

- `discador_agente (agente_id int PK, profile_id uuid null → profiles, apelido text, atualizado_em)`. Editado só por admin. Agente sem linha ou sem `profile_id` aparece como "Agente N".
- `discador_sync_log`: mesma estrutura e RLS de `ligacoes_sync_log` (execução, início, fim, ok, lidas, enviadas, inválidas, período, erro curto sem telefone).
- `config.discador`: `{ "abandono_alerta": 0.15, "janela_venda_dias": 30 }`.

### 4.3 Retenção

pg_cron `discador-limpeza`, diário às 04:30 SP: `delete from discador_chamadas where gerada_em < now() - interval '90 days'`.

## 5. Entrada: Edge Function `ingest-discador`

- Separada de `ingest-ligacoes` (falha de uma não afeta a outra).
- `POST` JSON `{ lote: [...], execucao_id, final: bool, resumo? }`; até 500 linhas e 1 MB por requisição.
- Autorização: header `x-robo-token` = secret `INGEST_DISCADOR_TOKEN` (mesmo padrão da ingest-ligacoes), comparado em tempo constante; inválido → `401` sem corpo. Token próprio, revogável sem mexer nas manuais.
- Validação: `id` numérico, `gerada_em` válida e `status` presente; o resto pode ser nulo. Linha inválida é contada e ignorada.
- `upsert on conflict (id)`; resposta com contagens (`recebidas`, `gravadas`, `invalidas`) e no máximo os `id` rejeitados — nunca telefone ou CNPJ.
- `final: true` grava o resumo em `discador_sync_log`.
- `verify_jwt` desligado (chamada de servidor, autorizada pelo token), CORS fechado.

## 6. Robô (`apex-robo-procontact`, privado)

Fluxo de cada execução (pg_cron, 07:17–22:17 SP, seg–sáb, sem mudança no disparo):

1. Login (uma vez).
2. Chamadas manuais → `ingest-ligacoes` — **sem alteração**.
3. Se `DISCADOR_ATIVO=true`: relatório do discador, período **ontem 00:00 → hoje 23:59** (SP) → lê o `.xlsx` → descarta campos proibidos e a linha sem `Status` → converte datas e tempos → lotes de 500 → `ingest-discador`.
4. Falha na etapa 3 grava erro em `discador_sync_log` e **não** altera o resultado da etapa 2; o job termina com aviso.

Peças:
- `src/procontact.js`: navegação **Relatório → Call Center → Discador → Filtros → Buscar → Exportar** (confirmado pelo Rafael em 14/10; o filtro aceita período com hora). O reconhecimento em modo `dry` só confirma seletores e o formato exato do campo de período.
- `src/parseDiscador.js`: leitor do layout de 50 colunas.
- `src/enviar.js`: reaproveitado, com destino e token parametrizados.
- Secrets novos: `INGEST_DISCADOR_URL`, `INGEST_DISCADOR_TOKEN`. Variável `DISCADOR_ATIVO`.
- Logs do Actions só com contagens; o arquivo exportado é apagado no fim e nunca vira *artifact*.

## 7. Métricas (funções SQL `security definer` com checagem de admin/supervisor)

Definições (vão para REGRAS §87):
- **Tentativas** = linhas do período.
- **Contato** = `status in ('ANSWERED','ABANDONED')`. **Taxa de contato** = contato ÷ tentativas.
- **Abandono** = `ABANDONED` ÷ contato (cliente atendeu e não havia consultor livre).
- **Atendidas** = `ANSWERED` com `agente_id` preenchido.
- **Sem tabulação** = atendida com `tabulacao` nula.
- **Venda do discador** = pedido em `producao_pedidos_neo` (mesmos filtros do Dashboard de Produção, sem GROSS) cujo `cnpj` teve uma chamada **atendida** no discador entre o dia de `cadastro` − `janela_venda_dias` e o fim do dia de `cadastro` (mesma data da matriz do Cadastro Diário, §66; `cadastro` não tem hora, então chamada no mesmo dia conta). Atribuída ao consultor e à carga da **última** chamada atendida antes do pedido. Um pedido conta uma vez.
- Período por `gerada_em` (chamadas) e por `cadastro` (vendas), sempre em horário de SP.

Funções:
- `discador_resumo(de, ate)` → cartões.
- `discador_por_hora(de, ate)` → por hora 9h–21h (tentativas, contato, atendidas, abandonadas) e a média do mesmo dia da semana nas 4 semanas anteriores.
- `discador_mapa_calor(de, ate)` → dia da semana × hora, taxa de contato.
- `discador_consultores(de, ate)` → uma linha por agente.
- `discador_mailing(de, ate, dimensao)` → `dimensao` = `carga` | `operadora` | `cidade` (cidade: mínimo de 300 tentativas, top 15 por vendas por 1.000).
- `discador_agentes_sem_vinculo()` → para o aviso do admin.

## 8. Painel: aba "Discador"

Local: item próprio "Discador" no menu lateral, grupo "Visão geral", depois do Boletim da Manhã (decisão do Rafael em 15/10: o Dashboard é um iframe com dados injetados e não reconsulta o banco por período). Visível só para admin/supervisor da operação Apex (mesmo critério do Boletim). Segue o design atual (Sinal de Ápice), sem mudar estilos existentes.

- **Filtro:** Hoje · Ontem · 7 dias · Mês · Personalizado (abre em Hoje).
- **Linha de status:** "Atualizado às HH:MM" (último log com sucesso). Faixa de aviso se não houver sincronização com sucesso há mais de 3 h entre 07h e 22h, segunda a sábado.
- **Cartões:** Tentativas · Taxa de contato · Abandono · Atendidas · Tempo médio falado · Vendas do discador.
- **Bloco 1 — Ritmo do discador:**
  - barras de atendidas e abandonadas por hora, com a linha de % de abandono;
  - em Hoje/Ontem, uma linha tracejada com a média do mesmo dia da semana;
  - mapa de calor dia × hora da taxa de contato;
  - faixa vermelha "Abandono de X% na última hora — segurar o ritmo do discador" quando a última hora cheia passa de `config.discador.abandono_alerta`.
- **Bloco 2 — Consultores:**
  - colunas: consultor, atendidas, tempo falado total e médio, % sem avanço, retornos, ganhos tabulados, sem tabulação, vendas do discador, conversão (vendas ÷ atendidas);
  - destaque quando o valor é mais de 30% pior que a média da equipe;
  - clique abre o detalhe por dia;
  - para o admin: aviso "N agentes sem consultor" com seletor que grava em `discador_agente`.
- **Bloco 3 — Mailing:**
  - tabela por carga: tentativas, contato %, abandono %, atendidas, ganhos tabulados, vendas, vendas por 1.000 tentativas;
  - a mesma tabela por operadora de origem;
  - a mesma tabela por cidade (top 15).
- Sem coluna de cliente, CNPJ ou telefone na tela.

## 9. Segurança e privacidade

- Nome e CPF descartados no runner; CNPJ e telefone só no Supabase `apex`, com RLS admin/supervisor e retenção de 90 dias.
- O robô não conhece chave do banco; revogar = trocar `INGEST_DISCADOR_TOKEN`.
- Nenhum dado real no repositório público: fixtures com valores falsos; sem amostra do Excel; sem vínculo número de agente → nome em código ou documento.
- O Excel de referência fica só no PC do Rafael; a carga inicial lê de lá e envia pela função.

## 10. Testes e conferência

1. **Função:** token inválido → 401; lote com mais de 500 → recusado; reenvio idempotente; linha inválida contada; campos proibidos não gravados mesmo se enviados.
2. **SQL:** cenário montado em transação com rollback, cobrindo:
   - contato e abandono;
   - venda atribuída à última chamada atendida dentro da janela;
   - GROSS fora;
   - pedido contado uma vez;
   - agente sem vínculo aparecendo como "Agente N";
   - consultor recebendo erro de permissão.
3. **Carga inicial (referência de 14/10):**
   - tentativas 139.925 (a linha sem `Status` fica de fora);
   - ANSWERED 5.932;
   - ABANDONED 2.619;
   - por carga: 45.570 / 35.830 / 31.040 / 27.485.
4. **Robô:** testes do leitor com fixture falsa → `dry` (compara contagem, não grava) → `real` manual → `DISCADOR_ATIVO=true` e acompanhar 24 h.
5. **Painel:** testes JS das contas da tela; conferência no navegador com perfil supervisor (vê) e consultor (não vê a aba).

## 11. Ordem de entrada no ar (cada passo que toca produção só com ok explícito do Rafael)

1. Migration (tabelas, RLS, funções, `config.discador`, cron de limpeza) com rollback em `supabase/rollback/`.
2. Edge Function `ingest-discador` + secret; carga inicial de outubro; conferir a seção 10.3.
3. Robô: reconhecimento → `dry` → `real` manual → ligar `DISCADOR_ATIVO`.
4. Painel: worktree a partir de `oficial/main`, comparar com o painel no ar, backup, publicar, MD5, vigia `-Aceitar`.
5. REGRAS_NEGOCIO.md §87 e push no oficial (fetch antes, sem force).

Reverter: `DISCADOR_ATIVO=false` e revogar o token; rollback da migration; restaurar o backup do painel. As chamadas manuais não são afetadas em nenhum caso.

## 12. Pendências do Rafael

Respondidas em 14/10:
- (a) Caminho: Relatório → Call Center → Discador → Filtros → Buscar → Exportar; o filtro aceita hora.
- (b) O Rafael faz o vínculo agente → consultor pela tela do admin.
- (c) Limite de abandono do alerta: 15% (aceito, sabendo que a média de outubro está em 30,6%).

## 13. Decomposição em planos

1. **Plano A — Banco e função:** migration, `ingest-discador`, testes, rollback, script da carga inicial.
2. **Plano B — Robô:** reconhecimento, leitor, etapa nova, flag, testes.
3. **Plano C — Painel:** aba Discador no menu lateral, funções de leitura no front, testes JS, publicação, §87.

Ordem: A → carga inicial → C pode começar em paralelo a B (já há dados de outubro) → B ligado → publicação.
