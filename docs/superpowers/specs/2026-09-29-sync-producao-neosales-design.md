# Sincronização automática da Produção (API NeoSales) — Design

Data: 29/09/2026 · Projeto Supabase: `apex` (`mdgfboijyqfkggcrhptn`)

## Problema
Hoje um admin exporta o relatório de produção do NeoCRM (aba "Exportacao"), sobe em "Upload Dash" e o painel apaga e reinsere tudo em `producao_pedidos`. O objetivo é eliminar esse ciclo: a base do painel deve espelhar o NeoCRM sozinha, sem ninguém exportar ou atualizar de hora em hora.

## Fonte
API "Produção v2" do NeoSales (POST, JSON). Regras confirmadas em teste real (29/09/2026):
- Só devolve pedidos criados/atualizados dentro da janela `dataHoraInicioCarga`..`dataHoraFimCarga`.
- Dia (a API diz 05:00–22:00; a doc diz 06:00–22:00): janela máxima de 90 min. Noite (22:01–05:59): sem limite. Fuso de São Paulo.
- Resposta em ISO-8859-1 (não UTF-8). Janela vazia = `[]`. **Erros vêm com HTTP 200** e corpo `{"erro":"…","success":false}`.
- **Intervalo mínimo entre consultas (descoberto em teste real, não está na doc):** depois de uma consulta bem-sucedida, a seguinte responde HTTP 200 com `{"erro":"Integração de produção executada recentemente. Aguarde N segundos…"}` (N ≈ 120). Consequência: **no máximo uma consulta à API por execução**, jobs com folga de ≥ 5 min entre si, e a carga inicial dividida em um job por mês.
- Uma linha por item, mais uma linha duplicada com `numeroLinha == "GROSS"` (descartar, senão o valor dobra). `numeroLinha` equivale à coluna GRUPO do export manual. Sem o GROSS, 17/17 pedidos cruzados com o export de 28/09 bateram em contagem e valor.

## Arquitetura
- **Tabela nova `producao_pedidos_neo`** (mesmas colunas de `producao_pedidos` + `item_id` único). Dashboard continua lendo a antiga até a paridade ser provada.
- **`producao_neo_raw`** (só admin lê): JSON cru de cada item, para investigar campos (ex.: motivo de perda) e auditar.
- **`producao_sync_log`**: uma linha por execução (modo, janela, contagens, erro). O "cursor" é o `janela_fim` da última execução ok.
- **Edge Function `sync-producao`** (sem JWT; autentica por header `x-cron-secret` guardado no Vault): busca a API por blocos, mapeia, faz upsert por `item_id`, remove itens que viraram `ARQUIVADO (NEOCRM)`, registra log. Responde 202 e trabalha em background.
- **pg_cron + pg_net**: `horario` (toda hora, minuto 7), `reconciliar` (23:37 SP, refaz os últimos 2 dias sem limite de janela, cura lacunas), `backfill` inicial único (um job por mês de 01/05 até hoje, a partir de 22:12 SP de 29/09, de 5 em 5 min, cada um se desagenda).
- Tokens do NeoSales só como secrets da Edge Function (nunca no HTML nem no repositório).

## Fora deste escopo (fase 2, exige aprovação)
Trocar o dashboard para a tabela nova (renomear tabelas), esconder/neutralizar "Upload Dash", exibir "última sincronização" e publicar no Hostinger — depois de a paridade ser comprovada.
