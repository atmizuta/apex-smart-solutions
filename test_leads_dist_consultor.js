// Testa a §146.2 (consultor: aviso de lead recebido, faixa Sua vez, Pausa, cronômetro). DADOS FICTÍCIOS (repo público).
const { montarPainel } = require('./painel_teste_base.js');
const { rodar } = montarPainel();
rodar(`
  const chamadas = (nome) => window.__rpcCalls.filter(c => c.nome === nome);
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  kbEstado.naEquipe = true;
  const T0 = Date.parse('2026-11-12T15:00:00-03:00');
  const ENT = { aba: 'NOVEMBRO', lead_id: 'L1', nome: 'Lead Teste', tipo: 'auto', recebido_em: new Date(T0).toISOString(), prazo_atender_min: 5, prazo_devolver_min: 15 };

  // ==== cronômetro ====
  eq(kbCronometro(ENT, T0 + 72000), { texto: '3:48 para ligar', classe: 'ok' }, '1 min 12 s depois');
  eq(kbCronometro(ENT, T0 + 4 * 60000).classe, 'soon', 'último minuto fica âmbar');
  eq(kbCronometro(ENT, T0 + 7 * 60000), { texto: 'atrasado 2 min · volta aos Livres em 8 min', classe: 'late' }, 'atrasado');

  // ==== faixa ====
  eq(kbSuaVezHtml(null, null, T0), '', 'sem dados: nada');
  eq(kbSuaVezHtml({ grupo: false, modo: 'automatico' }, null, T0), '', 'fora do grupo: nada');
  const MEU = { grupo: true, modo: 'automatico', estado: 'pendente', pausa_ate: null, rapidos_ok: 7, rapidos_n: 10, conv: 0.172, fatia: 0.26, recebidos_hoje: 3, alvo_hoje: 5, entrega: ENT };
  let h = kbSuaVezHtml(MEU, ENT, T0 + 72000);
  assert(h.includes('Aguardando você ligar') && h.includes('Rápidos: 7 de 10') && h.includes('Conversão 14 dias: 17%') && h.includes('Hoje: 3 de ~5'), 'automático: estado e números');
  assert(h.includes('Lead Teste') && h.includes('3:48 para ligar') && h.includes('data-kb-suavez-abrir'), 'lead recebido com cronômetro e Abrir');
  assert(h.includes('data-kb-suavez-pausa') && h.includes('>Pausa<'), 'botão Pausa');
  h = kbSuaVezHtml(Object.assign({}, MEU, { estado: 'pausa', pausa_ate: '2026-11-12T16:00:00-03:00', entrega: null }), null, T0);
  assert(h.includes('Em pausa') && h.includes('Voltar') && h.includes('16:00'), 'em pausa mostra Voltar e até quando');
  h = kbSuaVezHtml(Object.assign({}, MEU, { modo: 'sombra' }), ENT, T0);
  assert(h.includes('Rápidos: 7 de 10') && !h.includes('Hoje:') && !h.includes('data-kb-suavez-pausa') && !h.includes('para ligar'), 'sombra: só os números');
  const ENT_X = Object.assign({}, ENT, { nome: '<img src=x>' });
  assert(!kbSuaVezHtml(MEU, ENT_X, T0).includes('<img'), 'nome do lead escapado');

  // ==== aviso de lead recebido (uma vez só) e "voltou aos Livres" ====
  const avisosAntes = window.__alertas.length;
  window.__rpcCalls.length = 0;
  kbDistAvisoEntrega(ENT, T0 + 5000);
  kbDistAvisoEntrega(ENT, T0 + 25000);
  await espera();
  assert(avisos().includes('Lead novo para você: Lead Teste'), 'toast do lead recebido');
  eq(window.__notificacoes.filter(n => /Lead Teste/.test(n.opts && n.opts.body || '')).length, 1, 'notifica uma vez só');
  kbDistAvisoEntrega(null, T0 + 2 * 60000);   // ligou logo: some sem aviso de devolução
  assert(!avisos().includes('voltou aos Livres'), 'atendido não avisa devolução');
  const ENT2 = Object.assign({}, ENT, { lead_id: 'L2', nome: 'Outro Teste' });
  kbDistAvisoEntrega(ENT2, T0);
  kbDistAvisoEntrega(null, T0 + 16 * 60000);   // sumiu depois do prazo de devolução
  assert(!avisos().includes('Outro Teste voltou aos Livres'), 'sumir da faixa depois de 15 min não avisa (pode ter sido segurado pelo ProContact)');
  // §146.5: o aviso vem do banco (presença devolve "devolvida"), uma vez por lead
  const DEV = { aba: 'NOVEMBRO', lead_id: 'L2', nome: 'Outro Teste', devolvido_em: new Date(T0 + 16 * 60000).toISOString() };
  kbDistAvisoDevolvida(DEV); kbDistAvisoDevolvida(DEV);
  eq(window.__alertas.concat([(document.getElementById('apexToasts') || {}).textContent || '']).join(' | ').split('Outro Teste voltou aos Livres').length - 1 >= 1, true, 'avisa devolução vinda do banco');
  window.__rpcRespostas.leads_presenca_ping = { data: { equipe: true, pausa_ate: null, modo: 'automatico', entrega: null, devolvida: { aba: 'NOVEMBRO', lead_id: 'L7', nome: 'Sétimo Teste', devolvido_em: new Date().toISOString() } }, error: null };
  await kbPresencaPing();
  assert(avisos().includes('Sétimo Teste voltou aos Livres'), 'presença com devolvida avisa');
  const nSetimo = avisos().split('Sétimo Teste voltou aos Livres').length;
  await kbPresencaPing();
  eq(avisos().split('Sétimo Teste voltou aos Livres').length, nSetimo, 'devolvida avisa uma vez só');
  eq(kbCronometro(ENT, T0 + 17 * 60000), { texto: 'atrasado 12 min · aguardando o ProContact', classe: 'late' }, 'passou dos 15 min: espera o robô');

  // ==== presença a cada 20 s alimenta o aviso ====
  window.__rpcRespostas.leads_presenca_ping = { data: { equipe: true, pausa_ate: null, modo: 'automatico', entrega: Object.assign({}, ENT, { lead_id: 'L3', nome: 'Terceiro Teste' }) }, error: null };
  await kbPresencaPing();
  assert(avisos().includes('Terceiro Teste'), 'ping com entrega nova avisa');
  kbAgendar();
  assert(kbEstado.timerPresencaMs === 20000, 'presença a cada 20 s');
  kbParar();

  // ==== revisão: F5 não repete o aviso; outro usuário na mesma aba é avisado (I-2) ====
  const ENT4 = Object.assign({}, ENT, { lead_id: 'L4', nome: 'Quarto Teste' });
  kbDistAvisoEntrega(ENT4, T0);
  const nAntes = window.__notificacoes.filter(n => /Quarto Teste/.test(n.opts && n.opts.body || '')).length;
  kbEstado.distAvisadas = new Set(); kbEstado.distEntrega = null;   // simula o F5 (memória zerada)
  kbDistAvisoEntrega(ENT4, T0 + 20000);
  eq(window.__notificacoes.filter(n => /Quarto Teste/.test(n.opts && n.opts.body || '')).length, nAntes, 'F5 não repete o aviso do mesmo lead');
  currentUser = { id: 'c2', nome: 'Outra Consultora', username: 'cons2', role: 'consultor' };
  kbEstado.distEntrega = null;
  kbDistAvisoEntrega(ENT4, T0 + 40000);
  eq(window.__notificacoes.filter(n => /Quarto Teste/.test(n.opts && n.opts.body || '')).length, nAntes + 1, 'outro usuário na mesma aba é avisado');
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  // ==== revisão: quando a entrega muda, a faixa recarrega o estado (Minor 2 → Important) ====
  await espera(50);   // deixa terminar as recargas disparadas pelos passos anteriores
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.leads_dist_meu = { data: Object.assign({}, MEU, { estado: 'na_vez', entrega: null }), error: null };
  kbEstado.distEntrega = ENT4;
  kbDistAvisoEntrega(null, T0 + 60000);
  await espera();
  eq(chamadas('leads_dist_meu').length, 1, 'entrega mudou: recarrega o estado da faixa');
  // ==== revisão: sair limpa a faixa (Minor 5 → Important) ====
  kbEstado.distMeu = MEU; kbEstado.distEntrega = ENT; kbRenderSuaVez();
  assert(document.getElementById('kbSuaVez').innerHTML.includes('Lead Teste'), 'faixa com o lead antes de sair');
  kbParar();
  assert(document.getElementById('kbSuaVez').innerHTML === '' && document.getElementById('kbSuaVez').hidden, 'sair limpa a faixa');
  kbEstado.naEquipe = true;

  // ==== Pausa / Voltar ====
  window.__rpcCalls.length = 0;
  kbEstado.distMeu = Object.assign({}, MEU, { estado: 'na_vez', entrega: null });
  window.__rpcRespostas.leads_dist_meu = { data: Object.assign({}, MEU, { estado: 'pausa', pausa_ate: '2026-11-12T16:00:00-03:00' }), error: null };
  kbEstado.naEquipe = true;
  await kbSuaVezPausa();
  eq(chamadas('leads_presenca_ping').map(c => c.args), [{ p_acao: 'pausa' }], 'na vez → pausa');
  window.__rpcCalls.length = 0;
  await kbSuaVezPausa();
  eq(chamadas('leads_presenca_ping').map(c => c.args), [{ p_acao: 'voltar' }], 'em pausa → voltar');
  fim();
`);
