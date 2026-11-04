// Testa o §137 (aviso do gestor em Meus leads junta o da planilha e o da busca na Meta). DADOS FICTÍCIOS (repo público).
// Spec: docs/superpowers/specs/2026-11-04-leads-meta-entrada-design.md.
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
window.__rpcCalls = [];
window.__rpcRespostas = {};
window.__tabelas = {};
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b, eq: () => b,
    upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.__alertas = [];
window.alert = (m) => window.__alertas.push(String(m));
window.confirm = () => true;
window.Chart = function(){ this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process;

const testScript = `

(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const el = () => document.getElementById('kbAviso');
  const caso = async (espelho, meta) => {
    window.__tabelas.config = espelho === null ? [] : [{ valor: espelho }];
    window.__rpcRespostas.leads_meta_aviso = meta;
    await kbCarregarAviso();
    return { texto: el().textContent, visivel: el().style.display !== 'none' };
  };
  eq(await caso('', { data: '', error: null }), { texto: '', visivel: false }, 'sem aviso: some');
  eq(await caso(null, { data: '', error: null }), { texto: '', visivel: false }, 'sem linha de config: some');
  eq(await caso('Zz planilha parada', { data: '', error: null }), { texto: 'Zz planilha parada', visivel: true }, 'só o da planilha');
  eq(await caso('', { data: 'Leads da Meta: busca parada desde 04/11 19:00', error: null }), { texto: 'Leads da Meta: busca parada desde 04/11 19:00', visivel: true }, 'só o da Meta');
  eq(await caso('Zz planilha parada', { data: 'Zz meta parada', error: null }), { texto: 'Zz planilha parada · Zz meta parada', visivel: true }, 'os dois juntos');
  eq(await caso('Zz planilha parada', { data: null, error: { message: 'function leads_meta_aviso() does not exist' } }), { texto: 'Zz planilha parada', visivel: true }, 'erro na RPC da Meta não esconde o da planilha');
  assert(window.__rpcCalls.some(c => c.nome === 'leads_meta_aviso'), 'chama a RPC leads_meta_aviso');
  console.log('test_leads_meta_aviso: ' + ok + ' ok, ' + fail + ' falha(s)');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
