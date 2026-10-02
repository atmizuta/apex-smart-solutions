# Robô ProContact → ligacoes_manuais (sincronização automática de chamadas manuais)

**Data:** 2026-10-01
**Responsável:** Rafael
**Status:** especificação para revisão (nada construído)
**Base:** `oficial/main` em 3cf257b (Monitoramento Leads, REGRAS_NEGOCIO.md seções 59 e 65)

## 1. Objetivo e critérios de sucesso

Hoje o relatório de chamadas manuais do ProContact (telefonia, sem API) é baixado e enviado à mão na sub-aba **Digital → Monitoramento Leads**. O objetivo é que o mesmo relatório chegue sozinho, **de hora em hora**, na tabela `ligacoes_manuais`, sem ninguém baixar ou subir arquivo.

Sucesso:
- Depois de ligado, nenhum upload manual é necessário no dia a dia.
- A contagem em `ligacoes_manuais` (já sem `eagle.*`) bate com a de um upload manual do mesmo período.
- Reenviar o mesmo período não duplica nem altera linhas já corretas.
- Falha da automação por mais de 3 h em horário comercial aparece no painel para admin/supervisor.
- O robô nunca possui a chave do banco nem aparece telefone nos logs.

Fora de escopo: alterar o Monitoramento Leads, a tela de upload (continua como contingência), outros relatórios do ProContact, qualquer coisa na aba Digital além de uma faixa de aviso.

## 2. Contexto confirmado

- ProContact não tem API. Login sem captcha e sem verificação em duas etapas (confirmado pelo Rafael em 01/10/2026).
- Caminho no site: **Relatório → Call Center → Chamadas Manuais → Filtros** (Período `dd/mm/aaaa hh:mm - dd/mm/aaaa hh:mm`, Empresa já vem `KR VALADAR`) → **Buscar** → **Exportar**.
- Relatório real (`MANUALCALL_REPORT_*.xlsx`): uma aba, linha 1 = cabeçalho, 23 colunas: `ID`, `UniqueID`, `Cod Integração`, `Campanha`, `Telefone`, `Status` (ANSWERED/FAILED), `Status Discagem`, `Protocolo 1/2`, `Usuario`, `DataHora_Geracao`, `DataHora_Atendimento`, `DataHora_Fim`, `Tempo_Total`, `Tempo_Chamada`, `Empresa`, `Canal`, `Gravacao`, `UniqueID` (repetida), `Última Tabulação`, `Transferido`, `Destino Transf.`, `TelefoneBr`. Datas em texto `dd/mm/aaaa hh:mm:ss` (São Paulo, `-03:00`). 17.498 linhas no período 01/09–01/10.
- Regras já em produção que o robô herda (REGRAS 59.3 e 65): colunas obrigatórias `ID`, `Usuario`, `Telefone`, `Status`, `DataHora_Geracao`; nome de coluna sem acento/caixa/espaços; `upsert` por `id`; `chave_tel` = DDD + 8 últimos dígitos; gatilho `ligacoes_manuais_ignora_eagle` descarta `eagle*`; RLS: só admin/supervisor leem.

## 3. Abordagem escolhida

Robô de navegador (Playwright + Chromium) agendado no **GitHub Actions de um repositório privado**, entregando as linhas a uma **Edge Function** do Supabase que grava. Alternativas descartadas: pedir API ao suporte (tentar em paralelo, sem depender), chamar o endereço interno do site (mais frágil e mais perto de violar termos de uso), rodar no PC do Rafael (depende do PC ligado), rodar no Hostinger (manutenção de Chrome no servidor).

## 4. Componentes

| Peça | Onde | O que faz |
|---|---|---|
| Repositório privado `apex-robo-procontact` | GitHub (fora do repo público do chefe) | Código do robô, workflow, testes e segredos |
| Robô | Actions (`ubuntu-latest`, Node + Playwright) | Login, navega, filtra, exporta, lê o Excel, envia em lotes |
| Edge Function `ingest-ligacoes` | Supabase `apex` (`mdgfboijyqfkggcrhptn`) | Valida token do robô, valida/mapeia linhas, `upsert` em `ligacoes_manuais` com service role, grava o log |
| Tabela `ligacoes_sync_log` | Supabase `apex` | Uma linha por execução: início, fim, status, lidas, enviadas, gravadas, ignoradas, erro (sem telefone) |
| Faixa de aviso | `_template.html` do painel (via oficial/main) | Admin/supervisor veem aviso se a última execução com sucesso passou de 3 h em horário comercial |

