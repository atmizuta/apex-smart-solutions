// Testa a Agenda (06/10/2026) — REGRAS_NEGOCIO.md §72. Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md
// DADOS FICTÍCIOS — o repositório é público.
const { montarPainel } = require('./painel_teste_base.js');
const { rodar } = montarPainel();
rodar(`
  // ==== TASK 4: funções puras ====
  eq(agPartesSP('2026-10-07T01:30:00Z'), { dia: '2026-10-06', hora: '22:30' }, 'UTC da madrugada = noite anterior em SP');
  eq(agIsoSP('2026-10-06', '14:30'), '2026-10-06T14:30:00-03:00', 'ISO com -03:00');
  eq([agMesVizinho('2026-12', 1), agMesVizinho('2026-01', -1)], ['2027-01', '2025-12'], 'virada de ano');
  eq(agRotuloMes('2026-10'), 'OUTUBRO 2026', 'rótulo do mês');
  const out = agGradeMes('2026-10');
  eq([out.length, out[0].dia, out[0].doMes, out[34].dia], [35, '2026-09-27', false, '2026-10-31'], 'outubro/2026: 35 dias, começa no domingo 27/09');
  eq(agGradeMes('2026-02').length, 28, 'fevereiro/2026 cabe em 4 semanas');
  const fev24 = agGradeMes('2024-02');
  eq([fev24.length, fev24.filter(d => d.doMes).length, fev24[34].dia], [35, 29, '2024-03-02'], 'fevereiro bissexto');

  const AGORA = sp('2026-10-06T10:00:00');
  eq(agSituacao({ status: 'pendente', quando: '2026-10-06T09:00:00-03:00' }, AGORA), 'atrasado', 'passou da hora = atrasado');
  eq(agSituacao({ status: 'pendente', quando: '2026-10-06T11:00:00-03:00' }, AGORA), 'pendente', 'futuro = pendente');
  eq(agSituacao({ status: 'feito', quando: '2026-10-06T09:00:00-03:00' }, AGORA), 'feito', 'feito');
  const rets = [
    { id: 'r1', status: 'pendente', quando: '2026-10-06T16:00:00-03:00', nome: 'B Teste' },
    { id: 'r2', status: 'pendente', quando: '2026-10-06T09:00:00-03:00', nome: 'A Teste' },
    { id: 'r3', status: 'cancelado', quando: '2026-10-06T08:00:00-03:00', nome: 'C Teste' },
    { id: 'r4', status: 'pendente', quando: '2026-10-07T01:30:00Z', nome: 'Noite Teste' },
    { id: 'r5', status: 'pendente', quando: '2026-10-06T17:00:00-03:00', nome: 'D Teste' },
    { id: 'r6', status: 'feito', quando: '2026-10-06T18:00:00-03:00', nome: 'E Teste' },
  ];
  const pd = agPorDia(rets, [{ dia: '2026-10-06', numero: 'N1', cliente: 'Cliente Teste', tipoData: 'portabilidade' }]);
  eq(pd.get('2026-10-06').retornos.map(r => r.id), ['r2', 'r1', 'r5', 'r6', 'r4'], 'ordem por hora (feito incluído), cancelado fora, 22:30 SP no mesmo dia');
  eq(pd.get('2026-10-06').pedidos.length, 1, 'pedido no dia');
  const res = agResumoDia(pd.get('2026-10-06'), AGORA);
  eq([res.visiveis.length, res.mais, res.atrasados], [3, 3, 1], 'até 3 visíveis, +3, 1 atrasado (09:00)');

  const at = agAtalhos(sp('2026-10-06T10:02:00'));
  eq(at.map(a => a.rotulo), ['Em 2h', 'Amanhã 9h', 'Amanhã 14h', 'Seg 9h'], 'rótulos dos atalhos');
  eq([at[0].dia, at[0].hora], ['2026-10-06', '12:05'], 'em 2h arredonda para 5 min');
  eq([at[1].dia, at[3].dia], ['2026-10-07', '2026-10-12'], 'amanhã e próxima segunda (06/10 é terça)');
  eq(agAtalhos(sp('2026-10-12T10:00:00'))[3].dia, '2026-10-19', 'numa segunda, "Seg" é a da semana seguinte');
  eq(agRemarcarMesmoHorario('2026-10-06T14:30:00-03:00', '2026-10-09'), '2026-10-09T14:30:00-03:00', 'remarcar mantém a hora');

  eq(agValidarRetorno({ nome: ' ', telefone: '19990000001', dia: '2026-10-07', hora: '09:00' }, AGORA).erro, 'Informe o nome do cliente.', 'nome obrigatório');
  eq(agValidarRetorno({ nome: 'X Teste', telefone: '123', dia: '2026-10-07', hora: '09:00' }, AGORA).erro, 'Telefone inválido: use DDD + número.', 'telefone válido');
  eq(agValidarRetorno({ nome: 'X Teste', telefone: '19990000001', dia: '', hora: '09:00' }, AGORA).erro, 'Escolha dia e hora.', 'dia obrigatório');
  const passado = agValidarRetorno({ nome: 'X Teste', telefone: '19990000001', dia: '2026-10-06', hora: '08:00' }, AGORA);
  eq([passado.erro, passado.aviso], [null, 'Esse horário já passou.'], 'passado pode, com aviso');

  const calc = { agenda: { atrasados: [{ diaAlvo: '2026-10-01', numero: 'N9', cliente: 'Cli Teste', tipoData: 'instalação' }], hoje: [], amanha: [], proximos7: [], depois: [], semData: [{ diaAlvo: null }] } };
  eq(agPedidosItens(calc), [{ dia: '2026-10-01', numero: 'N9', cliente: 'Cli Teste', tipoData: 'instalação' }], 'pedidos: sem data fica fora');
  eq(agPedidosItens(null), [], 'sem cálculo de pedidos');

  // ==== FIX: mock compara timestamptz por instante, não por texto (offsets diferentes) ====
  window.__tabelas.x = [{ id: 'xa', quando: '2026-10-06T13:30:00-03:00' }, { id: 'xb', quando: '2026-10-06T16:00:00Z' }];
  const porInstante = await sb.from('x').select().gte('quando', '2026-10-06T16:10:00Z');
  eq(porInstante.data.map(r => r.id), ['xa'], 'gte compara por instante: 13:30-03:00 (16:30 UTC) passa de 16:10Z, 16:00Z não');
  const porInstanteLte = await sb.from('x').select().lte('quando', '2026-10-06T16:10:00Z');
  eq(porInstanteLte.data.map(r => r.id), ['xb'], 'lte compara por instante: 16:00Z fica, 13:30-03:00 (16:30 UTC) não');
  const ordenado = await sb.from('x').select().order('quando');
  eq(ordenado.data.map(r => r.id), ['xb', 'xa'], 'order compara por instante: 16:00Z vem antes de 13:30-03:00 (16:30 UTC)');

  // ==== TASK 6: aba, calendário, painel do dia ====
  const nowReal = Date.now;
  Date.now = () => AGORA;
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  window.__tabelas.agenda_retornos = rets.map(r => Object.assign({ consultor_id: 'c1', telefone: '19990000001', tipo: 'ligacao' }, r));
  ppEstado.calc = calc;
  const btnAg = document.querySelector('#tabsNav button[data-tab="agenda"]');
  assert(btnAg && btnAg.querySelector('.sbLabel').textContent === 'Agenda', 'botão Agenda no menu');
  btnAg.click();
  await espera(60);
  assert(document.getElementById('panel-agenda').classList.contains('active'), 'abre a aba');
  eq(document.getElementById('agTituloMes').textContent, 'OUTUBRO 2026', 'mês atual');
  const celulas = document.querySelectorAll('#agGrade .agDia');
  eq(celulas.length, 35, 'grade com 35 dias');
  const hoje = document.querySelector('#agGrade .agDia[data-dia="2026-10-06"]');
  assert(hoje.classList.contains('hoje') && hoje.classList.contains('temAtraso'), 'hoje destacado e com atraso');
  eq([...hoje.querySelectorAll('.agItem')].map(i => i.textContent.trim().slice(0, 5)), ['09:00', '16:00', '17:00'], '3 itens visíveis em ordem de hora');
  assert(hoje.querySelector('.agMais').textContent.includes('+2'), '+2 (5 retornos no dia; o pedido do teste é do dia 01)');
  const dia1 = document.querySelector('#agGrade .agDia[data-dia="2026-10-01"]');
  assert(dia1.querySelector('.agItem.pedido') && dia1.textContent.includes('Pedido'), 'camada de pedidos no dia 01');
  assert(document.querySelector('#agGrade .agDia[data-dia="2026-09-27"]').classList.contains('fora'), 'dia de fora do mês apagado');
  assert(!/NaN|undefined/.test(document.getElementById('panel-agenda').textContent), 'sem NaN/undefined');
  // lista do celular: atrasados no topo
  assert(document.querySelector('#agLista .agListaDia') && document.getElementById('agLista').textContent.indexOf('A Teste') < document.getElementById('agLista').textContent.indexOf('B Teste'), 'lista do celular em ordem');

  // navegar
  document.getElementById('agMesProx').click(); await espera(30);
  eq(document.getElementById('agTituloMes').textContent, 'NOVEMBRO 2026', 'próximo mês');
  document.getElementById('agHoje').click(); await espera(30);
  eq(document.getElementById('agTituloMes').textContent, 'OUTUBRO 2026', 'volta para hoje');

  // painel do dia (a grade foi redesenhada ao navegar: buscar a célula de novo)
  document.querySelector('#agGrade .agDia[data-dia="2026-10-06"]').click(); await espera(30);
  const ov = document.getElementById('agDiaOverlay');
  assert(ov.classList.contains('active'), 'clicar no dia abre o painel');
  eq(document.getElementById('agDiaTitulo').textContent, 'Terça, 06/10', 'título do dia');
  eq(document.querySelectorAll('#agDiaLista .agLinha').length, 5, '5 retornos no painel (cancelado fora)');
  assert(document.querySelector('#agDiaLista .agLinha[data-id="r6"]').classList.contains('feito'), 'feito riscado');
  eq(document.getElementById('agFDia').value, '2026-10-06', 'formulário com o dia clicado');

  // criar
  document.getElementById('agFNome').value = 'Nova Empresa Teste';
  document.getElementById('agFTel').value = '(19) 99000-0002';
  document.querySelector('#agFHoras [data-hora="14:00"]').click();
  document.getElementById('agFTipo').value = 'whatsapp';
  document.getElementById('agFLinhas').value = '5';
  document.getElementById('agFValor').value = '450,00';
  document.getElementById('agFObs').value = 'mandar proposta';
  let mudou = 0; document.addEventListener('agenda:mudou', () => mudou++);
  document.getElementById('agForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await espera(40);
  const ins = window.__escritas.find(e => e.tabela === 'agenda_retornos' && e.op === 'insert');
  assert(ins, 'insert em agenda_retornos');
  eq([ins.rows.nome, ins.rows.quando, ins.rows.tipo, ins.rows.qtd_linhas, ins.rows.valor_plano, ins.rows.origem], ['Nova Empresa Teste', '2026-10-06T14:00:00-03:00', 'whatsapp', 5, 450, 'manual'], 'linha gravada');
  assert(!('consultor_id' in ins.rows), 'consultor_id fica com o default do banco');
  assert(mudou >= 1, 'evento agenda:mudou');
  assert(document.querySelector('#agGrade .agDia[data-dia="2026-10-06"]').textContent.includes('+3'), 'calendário atualizado sem recarregar (6 retornos)');
  // validação
  document.getElementById('agFNome').value = '';
  document.getElementById('agForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await espera(20);
  eq(document.getElementById('agFErro').textContent, 'Informe o nome do cliente.', 'erro de validação na tela');

  // feito / cancelar / remarcar
  document.querySelector('#agDiaLista .agLinha[data-id="r1"] [data-ag="feito"]').click(); await espera(30);
  assert(window.__escritas.some(e => e.tabela === 'agenda_retornos' && e.op === 'update' && e.patch.status === 'feito' && e.filtro.id === 'r1'), 'marcar feito');
  document.querySelector('#agDiaLista .agLinha[data-id="r5"] [data-ag="cancelar"]').click(); await espera(30);
  assert(window.__escritas.some(e => e.op === 'update' && e.patch.status === 'cancelado' && e.filtro.id === 'r5'), 'cancelar');
  document.querySelector('#agDiaLista .agLinha[data-id="r2"] [data-ag="remarcar"]').click(); await espera(20);
  const linhaR2 = document.querySelector('#agDiaLista .agLinha[data-id="r2"]');
  linhaR2.querySelector('input[type=date]').value = '2026-10-08';
  linhaR2.querySelector('input[type=time]').value = '10:30';
  linhaR2.querySelector('[data-ag="salvarRemarcar"]').click(); await espera(30);
  assert(window.__escritas.some(e => e.op === 'update' && e.patch.quando === '2026-10-08T10:30:00-03:00' && e.filtro.id === 'r2'), 'remarcar para outro dia e hora');
  fecharOverlay(ov);

  // arrastar para outro dia mantém a hora
  agSoltarEm('r4', '2026-10-09'); await espera(30);
  assert(window.__escritas.some(e => e.op === 'update' && e.patch.quando === '2026-10-09T22:30:00-03:00' && e.filtro.id === 'r4'), 'arrastar mantém a hora');

  // falha ao carregar não quebra
  const sbFromOriginal = sb.from;
  sb.from = (t) => t === 'agenda_retornos' ? { select: () => ({ gte: () => ({ lte: () => ({ neq: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }) }) } : sbFromOriginal(t);
  await agCarregarMes(); agRenderMes();
  assert(document.getElementById('agStatus').textContent.includes('Não foi possível carregar'), 'aviso de falha');
  sb.from = sbFromOriginal;
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
  fim();
`);
