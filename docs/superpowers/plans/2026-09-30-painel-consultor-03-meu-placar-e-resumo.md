# Plano 3 — Meu Placar + resumo diário do consultor

Spec: seção 4.4. Depende do Plano 0. O resumo (3b) é mais útil depois dos Planos 1 e 2, porque os usa.

**Meta:** o consultor sabe, sem perguntar a ninguém, **onde está na meta do mês** e começa o dia com um "bom dia" objetivo: pedidos parados e quanto valem, o que vence hoje e quanto falta para a meta.

**Restrições já decididas:** o painel **não calcula nem mostra comissão** (decisão de 18/09, REGRAS 16.14). O placar usa **receita bruta das ativações**, com a regra do Fechamento (ativação = `data_portabilidade`, ou `data_instalacao` na banda larga; só pedidos "ganho"; piso 01/08/2026).

**Arquivos**
- Migration `supabase/migrations/20260930220000_metas_consultor.sql` (+ rollback)
- Modificar `_template.html`: cartão "Meu Placar" (topo da Visão Diária/entrada do consultor) e editor de metas (admin)
- Criar `supabase/functions/resumo-diario/` + job `pg_cron` (fase 3b)
- Criar `test_meu_placar.js`, `test_resumo_diario.js`; registrar em `run_tests.sh`
- Atualizar `REGRAS_NEGOCIO.md` (seção 56)

## Fase 3a — Meu Placar (sem canal externo)

### Tarefa 1 — Metas
- [ ] Tabela `metas_consultor(profile_id uuid references profiles, mes date, meta_receita numeric, meta_ativacoes int, primary key (profile_id, mes))`. RLS: consultor lê só a própria; admin/supervisor leem tudo; escreve só admin.
- [ ] Editor do admin (Configurações): mês atual + grade consultor × meta (R$ e/ou ativações conforme **D4**), "copiar do mês anterior". Reusar `.card`, `table.tbl`, `.field`.

### Tarefa 2 — Cálculo (TDD)
- [ ] `calcularPlacar(pedidos, mes, meta, hoje)` reaproveitando `agruparFechamentoPorConsultor` (REGRAS 16.14): ativações (contratos distintos), receita bruta, cadastrados no mês.
- [ ] Projeção: `receitaAteHoje / diasUteisDecorridos * diasUteisDoMes` (feriados como na seção 48); `% da meta`, `faltam R$ X` e `≈ N ativações` (pelo ticket médio do próprio mês).
- [ ] Testes: primeiro dia útil (sem divisão por zero), mês sem feriado/com feriado, meta ausente (mostra só números, sem %), pedido perdido/devolvido não conta, piso 01/08.

### Tarefa 3 — Tela
- [ ] Cartão **Meu Placar**: ativações, receita, cadastrados, barra de progresso da meta, ritmo ("no ritmo atual você fecha em R$ X") e dias úteis restantes.
- [ ] Sem ranking de colegas aqui (o ranking de equipe da seção 37 continua onde está).
- [ ] Sem vínculo (Plano 0): mensagem padrão; sem meta: "sua meta deste mês ainda não foi definida".
- [ ] Teste jsdom: consultor só vê o próprio placar; admin "ver como".

## Fase 3b — Resumo diário "bom dia" (precisa do canal)

### Tarefa 4 — Canal
- [ ] **Bloqueio conhecido:** token do bot e chat ids do Telegram ainda não existem (pendência do alerta de sync). Criar o bot no @BotFather (usuário), guardar `ALERTA_TELEGRAM_TOKEN` só nos secrets da função.
- [ ] Tabela `consultor_telegram(profile_id, chat_id, vinculado_em)`. Vínculo por código: o painel mostra um código de 6 dígitos ao consultor, que manda `/start <código>` ao bot; uma função recebe o webhook e grava o `chat_id`. (Alternativa sem webhook: admin cola o chat id no editor.)

### Tarefa 5 — Envio
- [ ] Edge Function `resumo-diario` (mesmo padrão de segredo/Vault do `alerta-sync-producao`): para cada consultor vinculado, monta o texto com as mesmas regras dos Planos 1–3 e envia.
- [ ] Texto, só contagens e valores (**sem nome/CNPJ de cliente**, LGPD): "Bom dia, {nome}! • {N} pedidos parados = R$ {X} • Hoje: {h} portabilidades/instalações, {a} atrasadas • Meta: {p}% (faltam R$ {f})".
- [ ] `pg_cron` 08:00 America/Sao_Paulo, segunda a sexta, não em feriado nacional. Não envia se a última sincronização estiver parada (há alerta) — manda aviso em vez de números velhos.
- [ ] Idempotência (não enviar 2x no mesmo dia: tabela de log) e falha de um consultor não derruba os demais.
- [ ] Testes com Telegram simulado; **teste real de ponta a ponta com o usuário** antes de ligar o cron para todos (piloto com 1 consultor).

### Tarefa 6 — Entrega
- [ ] `run_tests.sh` verde; `REGRAS_NEGOCIO.md` seção 56 (regra do placar, metas, canal, LGPD, como desligar).
- [ ] Publicar só com autorização; ativar o cron só depois do piloto aprovado.

**Critério de pronto:** o placar do consultor bate com a linha dele no Fechamento do admin (mesmas ativações e mesma receita); o resumo chega às 8h com números iguais aos das telas.
