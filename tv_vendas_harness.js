// Harness dos testes da §149 (TV Vendas). Não começa com test_: o run_tests.sh não roda sozinho.
// DADOS FICTÍCIOS (repo público).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

function rodar(testScript){
  const html = fs.readFileSync('_template.html', 'utf8');
  const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  if(!m){ console.error('script nao encontrado'); process.exit(1); }
  const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
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
  window.alert = (msg) => window.__alertas.push(String(msg));
  window.confirm = () => true;
  window.Chart = function(){ this.destroy = function(){}; return this; };
  window.TextDecoder = TextDecoder;
  window.process = process;
  const prefixo = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const chamadas = (nome) => window.__rpcCalls.filter(c => c.nome === nome);
  const disparar = (el, tipo) => el.dispatchEvent(new window.Event(tipo, { bubbles: true }));
`;
  const sufixo = `
  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
  window.eval(m[1] + prefixo + testScript + sufixo);
}
module.exports = { rodar };
