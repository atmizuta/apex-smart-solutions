// Testa "Meus leads e retornos" (agenda de follow-up por consultor, dentro do painel) e "Falha
// comercial por consultor" (admin) — pedido do usuário: "os consultores estão se perdendo no
// controle da planilha nos retornos, follow ups, agendamentos... preciso que isso fique otimizado
// para cada vendedor e que eu possa identificar a falha comercial deles". Ver REGRAS_NEGOCIO.md §48.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__mockLeads = [];
window.__mockConfig = null;
window.__mockFollowups = [];
let __nextFollowupId = 1;

function mockQueryBuilder(table){
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    in: () => builder,
    gte: () => builder,
    lt: () => builder,
    range: () => builder,
    maybeSingle: async () => (table === 'config' ? { data: window.__mockConfig } : { data: null }),
    insert: (obj) => {
      const row = Object.assign({ id: 'f' + (__nextFollowupId++), feito: false, feito_em: null, criado_em: new Date().toISOString() }, obj);
      window.__mockFollowups.push(row);
      return Promise.resolve({ data: [row], error: null });
    },
    update: (patch) => ({
      eq: (col, val) => {
        const row = window.__mockFollowups.find(f => f[col] === val);
        if(row) Object.assign(row, patch);
        return Promise.resolve({ data: row ? [row] : [], error: null });
      },
    }),
    then: (resolve) => {
      if(table === 'leads') return resolve({ data: window.__mockLeads, error: null });
      if(table === 'leads_followups') return resolve({ data: window.__mockFollowups, error: null });
      return resolve({ data: [], error: null });
    },
  };
  return builder;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => mockQueryBuilder(table),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: async () => ({ data: { total: 0, ganho: 0, perdido: 0, andamento: 0, semPedido: 0, pedidosGanho: [], pedidosPerdido: [], pedidosAndamento: [] }, error: null }),
})) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;
window.Chart = function(ctx, cfg){ this.config = cfg; this.destroy = function(){}; return this; };

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  function lead(overrides){
    return Object.assign({ id: 'l0', consultor: 'Caio', full_name: 'Cliente X', phone_number: '11999990000', status: 'EM NEGOCIAÇÂO', categoria: 'andamento', converteu: false, receita: 0, criado_em_lead: '2026-09-01T10:00:00-03:00' }, overrides);
  }

  // --- normalizarNomeConsultor: tolerante a acento/maiúscula/espaço, pra casar o nome livre da
  // planilha com profiles.nome de quem está logado ---
  assert(normalizarNomeConsultor('  João Vitor  ') === normalizarNomeConsultor('JOAO VITOR'), 'normalizarNomeConsultor ignora espaço nas pontas, maiúscula e acento');
  assert(normalizarNomeConsultor('Caio') !== normalizarNomeConsultor('Giovanna'), 'nomes diferentes continuam diferentes depois de normalizados');

  // --- meusLeadsAtivos: só os leads cujo texto de CONSULTOR bate com quem está logado ---
  const todosLeads = [
    lead({ id: 'l1', consultor: 'Caio Silva' }),
    lead({ id: 'l2', consultor: 'caio silva' }), // mesma pessoa, grafia diferente na planilha
    lead({ id: 'l3', consultor: 'Giovanna' }),
  ];
  currentUser = { id: 'u1', nome: 'Caio Silva', username: 'caio', role: 'consultor' };
  const meus = meusLeadsAtivos(todosLeads);
  assert(meus.length === 2, 'meusLeadsAtivos pega os 2 leads do Caio, ignorando grafia (maiúscula/minúscula)');
  assert(meus.every(l => l.id !== 'l3'), 'lead da Giovanna não entra na lista do Caio');
  currentUser = { id: 'u9', nome: 'Ninguém Com Esse Nome', username: 'x', role: 'consultor' };
  assert(meusLeadsAtivos(todosLeads).length === 0, 'consultor sem nenhum lead no próprio nome não quebra, só devolve lista vazia');

  // --- fluxo completo dentro do painel (aba Digital, "Meus leads e retornos") ---
  currentUser = { id: 'u1', nome: 'Caio Silva', username: 'caio', role: 'consultor' };
  enterApp();
  window.__mockLeads = [
    lead({ id: 'lA', consultor: 'Caio Silva', full_name: 'Empresa A', status: 'sem contato' }), // sem nenhum followup -> "sem agenda"
    lead({ id: 'lB', consultor: 'Caio Silva', full_name: 'Empresa B', status: 'em negociação' }), // followup atrasado
    lead({ id: 'lC', consultor: 'Caio Silva', full_name: 'Empresa C', status: 'aguardando retorno' }), // followup futuro
  ];
  const ontem = somaDiasStr(hojeSP(), -3);
  const amanha = somaDiasStr(hojeSP(), 3);
  window.__mockFollowups = [
    { id: 'f1', lead_id: 'lB', consultor_id: 'u1', data_prevista: ontem, tipo: 'retorno', feito: false, observacao: null, criado_em: '2026-09-20T10:00:00-03:00' },
    { id: 'f2', lead_id: 'lC', consultor_id: 'u1', data_prevista: amanha, tipo: 'whatsapp', feito: false, observacao: null, criado_em: '2026-09-20T10:00:00-03:00' },
  ];
  await loadConversaoVendas();

  assert(document.getElementById('meusRetornosCard').style.display === 'block', 'card "Meus leads e retornos" aparece quando o consultor tem leads no próprio nome');
  const resumoTxt = document.getElementById('meusRetornosResumo').textContent;
  assert(resumoTxt.includes('1 atrasado'), 'resumo mostra 1 retorno atrasado (lead B)');
  assert(resumoTxt.includes('1 sem retorno agendado'), 'resumo mostra 1 lead sem retorno agendado (lead A)');
  assert(resumoTxt.includes('1 agendado'), 'resumo mostra 1 retorno futuro agendado (lead C)');
  const listaHtml = document.getElementById('meusRetornosLista').innerHTML;
  assert(listaHtml.indexOf('Empresa B') < listaHtml.indexOf('Empresa A') && listaHtml.indexOf('Empresa A') < listaHtml.indexOf('Empresa C'), 'ordem da lista: atrasado primeiro, depois sem agenda, depois futuro');
  assert(/retornoBadge atrasado/.test(listaHtml), 'lead atrasado usa o badge visual "atrasado"');
  assert(/Sem retorno agendado/.test(listaHtml), 'lead sem nenhum followup mostra "Sem retorno agendado"');

  // --- agendar um novo retorno pelo formulário inline (lead A, que não tinha nenhum) ---
  const btnAgendarA = document.querySelector('.btnAgendarRetorno[data-lead-id="lA"]');
  assert(!!btnAgendarA, 'botão "Agendar retorno" existe pro lead A');
  btnAgendarA.click();
  const formA = document.getElementById('retornoForm_lA');
  assert(formA.style.display !== 'none', 'clicar em "Agendar retorno" abre o formulário inline daquele lead');
  formA.querySelector('.retornoFormData').value = amanha;
  formA.querySelector('.retornoFormTipo').value = 'ligacao';
  formA.querySelector('.retornoFormObs').value = 'Vai decidir até sexta';
  formA.querySelector('.btnSalvarRetorno').click();
  await new Promise(r => setTimeout(r, 30));
  assert(window.__mockFollowups.some(f => f.lead_id === 'lA' && f.tipo === 'ligacao' && f.observacao === 'Vai decidir até sexta'), 'salvar o formulário grava um novo registro em leads_followups (insert)');
  assert(document.getElementById('meusRetornosResumo').textContent.includes('0 sem retorno agendado'), 'depois de agendar, o lead A sai de "sem retorno agendado"');

  // --- marcar o retorno atrasado do lead B como feito ---
  const btnFeitoB = document.querySelector('.btnRetornoFeito[data-followup-id="f1"]');
  assert(!!btnFeitoB, 'botão "Marcar feito" existe pro retorno atrasado do lead B');
  btnFeitoB.click();
  await new Promise(r => setTimeout(r, 30));
  const f1Atualizado = window.__mockFollowups.find(f => f.id === 'f1');
  assert(f1Atualizado.feito === true, 'marcar feito atualiza o registro (update feito=true) em leads_followups');
  assert(document.getElementById('meusRetornosResumo').textContent.includes('0 atrasado'), 'depois de marcar feito, o lead B some da contagem de atrasados (fica "sem agenda" até um novo retorno ser marcado)');

  // --- falha comercial por consultor: só admin/supervisor ---
  currentUser = { id: 'u1', nome: 'Caio Silva', username: 'caio', role: 'consultor' };
  enterApp();
  await loadConversaoVendas();
  assert(document.getElementById('falhaComercialCard').style.display === 'none', 'consultor não vê o card de falha comercial (é visão de gestão)');

  currentUser = { id: 'u9', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  enterApp();
  window.__mockLeads = [
    lead({ id: 'gA', consultor: 'Giovanna', categoria: 'andamento', criado_em_lead: '2026-01-01T10:00:00-03:00' }), // sem followup, muito antigo -> esfriando + sem contato
    lead({ id: 'gB', consultor: 'Giovanna', categoria: 'convertido', converteu: true }),
    lead({ id: 'hA', consultor: 'Helena', categoria: 'andamento' }),
  ];
  window.__mockFollowups = [
    { id: 'f9', lead_id: 'hA', consultor_id: 'u9', data_prevista: hojeSP(), tipo: 'retorno', feito: false, observacao: null, criado_em: new Date().toISOString() },
  ];
  await loadConversaoVendas();
  assert(document.getElementById('falhaComercialCard').style.display === 'block', 'admin vê o card de falha comercial');
  const falhaHtml = document.getElementById('falhaComercialTbody').innerHTML;
  assert(/Giovanna/.test(falhaHtml) && /Helena/.test(falhaHtml), 'tabela de falha comercial lista os consultores com leads no período');
  const linhaGiovanna = falhaHtml.split('<tr>').find(l => l.includes('Giovanna'));
  assert(/falhaBadge">1</.test(linhaGiovanna), 'Giovanna aparece com 1 lead sem contato e 1 esfriando (mesmo lead: sem followup, categoria andamento, bem antigo)');
  const linhaHelena = falhaHtml.split('<tr>').find(l => l.includes('Helena'));
  assert(!/falhaBadge/.test(linhaHelena.split('</td>')[1]), 'Helena não aparece "sem contato" — o único lead dela já tem um followup registrado (mesmo pendente)');

  console.log('--- RESULTADO: ' + ok + ' passaram, ' + fail + ' falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e && e.stack || e);
  window.__testResult = 'FAIL';
}
})();
`;

// jsCode e testScript precisam rodar num ÚNICO eval() — dois eval() separados criam ambientes de
// escopo distintos pra `let`/`const` de topo do jsCode (bug de jsdom/Node vm confirmado na prática:
// uma reatribuição de `currentUser` no segundo eval não é enxergada pelas funções definidas no
// primeiro), mesmo declarando `currentUser` sem `let`/`const` no segundo. Mesmo padrão de todos os
// outros arquivos test_*.js deste projeto (ver, por exemplo, o final de test_conversao_vendas.js).
window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 500);
