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

  // ==== mais testes entram aqui ====
  fim();
`);
