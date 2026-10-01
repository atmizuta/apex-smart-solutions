# Plano 2 — Agenda de portabilidades e instalações (hoje, próximas e atrasadas)

Spec: seções 3.4, 4.3. Depende do Plano 0. Independente do Plano 1 (pode sair antes ou depois).

**Meta:** o consultor vê o que vence hoje, o que vem nos próximos dias e, principalmente, o que **já passou da data e não concluiu**, com um toque para confirmar com o cliente pelo WhatsApp.

**Achado que muda a prioridade:** hoje só 24 pedidos abertos têm data preenchida (22 já vencidos, 2 futuros; instalação em nenhum). O primeiro valor está em *Atrasados* e *Sem data*, e a agenda futura cresce com o preenchimento.

**Arquivos**
- Modificar `_template.html`: seção "Agenda" (dentro da aba Minha Fila como 2ª sub-aba, ou cartão no topo; decidir com o usuário), JS `loadAgenda()`
- Reutilizar o fluxo de WhatsApp (REGRAS seção 41) e a consulta a `clientes` por `cnpj_digits`
- Criar `test_agenda.js`; registrar em `run_tests.sh`
- Atualizar `REGRAS_NEGOCIO.md` (seção 55)

## Tarefa 1 — Regra pura (TDD)
- [ ] `dataAlvo(pedido)`: `data_portabilidade` se houver; senão `data_instalacao` (mesma precedência do Fechamento, 16.14). Dia calculado em **America/Sao_Paulo**.
- [ ] `classificarAgenda(pedido, hoje)`: `atrasado` (data < hoje e etapa não concluída), `hoje`, `amanha`, `proximos7`, `futuro`, `sem_data` (etapa em portabilidade/entrega/eSIM **sem** data).
- [ ] Etapas que entram na agenda: as abertas com data + as de "sem data" (ENTREGA, PORTABILIDADE EM ANDAMENTO/TRATATIVA, VALIDAÇÃO ESIM).
- [ ] Testes: virada de dia em SP (22h59/00:00), data no fim de semana, pedido concluído com data passada **não** é atrasado, pedido com `data_instalacao` e sem portabilidade usa a instalação.

## Tarefa 2 — Dados
- [ ] `rpc('producao_meus_pedidos')` (Plano 0) filtrando etapas abertas; reutilizar a mesma carga da Minha Fila quando ambas estiverem abertas (um único fetch, cache na sessão).
- [ ] Telefone do cliente: `clientes.tel1/tel2` por `cnpj_digits = regexp_replace(cnpj,'\D','','g')`. RPC `telefones_dos_meus_clientes(cnpjs[])` (SECURITY DEFINER) que só responde para CNPJs que estão nos pedidos do próprio consultor (não vira consulta aberta à base de clientes).

## Tarefa 3 — Tela
- [ ] Faixas: **Atrasados** (vermelho, abre expandida), **Hoje**, **Amanhã**, **Próximos 7 dias**, **Sem data** (com o texto "preencha a data no NeoCRM para entrar na agenda").
- [ ] Cada linha: cliente, produto, etapa, data prevista, dias de atraso (corridos), botão **WhatsApp** (mensagem pronta: "Olá, tudo bem? Passando para confirmar a sua portabilidade/instalação prevista para {data}…", no padrão da seção 41; o consultor revisa antes de enviar — o painel não envia sozinho) e copiar nº do pedido.
- [ ] Sem telefone localizado: sem botão e com a dica "telefone não encontrado na base".
- [ ] Mobile e tokens como no Plano 1.
- [ ] Teste jsdom: isolamento por consultor, contagem por faixa, WhatsApp só com telefone, link `wa.me` correto (DDI 55, só dígitos).

## Tarefa 4 — Aviso ativo (depende do Plano 3b)
- [ ] O resumo diário (Plano 3) inclui "Hoje: N portabilidades/instalações · Atrasados: M".

## Tarefa 5 — Entrega
- [ ] `run_tests.sh` verde; `REGRAS_NEGOCIO.md` seção 55.
- [ ] Conferir com dados reais: 22 atrasados (10 em VALIDAÇÃO ESIM, 6 em ENTREGA, 3+3 em portabilidade) e 2 futuros hoje.
- [ ] Publicar só com autorização.

**Critério de pronto:** cada consultor vê somente as suas datas; o total de "Atrasados" bate com a consulta direta no banco.
