// Testa fetchAllRows() (24/09/2026) — bug relatado pelo usuário: "na aba digital quando seleciono
// o filtro tudo esta capturando no maximo 1000 leads sendo que temos mais ja". Causa raiz: o
// Supabase/PostgREST limita todo select() a no máximo 1000 linhas por padrão, mesmo sem .limit()
// explícito, cortando silenciosamente (sem erro) qualquer tabela que cresça além disso.
// fetchAllRows() pagina com .range() até esgotar os dados. Ver REGRAS_NEGOCIO.md seção 36.
const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// --- fixtures ---
function makeLeads(n){
  const out = [];
  for(let i = 0; i < n; i++){
    out.push({ consultor: 'c', status: 's', categoria: 'x', converteu: false, receita: 0, criado_em_lead: '2026-09-01T00:00:00-03:00', cnpj: 'CNPJ' + i, _idx: i });
  }
  return out;
}
window.__mockTables = {
  leads2340: makeLeads(2340), // 3 páginas: 1000 + 1000 + 340
  leads2000: makeLeads(2000), // exatamente 2 páginas cheias — 3ª chamada tem que devolver vazio e parar
  leads0: [],                 // tabela vazia
  leads150: makeLeads(150),   // menos de uma página inteira
};
window.__rangeCallLog = {}; // conta quantas vezes .range() foi chamado por "tabela mock" (pra afirmar o nº de idas ao servidor)

// query builder que PAGINA DE VERDADE via .range(from, to) — ao contrário dos mocks usados nos
// outros arquivos de teste (que sempre devolvem tudo numa página só), este simula o comportamento
// real do PostgREST: cada chamada devolve só a fatia pedida. fetchAllRows() chama queryFactory()
// de novo a cada página (é assim que o Supabase real funciona — cada .range() é uma query nova),
// então o contador de chamadas fica em window.__rangeCallLog (fora desta função) pra sobreviver
// entre as chamadas repetidas de makePagedQuery() pela mesma "tabela".
function makePagedQuery(mockKey){
  if(!(mockKey in window.__rangeCallLog)) window.__rangeCallLog[mockKey] = 0;
  const q = {
    select(){ return q; },
    eq(){ return q; },
    gte(){ return q; },
    order(){ return q; },
    range(from, to){
      window.__rangeCallLog[mockKey]++;
      const all = window.__mockTables[mockKey];
      const slice = all.slice(from, to + 1);
      return Promise.resolve({ data: slice, error: null });
    },
  };
  return q;
}

