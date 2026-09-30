// Faixa de aviso "sincronização da produção parada" (30/09/2026). Aparece no topo para admin e supervisor
// quando existe um alerta aberto em producao_sync_alerta (aberto pela Edge Function alerta-sync-producao).
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

window.__alerta = null;      // linha devolvida pela consulta (ou null = sem alerta aberto)
window.__alertaErro = false; // simula falha na consulta
window.__consultas = 0;      // quantas vezes producao_sync_alerta foi consultada
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => ({
    select: () => {
      const b = {
        eq: () => b, is: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => {
          if(table === 'producao_sync_alerta'){
            window.__consultas++;
            if(window.__alertaErro) throw new Error('boom: sem permissão');
            return { data: window.__alerta, error: null };
          }
          return { data: null, error: null };
        },
        range: () => ({ then: (resolve) => resolve({ data: [], error: null }) }),
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return b;
    },
  }),
  functions: { invoke: async () => ({data:{},error:null}) },
})) };

const testScript = `
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  const banner = () => document.getElementById('syncAlertaBanner');
  const visivel = () => banner().style.display !== 'none';
  const texto = () => banner().textContent;

  // --- 1) a faixa existe no topo do conteúdo, escondida por padrão, e é anunciada como alerta ---
  assert(banner() !== null, 'faixa syncAlertaBanner existe');
  assert(banner().parentElement.id === 'appMain', 'a faixa fica dentro de #appMain, acima das abas (sem mexer no cabeçalho de página)');
  assert(banner().getAttribute('role') === 'alert', 'a faixa tem role="alert"');
  assert(!visivel(), 'a faixa começa escondida');
  assert(typeof verificarAlertaSyncProducao === 'function', 'verificarAlertaSyncProducao existe');
  assert(String(enterApp).includes('verificarAlertaSyncProducao'), 'enterApp verifica o alerta ao entrar');

  const ultimoOk = '2026-09-30T12:07:03Z'; // 09:07 em São Paulo

  // --- 2) admin com alerta aberto: vê a faixa, com a data da última sincronização e onde olhar ---
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  window.__alerta = { ultimo_ok_em: ultimoOk, aberto_em: '2026-09-30T15:22:00Z' };
  await verificarAlertaSyncProducao();
  assert(visivel(), 'admin vê a faixa quando há alerta aberto');
  assert(texto().includes('30/09/2026'), 'mostra a data da última sincronização (' + texto() + ')');
  assert(texto().includes('09:07'), 'mostra a hora de São Paulo da última sincronização (' + texto() + ')');
  assert(texto().includes('Upload Dash'), 'admin é apontado para a aba Upload Dash (' + texto() + ')');

  // --- 3) supervisor: vê a faixa, mas sem apontar para uma aba que ele não enxerga ---
  currentUser = { id: 'u2', nome: 'Sup', username: 'sup', role: 'supervisor' };
  await verificarAlertaSyncProducao();
  assert(visivel(), 'supervisor vê a faixa quando há alerta aberto');
  assert(!texto().includes('Upload Dash'), 'supervisor não é mandado para a aba Upload Dash (ele não tem acesso)');

  // --- 4) consultor: nunca vê e nem consulta ---
  currentUser = { id: 'u3', nome: 'Cons', username: 'cons', role: 'consultor' };
  const antes = window.__consultas;
  await verificarAlertaSyncProducao();
  assert(!visivel(), 'consultor não vê a faixa');
  assert(window.__consultas === antes, 'consultor nem consulta a tabela de alertas');

  // --- 5) alerta resolvido: a faixa some ---
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  window.__alerta = { ultimo_ok_em: ultimoOk, aberto_em: '2026-09-30T15:22:00Z' };
  await verificarAlertaSyncProducao();
  assert(visivel(), 'faixa visível de novo com alerta aberto');
  window.__alerta = null;
  await verificarAlertaSyncProducao();
  assert(!visivel(), 'sem alerta aberto a faixa some');

  // --- 6) falha ao consultar: não quebra a tela e não deixa a faixa presa ---
  window.__alerta = { ultimo_ok_em: ultimoOk, aberto_em: '2026-09-30T15:22:00Z' };
  await verificarAlertaSyncProducao();
  window.__alertaErro = true;
  let lancou = false;
  try { await verificarAlertaSyncProducao(); } catch(e){ lancou = true; }
  assert(!lancou, 'falha na consulta não lança');
  assert(!visivel(), 'falha na consulta esconde a faixa (não mostra aviso que não dá para confirmar)');
  window.__alertaErro = false;

  // --- 7) alerta sem data da última sincronização (nenhuma jamais deu certo): texto genérico ---
  window.__alerta = { ultimo_ok_em: null, aberto_em: '2026-09-30T15:22:00Z' };
  await verificarAlertaSyncProducao();
  assert(visivel(), 'faixa visível mesmo sem data de última sincronização');
  assert(!texto().includes('null') && !texto().includes('Invalid'), 'texto não vaza "null"/"Invalid Date" (' + texto() + ')');

  // --- 8) sair do sistema esconde a faixa ---
  currentUser = null;
  await verificarAlertaSyncProducao();
  assert(!visivel(), 'sem usuário logado a faixa fica escondida');

  // --- 9) ligações reais: trocar de aba e sair do sistema atualizam a faixa (sem timer próprio) ---
  const esperar = () => new Promise(r => setTimeout(r, 30));
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  window.__alerta = null;
  await verificarAlertaSyncProducao();
  assert(!visivel(), 'começa sem faixa');
  window.__alerta = { ultimo_ok_em: ultimoOk, aberto_em: '2026-09-30T15:22:00Z' };
  document.querySelector('#tabsNav button[data-tab="busca"]').click();
  await esperar();
  assert(visivel(), 'ao trocar de aba a faixa é atualizada (alerta apareceu)');
  window.dispatchEvent(new window.Event('focus'));
  window.__alerta = null;
  window.dispatchEvent(new window.Event('focus'));
  await esperar();
  assert(!visivel(), 'ao voltar o foco para a janela a faixa é atualizada (alerta sumiu)');
  window.__alerta = { ultimo_ok_em: ultimoOk, aberto_em: '2026-09-30T15:22:00Z' };
  await verificarAlertaSyncProducao();
  assert(visivel(), 'faixa visível antes de sair');
  document.getElementById('btnLogout').click();
  await esperar(); await esperar();
  assert(!visivel(), 'ao sair do sistema a faixa some');

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
