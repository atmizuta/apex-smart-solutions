// Base comum dos testes do Caderno / Agenda / Objeções (06/10/2026, REGRAS_NEGOCIO.md §72).
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

function montarPainel(){
  const html = fs.readFileSync('_template.html', 'utf8');
  const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  if(!m) throw new Error('script nao encontrado');
  const jsCode = m[1];
  const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  Object.assign(window, { __tabelas: {}, __escritas: [], __rpcCalls: [], __rpcRespostas: {}, __invocacoes: [], __invokeResposta: null,
    __falharEscrita: null, __alertas: [], __notificacoes: [], __abertos: [], __copiados: [] });

  // Compara valores de coluna para gte/lte/order: timestamptz do banco chega como ISO com offsets
  // variados ("-03:00" vs "Z"), e comparação por texto dá resposta errada em silêncio. Se os dois
  // parecem data/hora ISO e dão parse, compara por instante (epoch ms); números comparam numericamente;
  // o resto cai na comparação de texto/locale de sempre.
  function pareceIso(v){ return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v); }
  function cmpValor(a, b){
    if(pareceIso(a) && pareceIso(b)){
      const ta = Date.parse(a), tb = Date.parse(b);
      if(!isNaN(ta) && !isNaN(tb)) return ta - tb;
    }
    if(typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  }
  function builder(tabela){
    const f = { eq: {}, neq: {}, gte: [], lte: [], ou: null, ordem: null, lim: null };
    const linhas = () => {
      let ls = (window.__tabelas[tabela] || []).filter(l => Object.keys(f.eq).every(c => l[c] === f.eq[c]) && Object.keys(f.neq).every(c => l[c] !== f.neq[c]));
      ls = ls.filter(l => f.gte.every(([c, v]) => cmpValor(l[c], v) >= 0) && f.lte.every(([c, v]) => cmpValor(l[c], v) <= 0));
      if(f.ou) ls = ls.filter(l => f.ou.some(([c, v]) => String(l[c]) === v));
      if(f.ordem) ls = ls.slice().sort((a, b) => cmpValor(a[f.ordem[0]], b[f.ordem[0]]) * (f.ordem[1] ? 1 : -1));
      if(f.lim) ls = ls.slice(0, f.lim);
      return ls;
    };
    const escrita = (op, extra) => {
      window.__escritas.push(Object.assign({ tabela, op }, extra));
      const erro = window.__falharEscrita ? window.__falharEscrita(tabela, op) : null;
      if(!erro && (op === 'upsert' || op === 'insert')){
        const t = window.__tabelas[tabela] = window.__tabelas[tabela] || [];
        [].concat(extra.rows).forEach(r => { const i = t.findIndex(x => r.id && x.id === r.id); if(i >= 0) t[i] = Object.assign({}, t[i], r); else t.push(Object.assign({}, r)); });
      }
      return Promise.resolve({ error: erro || null });
    };
    const b = {
      select: () => b, in: () => b, is: () => b, range: () => b,
      eq: (c, v) => { f.eq[c] = v; return b; }, neq: (c, v) => { f.neq[c] = v; return b; },
      gte: (c, v) => { f.gte.push([c, v]); return b; }, lte: (c, v) => { f.lte.push([c, v]); return b; },
      or: (s) => { f.ou = String(s).split(',').map(p => { const [c, , ...v] = p.split('.'); return [c, v.join('.')]; }); return b; },
      order: (c, o) => { f.ordem = [c, !o || o.ascending !== false]; return b; }, limit: (n) => { f.lim = n; return b; },
      upsert: (rows, opts) => escrita('upsert', { rows, opts }),
      insert: (rows) => escrita('insert', { rows }),
      update: (patch) => ({ eq: (c, v) => {
        const erro = window.__falharEscrita ? window.__falharEscrita(tabela, 'update') : null;
        window.__escritas.push({ tabela, op: 'update', patch, filtro: { [c]: v } });
        if(!erro) (window.__tabelas[tabela] || []).forEach(l => { if(l[c] === v) Object.assign(l, patch); });
        return Promise.resolve({ error: erro || null });
      } }),
      maybeSingle: async () => ({ data: linhas()[0] || null, error: null }),
      then: (ok, ko) => Promise.resolve({ data: linhas(), error: null }).then(ok, ko),
    };
    return b;
  }
  window.supabase = { createClient: comRange(() => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
    from: (t) => builder(t),
    functions: { invoke: (nome, opts) => {
      window.__invocacoes.push({ nome, body: opts && opts.body });
      const r = window.__invokeResposta;
      return typeof r === 'function' ? r(nome, opts) : Promise.resolve(r || { data: {}, error: null });
    } },
    rpc: (nome, args) => {
      window.__rpcCalls.push({ nome, args });
      const r = window.__rpcRespostas[nome];
      const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
      return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
    },
  })) };
  window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
  window.alert = (msg) => window.__alertas.push(String(msg));
  window.confirm = () => true;
  window.Chart = function(){ this.destroy = function(){}; return this; };
  window.TextDecoder = TextDecoder;
  window.process = process;
  window.open = (u) => { window.__abertos.push(u); return null; };
  window.Notification = function(titulo, opts){ window.__notificacoes.push({ titulo, opts }); this.close = () => {}; };
  window.Notification.permission = 'granted';
  window.Notification.requestPermission = async () => 'granted';
  if(!window.crypto || !window.crypto.randomUUID){
    Object.defineProperty(window, 'crypto', { value: { randomUUID: () => require('crypto').randomUUID(), getRandomValues: (a) => require('crypto').webcrypto.getRandomValues(a) }, configurable: true });
  }
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (t) => { window.__copiados.push(t); return Promise.resolve(); } }, configurable: true });

  function rodar(corpo){
    const teste = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const sp = (s) => Date.parse(s + '-03:00');
  function fim(){ console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---'); process.exit(fail > 0 ? 1 : 0); }
  // mostrarAviso cai em alert() sem animação e em #apexToasts com animação: o teste olha os dois
  const avisos = () => window.__alertas.join(' | ') + ' | ' + ((document.getElementById('apexToasts') || {}).textContent || '');
  ${corpo}
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();`;
    window.eval(jsCode + teste);
  }
  return { window, rodar };
}

module.exports = { montarPainel };
