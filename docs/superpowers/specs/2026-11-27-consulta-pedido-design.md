# §170 Consulta Pedido no NEO — design

Aprovado com o Rafael em 3 partes no chat (26–27/11/2026). Depende da §166 (gaveta do pedido, `pedido_movimentacoes`).

## Objetivo
Na gaveta do pedido: ver os itens/linhas do pedido, corrigir etapa errada e atualizar na hora, pela API
Consulta Pedido da Xeotech (`GET https://api.xeotech.com.br/api/v1/pedidos/{pedidoId}/{token}`).

## Decisões
- **Quem clica:** admin e supervisor (supervisor só a própria operação, via `pedido_pode_ver`). Consultor vê a última
  consulta salva, sem botão. Sem `pedido_id` (só existe em `pedido_movimentacoes`) o botão fica desligado.
- **Correção da etapa:** só quando o nome do NEO, normalizado (sem acento, sem " (NEOCRM)", maiúsculo, espaço simples),
  bate com uma etapa que já existe em `producao_pedidos_neo`; grava o nome do painel em **todas as linhas** do pedido.
  Nome desconhecido: só aviso. O histórico registra com origem `sync` (o check só aceita `carga`/`sync`; mudar exigiria
  drop constraint); quem consultou fica em `pedido_consulta_neo`.
- **Abordagem A:** Edge Function sob demanda `consulta-pedido-neo` + controle de vaga no banco antes de chamar a Xeotech.

## Dados
- `pedido_consulta_neo`: última consulta por pedido — `etapa_neo`, `etapa_painel_antes`, `etapa_painel` (null =
  desconhecida), `corrigiu`, `resumo` (tipo de negociação, total, compromisso mensal, tags, observação, dono, equipe,
  última movimentação) e `itens` (linha, quantidade, valor, produto, categoria, plano, portabilidade, instalação,
  operadora cedente, cidade/UF).
- **Nunca guardados:** nome/CPF/CNPJ/telefone/e-mail do cedente, endereço completo do cliente e da instalação.
- `neo_consulta_log`: uma linha por chamada, gravada antes de chamar. Tabela própria porque o check de `api` da
  `neo_pedidos_sync_log` só muda com drop.

## Vaga (limite da Xeotech dividido com a sync da §166)
`consulta_espera_s(t)` devolve os segundos até haver vaga; `consulta_pedido_preparar` recusa sem chamar a API quando:
1. menos de 130 s desde o fim de qualquer chamada de pedidos (sem fim gravado = conta até 100 s, o timeout);
2. já houve 2 chamadas nos últimos 10 min (a consulta seria a 3ª e o cron seguinte levaria 429);
3. um cron da §166 dispara em até 150 s ou disparou há menos de 30 s (o log dele pode não estar gravado).
`pg_advisory_xact_lock` impede dois cliques simultâneos de passarem juntos. Horários do cron copiados (comentário
`shortcut:` na função).

## Fluxo
Painel → `consulta-pedido-neo` (verify_jwt) → `consulta_pedido_preparar` com o JWT de quem clicou (permissão, id,
vaga, reserva) → GET na Xeotech (timeout 20 s) → `recortar` → `consulta_pedido_salvar` (service_role: compara etapa,
corrige, grava, fecha o log) → resposta `{ok, corrigiu}` ou `{ok:false, erro}` sempre com HTTP 200. A gaveta recarrega
pela `pedido_linha_do_tempo`, que passou a trazer `consulta_neo`, `pode_consultar` e `tem_pedido_id`.

## Erros
401/403 → "token sem acesso, avise o admin"; 404 → "não encontrado no NEO"; 429 → "tente em X min" (Retry-After);
rede/5xx/resposta sem etapa → "o NEO não respondeu". O texto técnico vai só para `neo_consulta_log.erro`, sem o token
e sem o corpo do pedido.

## Testes
`consulta.test.ts` (node --test), `supabase/tests/consulta_pedido_check.sql` (rodar depois da migration; termina em
erro proposital = rollback), `test_movpedidos.js` (jsdom). Primeira chamada real: uma só, com ok do Rafael, fora dos
minutos de cron.
