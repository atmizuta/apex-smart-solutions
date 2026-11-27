// test_monitor_modo.js (26/11/2026, §168): Claro Monitor escolhido na proposta — 'todas' (padrão,
// igual ao §145), 'nenhuma' (preço do book, sem selo) ou 'selecionadas' (qtdMonitor por grupo).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = () => {};
window.confirm = () => true;

const testScript = `
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  const perto = (a, b) => Math.abs(a - b) < 0.005;

  const cliente = { razao_social: 'CLIENTE MONITOR TESTE', cnpj: '', cidade: 'São Paulo', ddd: '11',
    linhas_voz: 10, valor_contrato: 900, arpu: 90, cep_cabeado: '' };
  const renov = OFFERS_MOBILE.find(o => o.id === 'p57-100');
  const inc = OFFERS_MOBILE.find(o => o.id === 'p44-20');

  function cenario(modo, qtdMonRenov, qtdMonInc){
    openProposal(cliente, {});
    proposalState.monitorModo = modo;
    proposalState.renewGrupos = [{ qtd: 10, offerId: renov.id, qtdMonitor: qtdMonRenov }];
    proposalState.incluirIncremento = true;
    proposalState.incrementos = [{ offerId: inc.id, qtd: 3, qtdMonitor: qtdMonInc }];
    return computeProposal();
  }
  const temSelo = () => buildPropostaDocModel().beneficios.badges.some(b => b.label === 'Claro Monitor');
  const cheio = 10 * renov.valor + 3 * inc.valor;

  // (a) padrão: nasce 'todas' e o total é o de hoje (§145)
  openProposal(cliente, {});
  assert(proposalState.monitorModo === 'todas', 'padrão é todas');
  let r = cenario('todas');
  assert(perto(r.novoTotal, cheio), 'todas: total igual ao §145 (' + r.novoTotal + ')');
  assert(temSelo(), 'todas: selo do Monitor no documento');

  // (b) nenhuma: R$5 a menos por linha e sem selo
  r = cenario('nenhuma');
  assert(perto(r.novoTotal, cheio - 13 * CLARO_MONITOR_INCLUSO), 'nenhuma: −R$5 em 13 linhas (' + r.novoTotal + ')');
  assert(!temSelo(), 'nenhuma: sem selo do Monitor');

  // (c) selecionadas: 4 de 10 na renovação, 0 de 3 no incremento
  r = cenario('selecionadas', 4, 0);
  assert(perto(r.novoTotal, cheio - 9 * CLARO_MONITOR_INCLUSO), 'selecionadas: −R$5 nas 9 sem Monitor (' + r.novoTotal + ')');
  assert(r.baseGrupos.length === 2 && r.baseGrupos[0].qtd === 4 && r.baseGrupos[1].qtd === 6, 'selecionadas: grupo dividido 4 + 6');
  const descs = buildPropostaDocModel().novaProposta.itens.map(it => it.desc);
  assert(descs.includes('4× 100GB + Claro Monitor — ' + fmtBRL(renov.valor) + '/linha'), 'doc: linha com Monitor (' + descs.join(' | ') + ')');
  assert(descs.includes('6× 100GB — ' + fmtBRL(renov.valor - 5) + '/linha'), 'doc: linha sem Monitor pelo preço do book');
  assert(temSelo(), 'selecionadas com alguma linha: selo aparece');

  // (d) selecionadas sem qtdMonitor = todas as linhas do grupo; qtdMonitor acima da qtd é limitado
  r = cenario('selecionadas', undefined, 99);
  assert(perto(r.novoTotal, cheio), 'selecionadas sem número / acima do grupo: conta todas');

  // (e) selecionadas com zero em tudo: sem selo
  cenario('selecionadas', 0, 0);
  assert(!temSelo(), 'selecionadas com 0: sem selo');

  // (f) tela: "Com Monitor" só aparece em 'selecionadas'
  cenario('todas'); renderProposalBody();
  assert(document.querySelectorAll('.propMonitorQtd').length === 0, 'tela todas: sem campo Com Monitor');
  const sel = document.getElementById('propMonitorModo');
  sel.value = 'selecionadas'; sel.dispatchEvent(new window.Event('change'));
  assert(proposalState.monitorModo === 'selecionadas', 'select grava o modo');
  const campos = document.querySelectorAll('.propMonitorQtd');
  assert(campos.length === 2, 'tela selecionadas: 1 campo por grupo (renovação + incremento), achou ' + campos.length);
  campos[0].value = '2'; campos[0].dispatchEvent(new window.Event('input'));
  assert(proposalState.renewGrupos[0].qtdMonitor === 2, 'campo grava qtdMonitor no grupo');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
`;

window.eval(scriptMatch[1] + testScript);
setTimeout(() => { if(window.__testResult !== 'OK') process.exitCode = 1; }, 2000);
