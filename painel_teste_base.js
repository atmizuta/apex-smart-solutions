// Base comum dos testes do Caderno / Agenda / Objeções (06/10/2026, REGRAS_NEGOCIO.md §72).
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

// Tabelas do §72 com "consultor_id uuid not null default auth.uid()" (migration 20261006100000).
const TABELAS_UID = ['caderno_notas', 'agenda_retornos', 'objecoes_uso'];

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
    const f = { eq: {}, neq: {}, gte: [], lte: [], ou: null, ordem: null, lim: null, faixa: null, contarExato: false };
    // Filtros (sem ordenar/paginar) — usado tanto pela listagem quanto pelo count: 'exact' (teste_anotacoes.js, §73).
    const linhasFiltradas = () => {
      let ls = (window.__tabelas[tabela] || []).filter(l => Object.keys(f.eq).every(c => l[c] === f.eq[c]) && Object.keys(f.neq).every(c => l[c] !== f.neq[c]));
      ls = ls.filter(l => f.gte.every(([c, v]) => cmpValor(l[c], v) >= 0) && f.lte.every(([c, v]) => cmpValor(l[c], v) <= 0));
      // .or('col.eq.v,col2.ilike.%v2%'): eq compara igual (comportamento de sempre); ilike/like casa
      // substring sem diferenciar maiúsculas (suficiente para a busca da aba Anotações, §73).
      if(f.ou) ls = ls.filter(l => f.ou.some(([c, op, v]) => {
        const alvo = l[c] == null ? '' : String(l[c]);
        if(op === 'ilike' || op === 'like'){
          const termo = String(v).replace(/^%+/, '').replace(/%+$/, '').toLowerCase();
          return alvo.toLowerCase().includes(termo);
        }
        return alvo === v;
      }));
      return ls;
    };
    const linhas = () => {
      let ls = linhasFiltradas();
      if(f.ordem) ls = ls.slice().sort((a, b) => cmpValor(a[f.ordem[0]], b[f.ordem[0]]) * (f.ordem[1] ? 1 : -1));
      if(f.lim) ls = ls.slice(0, f.lim);
      if(f.faixa) ls = ls.slice(f.faixa[0], f.faixa[1] + 1); // .range(de, ate): paginação de verdade (§73, "Carregar mais")
      return ls;
    };
    const escrita = (op, extra) => {
      window.__escritas.push(Object.assign({ tabela, op }, extra));
      const erro = window.__falharEscrita ? window.__falharEscrita(tabela, op, extra) : null;
      if(!erro && (op === 'upsert' || op === 'insert')){
        const t = window.__tabelas[tabela] = window.__tabelas[tabela] || [];
        // linha nova sem consultor_id ganha o do usuário logado, como o "default auth.uid()" das tabelas do §72
        const uidPadrao = () => (window.__uidAtual ? window.__uidAtual() : null);
        [].concat(extra.rows).forEach(r => {
          const i = t.findIndex(x => r.id && x.id === r.id);
          if(i >= 0) t[i] = Object.assign({}, t[i], r);
          else t.push(Object.assign(TABELAS_UID.includes(tabela) && !('consultor_id' in r) && uidPadrao() ? { consultor_id: uidPadrao() } : {}, r));
        });
      }
      return Promise.resolve({ error: erro || null });
    };
    const b = {
      select: (cols, opts) => { if(opts && opts.count) f.contarExato = true; return b; },
      in: () => b, is: () => b,
      range: (de, ate) => { f.faixa = [de, ate]; return b; },
      eq: (c, v) => { f.eq[c] = v; return b; }, neq: (c, v) => { f.neq[c] = v; return b; },
      gte: (c, v) => { f.gte.push([c, v]); return b; }, lte: (c, v) => { f.lte.push([c, v]); return b; },
      // "col.op.valor" (op pode ter dentro "%...%" com pontos, por isso junta o resto de novo com '.')
      or: (s) => { f.ou = String(s).split(',').map(p => { const partes = p.split('.'); return [partes[0], partes[1], partes.slice(2).join('.')]; }); return b; },
      order: (c, o) => { f.ordem = [c, !o || o.ascending !== false]; return b; }, limit: (n) => { f.lim = n; return b; },
      upsert: (rows, opts) => escrita('upsert', { rows, opts }),
      insert: (rows) => escrita('insert', { rows }),
      // update(patch).eq(c, v)[.eq(...)][.select(cols)] — grava na hora do await. Com .select(), devolve em
      // data as linhas que casaram (como o PostgREST faz com return=representation): 0 linhas = o RLS
      // (ou o filtro) não deixou atualizar nada. Sem .select(), devolve só { error } como antes.
      update: (patch) => {
        const filtro = {}; let comSelect = false, feito = null;
        const executar = () => {
          if(feito) return feito;
          const erro = window.__falharEscrita ? window.__falharEscrita(tabela, 'update', { patch, filtro }) : null;
          window.__escritas.push({ tabela, op: 'update', patch, filtro: Object.assign({}, filtro) });
          const casaram = erro ? [] : (window.__tabelas[tabela] || []).filter(l => Object.keys(filtro).every(c => l[c] === filtro[c]));
          casaram.forEach(l => Object.assign(l, patch));
          feito = Promise.resolve(comSelect ? { data: erro ? null : casaram.map(l => Object.assign({}, l)), error: erro || null } : { error: erro || null });
          return feito;
        };
        const u = {
          eq: (c, v) => { filtro[c] = v; return u; },
          select: () => { comSelect = true; return u; },
          then: (ok, ko) => executar().then(ok, ko),
        };
        return u;
      },
      // delete().eq(c, v)[.eq(...)] — tira as linhas que casarem assim que o await acontece (igual ao
      // update sem .select()); grava em __escritas pra os testes conferirem (seção 74, excluir anotação).
      delete: () => {
        const filtro = {}; let feito = null;
        const executar = () => {
          if(feito) return feito;
          const erro = window.__falharEscrita ? window.__falharEscrita(tabela, 'delete', { filtro }) : null;
          window.__escritas.push({ tabela, op: 'delete', filtro: Object.assign({}, filtro) });
          if(!erro) window.__tabelas[tabela] = (window.__tabelas[tabela] || []).filter(l => !Object.keys(filtro).every(c => l[c] === filtro[c]));
          feito = Promise.resolve({ error: erro || null });
          return feito;
        };
        const d = {
          eq: (c, v) => { filtro[c] = v; return d; },
          then: (ok, ko) => executar().then(ok, ko),
        };
        return d;
      },
      maybeSingle: async () => ({ data: linhas()[0] || null, error: null }),
      then: (ok, ko) => {
        // select('*', { count: 'exact' }): count é o total que bate no filtro, sem o .range() da página
        // (como o PostgREST faz) — a aba Anotações usa isso pro contador "N anotações" (§73).
        const resp = { data: linhas(), error: null };
        if(f.contarExato) resp.count = linhasFiltradas().length;
        return Promise.resolve(resp).then(ok, ko);
      },
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
  window.Notification = function(titulo, opts){ window.__notificacoes.push({ titulo, opts, inst: this }); this.close = () => {}; };
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
  // o mock do Supabase (fora deste eval) usa isto para o "default auth.uid()" de consultor_id
  window.__uidAtual = () => (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null);
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
