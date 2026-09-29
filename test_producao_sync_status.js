// Card "Produção — atualização automática" (Fase 2 da sincronização NeoSales, 29/09/2026).
// O Upload Dash deixou de receber planilha: a produção é sincronizada sozinha pela Edge Function
// sync-producao e este card só mostra o status (última sincronização, falha, tempo sem atualizar).
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

window.__logs = [];        // linhas de producao_sync_log, da mais nova pra mais antiga
window.__configKeys = [];  // chaves de config consultadas
window.__logsErro = false; // simula falha na consulta do log (rede, permissão)
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => ({
    select: () => {
      const filtros = [];
      const b = {
        eq: (col, val) => { filtros.push([col, val]); if(table === 'config' && col === 'chave') window.__configKeys.push(val); return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          if(table === 'producao_sync_log'){
            if(window.__logsErro) throw new Error('boom: sem permissão');
            const achou = window.__logs.find(l => filtros.every(([c, v]) => l[c] === v));
            return { data: achou || null, error: null };
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
  const agora = Date.now();
  const iso = (msAtras) => new Date(agora - msAtras).toISOString();
  const HORA = 3600000;

  // --- 1) não existe mais upload de planilha de produção; existe o card de status na aba Upload Dash ---
  assert(document.getElementById('producaoUpload') === null, 'input de upload de produção foi removido');
  assert(document.querySelector('#panel-movimentacao #producaoSyncCard') !== null, 'card de status da sincronização existe dentro de panel-movimentacao');
  assert(typeof carregarStatusSyncProducao === 'function', 'carregarStatusSyncProducao existe');
  assert(String(loadMovimentacao).includes('carregarStatusSyncProducao'), 'abrir a aba Upload Dash carrega o status da sincronização');

  const stat = () => document.getElementById('producaoSyncStatus').textContent;
  const aviso = () => document.getElementById('producaoSyncAviso');

  // --- 2) sincronização saudável: mostra a última sincronização e "OK", sem aviso ---
  window.__logs = [{ id: 9, ok: true, erro: null, terminou_em: iso(30 * 60000), gravadas: 12, linhas_api: 20, modo: 'horario' }];
  await carregarStatusSyncProducao();
  assert(stat().includes('Última sincronização'), 'mostra o rótulo "Última sincronização" (' + stat() + ')');
  assert(/\\d{2}\\/\\d{2}\\/\\d{4}/.test(stat()), 'mostra a data da última sincronização (' + stat() + ')');
  assert(stat().includes('OK'), 'mostra que a última execução deu OK (' + stat() + ')');
  assert(aviso().textContent.trim() === '', 'sem aviso quando está tudo certo (' + aviso().textContent + ')');

  // --- 3) última execução falhou (mas houve sucesso há pouco): mostra o motivo e explica que os dados seguem os do último sucesso ---
  window.__logs = [
    { id: 10, ok: false, erro: 'NeoSales recusou a consulta: Token Estrutura Inválido', terminou_em: iso(5 * 60000), gravadas: 0, linhas_api: 0, modo: 'horario' },
    { id: 9, ok: true, erro: null, terminou_em: iso(1 * HORA), gravadas: 12, linhas_api: 20, modo: 'horario' },
  ];
  await carregarStatusSyncProducao();
  assert(aviso().textContent.includes('Token Estrutura Inválido'), 'aviso traz o motivo da falha (' + aviso().textContent + ')');
  assert(aviso().textContent.toLowerCase().includes('falhou'), 'aviso diz que a última tentativa falhou (' + aviso().textContent + ')');
  assert(stat().includes('Falhou'), 'status mostra que a última execução falhou (' + stat() + ')');

  // --- 4) sem sucesso há mais de 3 horas: aviso de dados desatualizados ---
  window.__logs = [{ id: 5, ok: true, erro: null, terminou_em: iso(5 * HORA), gravadas: 3, linhas_api: 6, modo: 'horario' }];
  await carregarStatusSyncProducao();
  assert(aviso().textContent.includes('mais de 3 horas'), 'avisa que está há mais de 3 horas sem sincronizar (' + aviso().textContent + ')');

  // --- 5) nenhuma execução registrada ---
  window.__logs = [];
  await carregarStatusSyncProducao();
  assert(stat().includes('Nenhuma sincronização registrada'), 'sem logs: diz que nenhuma sincronização foi registrada (' + stat() + ')');

  // --- 6) o texto do erro nunca vira HTML (o erro vem de fora: NeoSales/banco) ---
  window.__logs = [{ id: 11, ok: false, erro: '<img src=x onerror=alert(1)>', terminou_em: iso(60000), gravadas: 0, linhas_api: 0, modo: 'horario' }];
  await carregarStatusSyncProducao();
  assert(aviso().querySelector('img') === null, 'erro é exibido como texto, sem criar elementos HTML');
  assert(aviso().textContent.includes('<img'), 'o texto do erro aparece literal (' + aviso().textContent + ')');

  // --- 7) o Dashboard passa a mostrar o "atualizado em" da sincronização automática ---
  window.__configKeys = [];
  currentUser = { id: 'u1', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  await loadProducaoDashboard();
  assert(window.__configKeys.includes('producao_neo_atualizado_em'), 'dashboard lê a chave producao_neo_atualizado_em (' + window.__configKeys.join(',') + ')');
  assert(!window.__configKeys.includes('producao_atualizado_em'), 'dashboard não lê mais a chave do upload manual');

  // --- 8) o estado vazio não manda mais "enviar a planilha" ---
  const msgAdmin = document.getElementById('producaoEmptyMsg').textContent;
  assert(!/planilha/i.test(msgAdmin) || /autom/i.test(msgAdmin), 'mensagem do estado vazio fala em atualização automática (' + msgAdmin + ')');
  assert(msgAdmin.includes('Upload Dash'), 'admin é apontado pra aba Upload Dash, onde fica o status (' + msgAdmin + ')');

  // --- 9) falha ao consultar o status não quebra a aba: mostra uma mensagem clara e não lança ---
  window.__logsErro = true;
  let lancou = false;
  try { await carregarStatusSyncProducao(); } catch(e){ lancou = true; }
  assert(!lancou, 'carregarStatusSyncProducao não lança quando a consulta falha');
  assert(stat().includes('Não foi possível carregar'), 'mostra que não foi possível carregar o status (' + stat() + ')');
  window.__logsErro = false;

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
