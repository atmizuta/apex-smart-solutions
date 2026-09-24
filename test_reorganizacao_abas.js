const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__lastSelectCols = null;
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => ({
    select: (cols) => {
      if(table === 'producao_pedidos') window.__lastSelectCols = cols;
      return {
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
        maybeSingle: async () => ({ data: null }),
        order: () => ({ then: () => {} }),
        then: (resolve) => resolve({ data: [], error: null }),
      };
    },
  }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;

const testScript = `
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // --- 1) o card de upload de produção NÃO existe mais dentro do painel Dashboard de Produção ---
  assert(document.getElementById('producaoUploadCard') === null, 'card producaoUploadCard não existe mais (removido do painel-producao)');
  assert(document.querySelector('#panel-producao #producaoUpload') === null, 'input de upload de produção não está mais dentro de panel-producao');

  // --- 2) o input de upload de produção agora vive dentro da aba "Atualização de Bases" (movimentacao) ---
  assert(document.querySelector('#panel-movimentacao #producaoUpload') !== null, 'input de upload de produção está dentro de panel-movimentacao');

  // --- 3) o botão de navegação foi renomeado (26/08/2026: "Atualização de Bases" -> "Upload Dash") ---
  const btnMov = document.getElementById('tabBtnMovimentacao');
  assert(btnMov.textContent.trim() === 'Upload Dash', 'botão de navegação renomeado pra "Upload Dash" (atual: "' + btnMov.textContent.trim() + '")');

  // --- 4) o botão da aba de produção continua existindo e visível a qualquer perfil ---
  const btnProducao = document.getElementById('tabBtnProducao');
  assert(btnProducao !== null, 'botão da aba Dashboard de Produção existe');
  assert(btnProducao.style.display !== 'none', 'botão da aba Dashboard de Produção não está escondido por padrão');

  // --- 5) mensagem de estado vazio muda conforme o perfil (admin vê onde subir, os outros veem "peça a um admin") ---
  currentUser = { id: 'u1', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  await loadProducaoDashboard();
  let msg = document.getElementById('producaoEmptyMsg').textContent;
  assert(msg.includes('Upload Dash'), 'admin vê mensagem apontando pra "Upload Dash" (' + msg + ')');
  assert(window.__lastSelectCols.includes('cliente') && window.__lastSelectCols.includes('cnpj'), 'admin busca as colunas cliente/cnpj do Supabase');

  currentUser = { id: 'u2', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  await loadProducaoDashboard();
  msg = document.getElementById('producaoEmptyMsg').textContent;
  assert(msg.includes('administrador'), 'consultor vê mensagem pedindo pra um administrador atualizar (' + msg + ')');
  assert(!window.__lastSelectCols.includes('cliente') && !window.__lastSelectCols.includes('cnpj'), 'consultor NÃO busca as colunas cliente/cnpj do Supabase');

  // --- 6) enterApp() abre direto no Dashboard de Produção (página inicial pós-login) ---
  currentUser = { id: 'u1', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  enterApp();
  assert(document.getElementById('panel-producao').classList.contains('active'), 'depois do login, panel-producao fica com a classe "active"');
  assert(!document.getElementById('panel-busca').classList.contains('active'), 'depois do login, panel-busca NÃO fica ativo por padrão');
  assert(document.getElementById('tabBtnProducao').classList.contains('active'), 'depois do login, o botão da aba Dashboard de Produção fica marcado como ativo');

  // --- 7) main fica mais largo (classe "mainWide") só na aba Dashboard de Produção ---
  assert(document.getElementById('appMain').classList.contains('mainWide'), 'depois do login (que já abre em Dashboard de Produção), main tem a classe mainWide');
  document.querySelector('#tabsNav button[data-tab="busca"]').click();
  assert(!document.getElementById('appMain').classList.contains('mainWide'), 'ao trocar pra aba Buscar Clientes, main perde a classe mainWide (volta à largura padrão)');
  document.querySelector('#tabsNav button[data-tab="producao"]').click();
  assert(document.getElementById('appMain').classList.contains('mainWide'), 'ao voltar pra aba Dashboard de Produção, main ganha a classe mainWide de novo');

  // --- 8) ordem e rótulos das abas no menu principal (26/08/2026) ---
  const botoes = Array.from(document.querySelectorAll('#tabsNav button[data-tab]'));
  // NOTA (18/09/2026): lista atualizada pra incluir "biometria" (10/09/2026) e "fechamento"
  // (18/09/2026), abas adicionadas depois desse teste original de 26/08/2026 — ambas ficaram de
  // fora da lista por um tempo (teste desatualizado, não regressão) até essa correção.
  const ordemEsperada = ['producao','conversao','busca','cobertura','proposta','funil','biometria','basedados','movimentacao','consultores','fechamento'];
  assert(botoes.map(b => b.dataset.tab).join(',') === ordemEsperada.join(','), 'ordem das abas no menu segue: ' + ordemEsperada.join(', ') + ' (atual: ' + botoes.map(b => b.dataset.tab).join(',') + ')');
  const rotulos = { producao: 'Dashboard', conversao: 'Digital', busca: 'Buscar Clientes', cobertura: 'Cobertura', proposta: 'Gerar Proposta', funil: 'Funil', basedados: 'Upload Base', movimentacao: 'Upload Dash', consultores: 'Usuários' };
  Object.entries(rotulos).forEach(([tab, rotulo]) => {
    const btn = document.querySelector('#tabsNav button[data-tab="' + tab + '"]');
    assert(btn.textContent.trim() === rotulo, 'aba "' + tab + '" mostra o rótulo "' + rotulo + '" (atual: "' + btn.textContent.trim() + '")');
    assert(btn.querySelector('svg') !== null, 'aba "' + tab + '" tem um ícone (svg) ao lado do texto');
  });

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
`;

(async () => {
  await window.eval('(async () => {' + jsCode + testScript + '})()');
  setTimeout(() => {
    if(window.__testResult !== 'OK') process.exitCode = 1;
  }, 500);
})();