window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => {
    // loadConversaoVendas() (teste de integração abaixo) busca a tabela 'leads' — redireciona pra
    // window.__leadsTableKey, que o teste ajusta antes de cada cenário.
    if(table === 'leads') return makePagedQuery(window.__leadsTableKey || 'leads2340');
    if(table === 'config') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    return makePagedQuery('leads0');
  },
  functions: { invoke: async () => ({data:{},error:null}) },
  // usado por renderReconciliacaoNeoCRM() quando quem está logado não é admin/supervisor (chamado
  // de dentro de loadConversaoVendas()) — mesmo formato usado em test_conversao_vendas.js.
  rpc: async () => ({ data: { total: 0, ganho: 0, perdido: 0, andamento: 0, semPedido: 0, pedidosGanho: [], pedidosPerdido: [], pedidosAndamento: [] }, error: null }),
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // --- 1) 2340 linhas (3 páginas: 1000 + 1000 + 340) ---
  window.__leadsTableKey = 'leads2340';
  const r1 = await fetchAllRows(() => sb.from('leads').select('*'));
  assert(r1.error === null, 'sem erro pra 2340 linhas');
  assert(r1.data.length === 2340, 'devolve as 2340 linhas concatenadas, não só as primeiras 1000 (bug relatado pelo usuário): recebeu ' + r1.data.length);
  assert(window.__rangeCallLog['leads2340'] === 3, 'fez exatamente 3 chamadas .range() pra esgotar 2340 linhas (1000+1000+340): fez ' + window.__rangeCallLog['leads2340']);
  assert(r1.data[0]._idx === 0 && r1.data[2339]._idx === 2339, 'linhas concatenadas mantêm a ordem original (primeira e última batem)');
  for(let i = 0; i < r1.data.length; i++){
    assert(r1.data[i]._idx === i, 'linha ' + i + ' está na posição certa (sem furos/duplicatas na concatenação)');
    if(i > 5) break; // não precisa checar as 2340 uma por uma, só a amostra do início
  }

  // --- 2) exatamente 2000 linhas (múltiplo exato do pageSize) — não pode ficar em loop infinito
  // nem cortar a última página; a 3ª chamada .range() tem que devolver vazio e encerrar o loop ---
  window.__leadsTableKey = 'leads2000';
  const r2 = await fetchAllRows(() => sb.from('leads').select('*'));
  assert(r2.error === null, 'sem erro pra 2000 linhas (múltiplo exato de 1000)');
  assert(r2.data.length === 2000, 'devolve as 2000 linhas, nem a mais nem a menos: recebeu ' + r2.data.length);
  assert(window.__rangeCallLog['leads2000'] === 3, '3ª chamada .range() (vazia) é necessária pra confirmar o fim dos dados: fez ' + window.__rangeCallLog['leads2000'] + ' chamadas');

  // --- 3) tabela vazia (0 linhas) ---
  window.__leadsTableKey = 'leads0';
  const r3 = await fetchAllRows(() => sb.from('leads').select('*'));
  assert(r3.error === null, 'sem erro pra tabela vazia');
  assert(Array.isArray(r3.data) && r3.data.length === 0, 'devolve array vazio (não null) pra tabela vazia');
  assert(window.__rangeCallLog['leads0'] === 1, 'só 1 chamada .range() pra tabela vazia (já vem vazia na 1ª página): fez ' + window.__rangeCallLog['leads0']);

  // --- 4) menos de uma página (150 linhas) — só 1 chamada .range() ---
  window.__leadsTableKey = 'leads150';
  const r4 = await fetchAllRows(() => sb.from('leads').select('*'));
  assert(r4.error === null, 'sem erro pra 150 linhas');
  assert(r4.data.length === 150, 'devolve as 150 linhas: recebeu ' + r4.data.length);
  assert(window.__rangeCallLog['leads150'] === 1, 'só 1 chamada .range() quando a página já vem incompleta (150 < 1000): fez ' + window.__rangeCallLog['leads150']);

  // --- 5) pageSize customizado (testa com um valor pequeno, mais fácil de conferir a matemática) ---
  window.__leadsTableKey = 'leads150';
  window.__rangeCallLog['leads150'] = 0;
  const r5 = await fetchAllRows(() => sb.from('leads').select('*'), 50);
  assert(r5.data.length === 150, 'com pageSize=50, ainda devolve as 150 linhas todas: recebeu ' + r5.data.length);
  // 150 é múltiplo exato de 50 (3 páginas cheias de 50) — igual ao caso do item 2 (2000 = múltiplo
  // exato de 1000), precisa de uma 4ª chamada vazia pra confirmar o fim dos dados.
  assert(window.__rangeCallLog['leads150'] === 4, 'com pageSize=50 e 150 linhas (múltiplo exato), precisa de 4 chamadas (50+50+50+vazia): fez ' + window.__rangeCallLog['leads150']);

  // --- 6) integração: loadConversaoVendas() (aba Digital) recebe MAIS DE 1000 leads —
  // regressão direta do bug relatado ("capturando no maximo 1000 leads sendo que temos mais ja") ---
  window.__leadsTableKey = 'leads2340';
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  conversaoLeadsCache = [];
  await loadConversaoVendas();
  assert(conversaoLeadsCache.length === 2340, 'loadConversaoVendas() (aba Digital) carrega os 2340 leads inteiros, não trava em 1000 — este é o cenário exato do bug relatado pelo usuário: recebeu ' + conversaoLeadsCache.length);

  console.log(\`\\n--- RESULTADO: \${ok} passaram, \${fail} falharam ---\`);
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.error('ERRO NO TESTE:', e);
  window.__testResult = 'FAIL';
}
})();
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 50);
