// Seção 106 (22/10/2026): botão "Atualizar dashboard agora" (Dashboard + Mesa), checagem de dado novo a cada 2 min
// nas telas abertas, e Danilo/Gabriel Macedo de volta só no Fechamento.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

const html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__rpc = null;          // resposta de producao_sync_agora
window.__rpcChamadas = 0;
window.__log = null;          // linha de producao_sync_log que o polling acha
window.__logConsultas = 0;
window.__cfg = { valor: '22/10/2026 15:00', atualizado_em: '2026-10-22T18:00:00Z' };
window.__pedidosConsultas = 0;
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  rpc: async (nome) => {
    if(nome === 'producao_sync_agora'){ window.__rpcChamadas++; return window.__rpc; }
    return { data: [], error: null };
  },
  from: (table) => ({
    select: () => {
      const b = {
        eq: () => b, gte: () => b, not: () => b, order: () => b, limit: () => b, in: () => b,
        maybeSingle: async () => {
          if(table === 'producao_sync_log'){ window.__logConsultas++; return { data: window.__log, error: null }; }
          if(table === 'config') return { data: window.__cfg, error: null };
          return { data: null, error: null };
        },
        then: (resolve) => {
          if(table === 'producao_pedidos'){ window.__pedidosConsultas++; return resolve({ data: [{ usuario: 'FULANO', etapa: 'CONCLUIDO' }], error: null }); }
          return resolve({ data: [], error: null });
        },
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

  // --- 1) Danilo e Gabriel Macedo: voltam no Fechamento, seguem fora do Dashboard; Vitor segue fora de tudo ---
  const linhas = ['DANILO MORAIS ARAUJO', 'GABRIEL MACEDO MARTINS', 'VITOR QUEIROZ CAVALCANTE', 'FULANO'].map(u => ({ usuario: u }));
  const fech = filtrarProducaoPedidos(linhas).map(r => r.usuario);
  assert(fech.includes('DANILO MORAIS ARAUJO') && fech.includes('GABRIEL MACEDO MARTINS'), 'Danilo e Gabriel aparecem no Fechamento (' + fech + ')');
  assert(!fech.includes('VITOR QUEIROZ CAVALCANTE'), 'Vitor continua fora do Fechamento');
  const dash = filtrarDashboardPedidos(linhas, 'apex').map(r => r.usuario);
  assert(!dash.includes('DANILO MORAIS ARAUJO') && !dash.includes('GABRIEL MACEDO MARTINS'), 'Danilo e Gabriel continuam fora do Dashboard (' + dash + ')');
  assert(dash.includes('FULANO'), 'consultor normal segue no Dashboard');
  assert(bmFora('DANILO MORAIS ARAUJO') && bmFora('GABRIEL MACEDO MARTINS'), 'Danilo e Gabriel continuam fora do Boletim');

  // --- 2) botões existem no Dashboard e na Mesa ---
  assert(document.querySelector('#panel-producao [data-sync-agora]'), 'botão no Dashboard de Produção');
  assert(document.querySelector('#panel-mesa [data-sync-agora]'), 'botão na Mesa do Supervisor');
  assert(document.querySelectorAll('[data-sync-agora-status]').length === 2, 'uma linha de status em cada tela');

  // --- 3) consultor não vê a barra nem dispara ---
  currentUser = { id: 'c1', role: 'consultor' };
  syncAgoraMostrar();
  assert(document.querySelector('[data-sync-agora-barra]').style.display === 'none', 'consultor não vê a barra do botão');
  await syncAgora();
  assert(window.__rpcChamadas === 0, 'consultor não chama a RPC');
  currentUser = { id: 's1', role: 'supervisor' };
  syncAgoraMostrar();
  assert(document.querySelector('[data-sync-agora-barra]').style.display === 'flex', 'supervisor vê a barra do botão');

  syncAgoraDormir = async () => {};
  const status = () => document.querySelector('#panel-mesa [data-sync-agora-status]').textContent;

  // --- 4) recusas do banco viram mensagem e não fazem polling ---
  window.__rpc = { data: { ok: false, motivo: 'recente', espera_seg: 100 }, error: null };
  await syncAgora();
  assert(status().includes('2 min') || status().includes('tente de novo em 2'), 'recusa "recente" diz quanto esperar (' + status() + ')');
  assert(window.__logConsultas === 0, 'recusa não consulta o log');
  window.__rpc = { data: { ok: false, motivo: 'automatica' }, error: null };
  await syncAgora();
  assert(status().includes('automática'), 'recusa perto do minuto 59 explica (' + status() + ')');
  window.__rpc = { data: { ok: false, motivo: 'noite' }, error: null };
  await syncAgora();
  assert(status().includes('10 minutos'), 'recusa da noite explica (' + status() + ')');
  window.__rpc = { data: null, error: { message: 'sem permissão' } };
  await syncAgora();
  assert(status().includes('Não foi possível'), 'erro da RPC vira mensagem genérica (' + status() + ')');

  // --- 5) caminho feliz: espera o log, empurra os pedidos para o dashboard e mostra o resultado ---
  let empurrou = 0, forcado = null;
  producaoChecarNovidade = async (f) => { forcado = f; empurrou++; return true; };
  window.__rpc = { data: { ok: true, pedido_em: '2026-10-22T18:10:00Z' }, error: null };
  window.__log = { ok: true, gravadas: 7, erro: null, terminou_em: '2026-10-22T18:10:03Z' };
  const p = syncAgora();
  assert(document.querySelector('[data-sync-agora]').disabled, 'botão fica desabilitado enquanto atualiza');
  await p;
  assert(empurrou === 1 && forcado === true, 'empurra os pedidos para o dashboard com forcar=true');
  assert(status().includes('15:10') && status().includes('7 pedidos'), 'mostra hora e quantidade (' + status() + ')');
  assert(document.querySelector('#panel-producao [data-sync-agora-status]').textContent === status(), 'as duas telas mostram o mesmo status');
  assert(!document.querySelector('[data-sync-agora]').disabled, 'botão volta a ficar habilitado');

  // --- 6) execução que falhou no NeoCRM: mostra o erro como texto ---
  window.__log = { ok: false, gravadas: 0, erro: '<b>intervalo mínimo</b>', terminou_em: '2026-10-22T18:10:03Z' };
  empurrou = 0;
  await syncAgora();
  assert(empurrou === 0, 'falha não empurra dados');
  assert(status().includes('<b>intervalo mínimo</b>'), 'erro aparece literal, sem virar HTML (' + status() + ')');

  // --- 7) checagem das telas abertas: só busca os pedidos quando o carimbo muda (ou passou 1h) ---
  // (producaoChecarNovidade foi trocada acima; a de verdade é producaoChecarNovidadeAgora)
  let recebidos = 0;
  const frame = document.getElementById('producaoFrame');
  frame.contentWindow.atualizarDadosDashboard = () => { recebidos++; };
  producaoUltimaCarga = { stamp: '2026-10-22T18:00:00Z', ms: Date.now() };
  window.__pedidosConsultas = 0;
  assert(await producaoChecarNovidadeAgora(false) === false, 'sem carimbo novo não atualiza');
  assert(window.__pedidosConsultas === 0, 'sem carimbo novo não busca os pedidos');
  window.__cfg = { valor: '22/10/2026 15:10', atualizado_em: '2026-10-22T18:10:03Z' };
  assert(await producaoChecarNovidadeAgora(false) === true, 'carimbo novo atualiza');
  assert(recebidos === 1 && window.__pedidosConsultas === 1, 'carimbo novo busca e empurra os pedidos');
  assert(producaoUltimaCarga.stamp === '2026-10-22T18:10:03Z', 'guarda o carimbo novo');
  assert(await producaoChecarNovidadeAgora(false) === false, 'mesmo carimbo de novo não atualiza');
  assert(await producaoChecarNovidadeAgora(true) === true && recebidos === 2, 'forcar atualiza mesmo sem carimbo novo');
  producaoUltimaCarga = { stamp: '2026-10-22T18:10:03Z', ms: Date.now() - 3600001 };
  assert(await producaoChecarNovidadeAgora(false) === true, 'passou 1h sem novidade: recarrega como antes');
  assert(PRODUCAO_CHECAGEM_MS === 120000, 'checagem a cada 2 min');

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
    process.exit();
  }, 500);
})();
