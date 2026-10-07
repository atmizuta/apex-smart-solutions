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

  // ==== FIX round 1 (revisão): troca de mês não deixa resposta atrasada sobrescrever a mais recente ====
  const sbFromOriginalRace = sb.from;
  let agChamadasRace = 0;
  sb.from = (t) => {
    const real = sbFromOriginalRace(t);
    if(t !== 'agenda_retornos') return real;
    agChamadasRace++;
    if(agChamadasRace === 1){
      const thenOriginal = real.then.bind(real);
      real.then = (ok, ko) => new Promise(r => setTimeout(r, 60)).then(() => thenOriginal(ok, ko));
    }
    return real;
  };
  document.getElementById('agMesProx').click(); // 1ª chamada (novembro, vazio): fica lenta (60ms)
  document.getElementById('agMesAnt').click(); // 2ª chamada (outubro, de volta): rápida, deve vencer
  await espera(100); // espera as duas respostas, inclusive a lenta
  eq(document.getElementById('agTituloMes').textContent, 'OUTUBRO 2026', 'corrida: título fica no mês pedido por último');
  assert(document.getElementById('agGrade').textContent.includes('Nova Empresa Teste'), 'corrida: resposta atrasada do mês anterior (vazia) não apaga os retornos de outubro já carregados');
  sb.from = sbFromOriginalRace;

  // ==== FIX round 1 (revisão): soltar não deixa o destaque .soltar aceso ====
  const diaR4 = document.querySelector('#agGrade .agDia[data-dia="2026-10-09"]');
  diaR4.classList.add('soltar');
  agEstado.arrastando = 'r4';
  diaR4.dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true }));
  await espera(20);
  assert(!document.querySelector('#agGrade .agDia.soltar'), 'soltar no mesmo dia (sem mudar nada) não deixa o destaque .soltar aceso');

  const diaQualquer = document.querySelector('#agGrade .agDia[data-dia="2026-10-10"]');
  diaQualquer.classList.add('soltar');
  agEstado.arrastando = 'r4';
  diaQualquer.dispatchEvent(new window.Event('dragend', { bubbles: true, cancelable: true }));
  assert(!document.querySelector('#agGrade .agDia.soltar') && agEstado.arrastando === null, 'dragend limpa o destaque .soltar e agEstado.arrastando');

  // falha ao carregar não quebra
  const sbFromOriginal = sb.from;
  // (revisão final I-2: a consulta ganhou .eq('consultor_id', …) logo depois do select)
  sb.from = (t) => t === 'agenda_retornos' ? { select: () => ({ eq: () => ({ gte: () => ({ lte: () => ({ neq: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }) }) }) } : sbFromOriginal(t);
  await agCarregarMes(); agRenderMes();
  assert(document.getElementById('agStatus').textContent.includes('Não foi possível carregar'), 'aviso de falha');
  sb.from = sbFromOriginal;
  Date.now = nowReal;

  // ==== TASK 10: alertas ====
  const A0 = sp('2026-10-06T13:56:00');
  const prox = [
    { id: 'a1', status: 'pendente', quando: '2026-10-06T14:00:00-03:00', nome: 'Alerta Teste', telefone: '19990000001' },
    { id: 'a2', status: 'pendente', quando: '2026-10-06T14:10:00-03:00', nome: 'Depois Teste' },
    { id: 'a3', status: 'feito', quando: '2026-10-06T13:58:00-03:00', nome: 'Feito Teste' },
    { id: 'a4', status: 'pendente', quando: '2026-10-06T11:00:00-03:00', nome: 'Velho Teste' },
  ];
  eq(alDevemAlertar(prox, A0, new Set()).map(r => r.id), ['a1'], 'só o que vence em até 5 min (não feito, não velho de 1h+)');
  eq(alDevemAlertar(prox, A0, new Set(['a1'])).length, 0, 'já alertado não repete');
  Date.now = () => A0;
  window.__tabelas.agenda_retornos = prox.map(r => Object.assign({ consultor_id: 'c1' }, r));
  try{ localStorage.removeItem('agenda_alertados_c1'); }catch(_e){}
  document.title = 'Painel Apex';
  await alCarregarProximos();
  alVerificar();
  eq(window.__notificacoes.length, 1, 'uma notificação');
  assert(window.__notificacoes[0].titulo.includes('14:00') && window.__notificacoes[0].titulo.includes('Alerta Teste'), 'texto da notificação');
  assert(document.title.startsWith('(2) '), 'contador no título (a1 em 4 min + a4 atrasado)');
  alVerificar();
  eq(window.__notificacoes.length, 1, 'não repete na mesma aba');
  // outra aba já alertou a2 (mensagem do BroadcastChannel)
  alReceber({ data: { alertado: 'a2' } });
  Date.now = () => sp('2026-10-06T14:06:00');
  alVerificar();
  eq(window.__notificacoes.length, 1, 'a2 alertado em outra aba: não toca aqui');
  // clicar na notificação abre o Caderno
  let aberto = null;
  const cdAbrirOriginal = cdAbrirDoRetorno;
  cdAbrirDoRetorno = (r) => { aberto = r.id; };
  alAoClicar(prox[0]);
  eq(aberto, 'a1', 'clique abre o Caderno do cliente');
  cdAbrirDoRetorno = cdAbrirOriginal;
  // resumo ao entrar
  Date.now = () => sp('2026-10-06T08:00:00');
  window.__tabelas.agenda_retornos = [{ id: 'h1', consultor_id: 'c1', status: 'pendente', quando: '2026-10-06T09:00:00-03:00', nome: 'H Teste' }, { id: 'h2', consultor_id: 'c1', status: 'pendente', quando: '2026-10-05T16:00:00-03:00', nome: 'Atr Teste' }];
  await alResumoAoEntrar();
  assert(avisos().includes('Hoje: 1 retorno · 1 atrasado'), 'resumo ao entrar');
  // permissão: aviso aparece quando ainda não foi dada
  window.Notification.permission = 'default';
  alAtualizarAvisoPermissao();
  assert(document.getElementById('agAlertasAviso').style.display !== 'none', 'pede para ativar alertas');
  window.Notification.permission = 'granted';
  alAtualizarAvisoPermissao();
  assert(document.getElementById('agAlertasAviso').style.display === 'none', 'some depois de ativar');
  alParar();
  Date.now = nowReal;

  // ==== REVISÃO FINAL I-2: supervisor/admin só vê e alerta os PRÓPRIOS retornos; escrita que o RLS
  // ignora (0 linhas) é erro, não sucesso ====
  Date.now = () => AGORA;
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  window.__tabelas.agenda_retornos = [
    { id: 'sv1', consultor_id: 'c1', nome: 'Do Consultor Teste', telefone: '19990000001', tipo: 'ligacao', status: 'pendente', quando: '2026-10-06T10:03:00-03:00' },
    { id: 'sv2', consultor_id: 's1', nome: 'Do Supervisor Teste', telefone: '19990000002', tipo: 'ligacao', status: 'pendente', quando: '2026-10-06T10:04:00-03:00' },
  ];
  agEstado.ym = '2026-10';
  await agCarregarMes();
  eq(agEstado.retornos.map(r => r.id), ['sv2'], 'I-2: a Agenda do supervisor traz só os retornos dele');
  await alCarregarProximos();
  eq(alEstado.proximos.map(r => r.id), ['sv2'], 'I-2: alertas do supervisor só dos retornos dele');
  const notifAntesI2 = window.__notificacoes.length;
  try{ localStorage.removeItem('agenda_alertados_s1'); }catch(_e){}
  alVerificar();
  assert(window.__notificacoes.slice(notifAntesI2).every(n => !n.titulo.includes('Do Consultor Teste')), 'I-2: nenhuma notificação do retorno de outro consultor');
  alParar();
  // retorno que o RLS não deixa alterar (0 linhas): aviso de erro, nada muda na tela
  agEstado.retornos.push({ id: 'alheio', consultor_id: 'c1', nome: 'Alheio Teste', status: 'pendente', quando: '2026-10-06T15:00:00-03:00' });
  window.__alertas.length = 0;
  const okFeitoI2 = await agMarcarFeito('alheio');
  assert(okFeitoI2 === false && agEstado.retornos.find(x => x.id === 'alheio').status === 'pendente', 'I-2: Feito que não atualizou nenhuma linha não muda o estado local');
  assert(avisos().includes('Não foi possível atualizar o retorno') && !avisos().includes('Retorno marcado como feito'), 'I-2: avisa erro em vez de sucesso');
  const okCancI2 = await agCancelar('alheio');
  assert(okCancI2 === false && agEstado.retornos.some(x => x.id === 'alheio'), 'I-2: Cancelar sem linha atualizada não some da tela');
  const okRemI2 = await agRemarcar('alheio', '2026-10-09', '10:00');
  assert(okRemI2 === false && agEstado.retornos.find(x => x.id === 'alheio').quando === '2026-10-06T15:00:00-03:00', 'I-2: Remarcar sem linha atualizada não move o retorno');
  const updI2 = window.__escritas.filter(e => e.tabela === 'agenda_retornos' && e.op === 'update').pop();
  eq(updI2.filtro, { id: 'alheio' }, 'I-2: update continua filtrando pelo id');
  // o próprio retorno atualiza normalmente
  assert(await agMarcarFeito('sv2'), 'I-2: o supervisor marca o próprio retorno como feito');
  eq(agEstado.retornos.find(x => x.id === 'sv2').status, 'feito', 'I-2: estado local atualizado com sucesso');

  // ==== REVISÃO FINAL M-9: na lista do celular, cada linha abre o próprio dia (inclusive "Atrasados") ====
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  window.__tabelas.agenda_retornos = [{ id: 'm9', consultor_id: 'c1', nome: 'Atrasado Teste', telefone: '19990000001', tipo: 'ligacao', status: 'pendente', quando: '2026-10-02T09:00:00-03:00' }];
  agEstado.ym = '2026-10';
  await agCarregarMes(); agRenderMes();
  const linhaM9 = document.querySelector('#agLista .agLinha[data-id="m9"]');
  assert(linhaM9 && document.getElementById('agLista').textContent.includes('Atrasados'), 'M-9 pré: atrasado na lista do celular');
  linhaM9.click(); await espera(10);
  eq(agEstado.diaAberto, '2026-10-02', 'M-9: tocar na linha atrasada abre o dia dela');
  assert(document.getElementById('agDiaOverlay').classList.contains('active'), 'M-9: painel do dia aberto');
  agEstado.diaAberto = null; fecharOverlay(document.getElementById('agDiaOverlay'));

  // ==== REVISÃO FINAL M-6: resposta atrasada do usuário anterior e clique em notificação antiga ====
  // (a) resposta de alCarregarProximos que chega depois de trocar de usuário é descartada
  const fromM6 = sb.from;
  sb.from = (t) => {
    const b = fromM6(t);
    if(t === 'agenda_retornos'){ const th = b.then; b.then = (ok, ko) => new Promise(r => setTimeout(r, 50)).then(() => th(ok, ko)); }
    return b;
  };
  window.__tabelas.agenda_retornos = [{ id: 'm6', consultor_id: 'c1', nome: 'Velho Usuario Teste', status: 'pendente', quando: '2026-10-06T10:02:00-03:00' }];
  const pM6 = alCarregarProximos();
  alParar();
  currentUser = { id: 'c2', nome: 'Outro Consultor', username: 'cons2', role: 'consultor' };
  await pM6; await espera(10);
  sb.from = fromM6;
  eq(alEstado.proximos.map(r => r.id), [], 'M-6: resposta atrasada do usuário anterior não entra na lista do novo');
  // (b) clicar numa notificação do usuário anterior não abre o cliente dele
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  try{ localStorage.removeItem('agenda_alertados_c1'); }catch(_e){}
  alCarregarAlertados();
  alEstado.proximos = [{ id: 'm6b', status: 'pendente', quando: '2026-10-06T10:02:00-03:00', nome: 'Cliente Do C1 Teste', telefone: '19990000001' }];
  alVerificar();
  const notM6 = window.__notificacoes.filter(n => n.titulo.includes('Cliente Do C1 Teste')).pop();
  assert(notM6 && typeof notM6.inst.onclick === 'function', 'M-6 pré: notificação criada');
  let abertoM6 = null;
  const cdAbrirOrigM6 = cdAbrirDoRetorno;
  cdAbrirDoRetorno = (r) => { abertoM6 = r.id; };
  currentUser = { id: 'c2', nome: 'Outro Consultor', username: 'cons2', role: 'consultor' };
  notM6.inst.onclick();
  eq(abertoM6, null, 'M-6: notificação do usuário anterior não abre o cliente dele');
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  notM6.inst.onclick();
  eq(abertoM6, 'm6b', 'M-6: a do próprio usuário continua abrindo');
  cdAbrirDoRetorno = cdAbrirOrigM6;
  alParar();
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
  fim();
`);
