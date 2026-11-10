// Harness dos testes da aba Renovação (§143). Não é teste (o nome foge de test_*). DADOS FICTÍCIOS (repo público).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

function rodar(testScript){
  const html = fs.readFileSync('_template.html', 'utf8');
  const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  if(!m){ console.error('script nao encontrado'); process.exit(1); }
  const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  Object.assign(window, { __tabelas: {}, __resp: {}, __escritas: [], __rpcCalls: [], __rpcRespostas: {}, __sessao: null });
  const casa = (linha, filtros) => filtros.every(([op, c, v]) => op === 'eq' ? String(linha[c]) === String(v) : op === 'in' ? v.map(String).includes(String(linha[c])) : op === 'notnull' ? (linha[c] !== null && linha[c] !== undefined) : true);
  function builder(tabela){
    const q = { tabela, op: 'select', filtros: [], patch: null };
    const resposta = () => {
      const r = window.__resp[tabela];
      if(typeof r === 'function') return r(q);
      const linhas = window.__tabelas[tabela] || [];
      if(q.op === 'insert'){
        const novo = Object.assign({ id: 'novo-' + window.__escritas.length }, q.patch);
        (window.__tabelas[tabela] = window.__tabelas[tabela] || []).push(novo);
        return { data: Object.assign({}, novo), error: null };
      }
      if(q.op === 'update'){
        const alvo = linhas.filter(l => casa(l, q.filtros));
        alvo.forEach(l => Object.assign(l, q.patch));
        return { data: alvo.map(l => Object.assign({}, l)), error: null };
      }
      return { data: linhas.filter(l => casa(l, q.filtros)).map(l => Object.assign({}, l)), error: null };
    };
    const b = {
      select: () => b, order: () => b, limit: () => b, is: () => b, gte: () => b, lte: () => b, lt: () => b,
      eq: (c, v) => { q.filtros.push(['eq', c, v]); return b; },
      in: (c, v) => { q.filtros.push(['in', c, v]); return b; },
      not: (c, op, v) => { if(op === 'is' && v === null) q.filtros.push(['notnull', c, null]); return b; },
      insert: (payload) => { q.op = 'insert'; q.patch = payload; window.__escritas.push(q); return b; },
      update: (patch) => { q.op = 'update'; q.patch = patch; window.__escritas.push(q); return b; },
      single: async () => { const r = resposta(); return { data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }; },
      maybeSingle: async () => { const r = resposta(); return { data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }; },
      then: (ok, ko) => Promise.resolve(resposta()).then(ok, ko),
    };
    return b;
  }
  window.supabase = { createClient: comRange(() => ({
    auth: { getSession: async () => ({ data: { session: window.__sessao } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
    from: (t) => builder(t),
    functions: { invoke: async () => ({ data: {}, error: null }) },
    rpc: (nome, args) => {
      window.__rpcCalls.push({ nome, args });
      const r = window.__rpcRespostas[nome];
      const res = typeof r === 'function' ? r(args) : (r || { data: null, error: null });
      return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
    },
  })) };
  window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
  // Date do Node: o SheetJS roda no "realm" do Node e testa instanceof Date; Date criado no jsdom não passa.
  window.__dataNode = (...a) => new Date(...a);
  window.alert = () => {};
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
  function fim(){ console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---'); process.exit(fail > 0 ? 1 : 0); }
`;
  const sufixo = `
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
  window.eval(m[1] + prefixo + testScript + sufixo);
}

module.exports = { rodar };