Segredos: no GitHub `PROCONTACT_USUARIO`, `PROCONTACT_SENHA`, `INGEST_TOKEN`, `INGEST_URL`. No Supabase (secret da função) `INGEST_TOKEN_HASH` (ou o próprio token) e a service role já existente. O robô **não** recebe `service_role` nem `anon` com escrita.

## 5. Fluxo de uma execução

1. Workflow dispara (cron) ou à mão (`workflow_dispatch`, com opção `dry_run`).
2. Robô abre o ProContact, entra com o usuário do robô.
3. Navega: Relatório → Call Center → Chamadas Manuais.
4. Período = **dia 1 do mês corrente 00:00 até agora**. Se hoje for dia 1 até as 06:00, usa também o mês anterior inteiro (cobre a virada de mês). Empresa mantém o padrão da conta.
5. Clica **Buscar**, espera o resultado (total na tela > 0 ou mensagem de vazio), clica **Exportar**.
6. Espera o arquivo (download imediato ou geração em fila, até 5 min; ver risco 8.2).
7. Lê o `.xlsx` com SheetJS, normaliza os cabeçalhos como o upload manual, converte datas (`dd/mm/aaaa hh:mm:ss` → ISO com `-03:00`), descarta antes de enviar as linhas `eagle*` e as inválidas (ID vazio, data fora do formato).
8. Envia lotes de até 500 linhas à `ingest-ligacoes` (HTTPS, header `Authorization: Bearer INGEST_TOKEN`, `Idempotency` pelo próprio `id`).
9. A função valida de novo (mesmas regras do upload manual), calcula `chave_tel`, faz `upsert on conflict (id)`, retorna contagens (`recebidas`, `gravadas`, `ignoradas`, `invalidas`).
10. Robô grava o resumo (via função) em `ligacoes_sync_log` e termina com código 0, ou 1 em qualquer falha.

Em `dry_run`: faz os passos 2 a 7 e compara a contagem lida com `count(*)` do período no banco (via função de leitura restrita), **sem gravar**.

## 6. Contrato da Edge Function `ingest-ligacoes`

- `POST` JSON `{ lote: [ {id, usuario, telefone, gerada_em, atendida, seg_falados, tabulacao, transferido, gravacao} , … ], execucao_id, final: bool, resumo? }`.
- Autorização: token comparado em tempo constante; sem token válido, `401`, sem corpo.
- Limites: no máximo 500 linhas por requisição e 1 MB; cabeçalhos CORS fechados (não é chamada de navegador).
- Mapeamento idêntico ao de REGRAS 59.3: `atendida` = `Status == "ANSWERED"`, `seg_falados` = `Tempo_Chamada` em segundos, `tabulacao` = `Última Tabulação` (`-` vira nulo), `transferido` = `Transferido`, `gravacao` = `Gravacao`, `importado_em` = agora. `usuario` mantém o texto original; o gatilho do banco continua descartando `eagle*` como segunda barreira.
- Resposta: contagens e, no máximo, os `id` rejeitados, nunca telefone.
- Quem lê o log: RLS só admin/supervisor.

## 7. Segurança e privacidade

- Repositório privado; senha do ProContact e token só em *secrets* do GitHub; **uma conta exclusiva do robô no ProContact, com permissão só de relatórios** (Rafael decide quem a cria).
- Nenhum telefone, nome ou linha do relatório em logs do Actions (mascarar; imprimir só contagens). O arquivo exportado fica na pasta temporária do runner e é apagado no fim; **não** é salvo como *artifact*.
- O robô não conhece a chave do banco. Revogar acesso = trocar `INGEST_TOKEN`.
- Dados pessoais (telefones) vão só ao Supabase `apex`; nada no repositório público (`atmizuta/apex-smart-solutions`).
- Antes de ligar: confirmar que o contrato/termos do ProContact permitem acesso automatizado.

## 8. Riscos e decisões em aberto

1. **IP de datacenter:** o ProContact pode bloquear ou exigir liberação dos IPs do GitHub. Só um teste real confirma. Plano B: rodar o mesmo robô num servidor ou PC com IP conhecido.
2. **Exportar em fila:** ainda não se sabe se o arquivo vem na hora. O robô trata os dois casos (espera de download direto; ou volta a uma lista de exportações) com tempo-limite de 5 min.
3. **Mudança de layout:** o robô usa seletores por texto/papel e falha de forma explícita, com captura de tela **sem dados** (somente a tela de filtros) como evidência opcional.
4. **Agendamento impreciso:** o cron do GitHub pode atrasar 5 a 30 min; aceitável. Fuso: `10-01 UTC` = 07–22 h de Brasília (segunda a sábado). Repositórios inativos por 60 dias podem ter agendamento pausado: o próprio robô gera atividade e o alerta de 3 h acusa.
5. **Limite do ProContact para consultas seguidas:** desconhecido; 1 execução/hora, sem repetição automática em sequência.
6. **Conta do robô:** precisa existir antes do primeiro teste.

## 9. Erros e avisos

| Situação | Comportamento |
|---|---|
| Login recusado, tela mudou, download ausente/vazio, erro de envio | Registra em `ligacoes_sync_log` (`status = erro`, mensagem curta), sai com código 1; GitHub avisa por e-mail |
| Sem execução com sucesso há > 3 h entre 07 h e 22 h (seg–sáb) | Painel mostra faixa de aviso a admin/supervisor (mesmo padrão da faixa de sincronização do NeoSales, seção 50) |
| Relatório vazio no período | Sucesso com 0 linhas; não é erro |
| Linhas inválidas | Contadas e ignoradas; relatório do dia continua |
| Duas execuções simultâneas | Segunda sai sem fazer nada (`concurrency` no workflow) |

## 10. Testes e entrada em operação

1. **Testes automatizados** (no repositório do robô): leitor de Excel + normalização de cabeçalhos + conversão de datas + filtro `eagle*` + mapeamento, com um arquivo de exemplo **com telefones e usuários trocados por valores falsos**; testes da função (autorização, limites, `upsert` idempotente, rejeição de linha inválida) em transação com *rollback*.
2. **Ensaio em seco (`dry_run`)** manual: compara a contagem lida com o banco, sem gravar.
3. **Primeira execução real manual:** o resultado precisa bater com o upload manual do mesmo período (referência de 01/10: 8.815 ligações sem `eagle.*`).
4. **Só depois** liga o agendamento e acompanha 24 h.
5. Reverter: desligar o workflow, trocar/revogar `INGEST_TOKEN`; as linhas gravadas permanecem e o upload manual continua disponível.

## 11. Autorizações exigidas na hora de construir (cada uma só com ok explícito do Rafael)

- Criar o repositório privado e cadastrar os *secrets*.
- Aplicar a migration da tabela `ligacoes_sync_log` no Supabase `apex` (produção) e publicar a função `ingest-ligacoes`.
- Qualquer mudança no painel (faixa de aviso): trabalhar a partir de `oficial/main` em worktree, `git fetch oficial` antes, comparar com o painel no ar antes de publicar, registrar em `REGRAS_NEGOCIO.md` (próximo número livre) e **nunca** publicar sem autorização.

## 12. Decomposição em planos (para o próximo passo)

1. **Plano A – Banco e função:** migration `ligacoes_sync_log`, função `ingest-ligacoes`, testes, rollback.
2. **Plano B – Robô e workflow:** repositório privado, Playwright, leitor/mapeamento, `dry_run`, workflow agendado.
3. **Plano C – Painel:** faixa de aviso de sincronização parada (pequeno; entra por `oficial/main`).

Ordem: A → B (ensaio) → C → liga o agendamento.
