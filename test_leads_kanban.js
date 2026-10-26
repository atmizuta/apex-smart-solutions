// Testa o Kanban "Meus leads" (§112). Spec: docs/superpowers/specs/2026-10-26-leads-kanban-planilha-design.md
// Decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom. DADOS FICTÍCIOS (repo público).
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
window.alert = () => {};
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
  const L = (id, o) => Object.assign({ aba: 'OUTUBRO', lead_id: id, nome: 'Zz ' + id, categoria: 'sem_contato', livre: false, venda_neo: false,
    converteu: false, criado_em_lead: '2026-10-26T12:00:00Z', classificado_em: null, retorno_em: null, status: null }, o || {});

  // ==== Task 8: funções puras ====
  eq(kbColunaDoLead(L('a', { livre: true })), 'livres', 'livre');
  eq(kbColunaDoLead(L('b')), 'novos', 'meu sem status');
  eq(kbColunaDoLead(L('c', { categoria: 'andamento' })), 'andamento', 'andamento');
  eq(kbColunaDoLead(L('d', { categoria: 'perdido', venda_neo: true })), 'convertido', 'venda no NEO leva para Convertido');
  eq(kbColunaDoLead(L('e', { categoria: 'perdido' })), 'perdido', 'perdido');
  const m = kbMontar([L('n1', { livre: true, criado_em_lead: '2026-10-26T10:00:00Z' }), L('n2', { livre: true, criado_em_lead: '2026-10-26T11:00:00Z' }),
    L('v1', { criado_em_lead: '2026-10-26T11:00:00Z' }), L('v2', { criado_em_lead: '2026-10-26T09:00:00Z' }),
    L('a1', { categoria: 'andamento', retorno_em: '2026-10-28' }), L('a2', { categoria: 'andamento', retorno_em: null }), L('a3', { categoria: 'andamento', retorno_em: '2026-10-27' })]);
  eq(m.livres.map(x => x.lead_id), ['n2', 'n1'], 'Livres: mais novo primeiro');
  eq(m.novos.map(x => x.lead_id), ['v2', 'v1'], 'Meus novos: mais antigo primeiro (urgência)');
  eq(m.andamento.map(x => x.lead_id), ['a3', 'a1', 'a2'], 'Andamento: retorno mais próximo primeiro, sem retorno no fim');
  eq(kbDivergencia(L('x', { venda_neo: true, converteu: false })), 'NEO tem venda neste CNPJ, mas o lead não está marcado como convertido', 'divergência NEO sem marcar');
  eq(kbDivergencia(L('x', { categoria: 'convertido', converteu: true, venda_neo: false })), 'Marcado como venda, mas o NEO ainda não tem pedido neste CNPJ', 'divergência marcado sem NEO');
  eq(kbDivergencia(L('x', { livre: true, venda_neo: true })), null, 'livre não tem divergência');
  eq(kbDivergencia(L('x', { categoria: 'convertido', converteu: true, venda_neo: true })), null, 'bate com o NEO');
  eq([kbGrupoDaColuna('andamento'), kbGrupoDaColuna('novos'), kbGrupoDaColuna('livres')], ['andamento', null, null], 'grupo da coluna');
  const ops = [{ status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }, { status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'CLIENTE NÃO RESPONDE', grupo: 'perdido', ordem: 20 }];
  eq(kbOpcoesDoGrupo(ops, 'perdido').map(o => o.status), ['CLIENTE NÃO RESPONDE', 'CNPJ INAPTO'], 'opções do grupo em ordem');
  eq(kbOpcoesDoGrupo(ops, null).length, 3, 'sem grupo = todas');
  eq(kbValidar({ status: '', grupo: null }, '2026-10-26'), 'Escolha o status.', 'status obrigatório');
  eq(kbValidar({ status: 'AGENDADO RETORNO', grupo: 'andamento', retorno: '' }, '2026-10-26'), 'Informe a data do retorno.', 'retorno obrigatório');
  eq(kbValidar({ status: 'AGENDADO RETORNO', grupo: 'andamento', retorno: '2026-10-25' }, '2026-10-26'), 'A data do retorno não pode ser no passado.', 'retorno no passado');
  eq(kbValidar({ status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', receita: '-1' }, '2026-10-26'), 'Receita inválida.', 'receita negativa');
  eq(kbValidar({ status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', receita: '1.234,50' }, '2026-10-26'), '', 'receita em formato BR ok');
  const agora = Date.parse('2026-10-26T12:00:00Z');
  eq([kbTempoDesde('2026-10-26T11:59:40Z', agora), kbTempoDesde('2026-10-26T11:57:00Z', agora), kbTempoDesde('2026-10-26T09:00:00Z', agora), kbTempoDesde('2026-10-23T12:00:00Z', agora)],
     ['agora', 'há 3 min', 'há 3 h', 'há 3 dias'], 'tempo desde');

  // ==== mais testes entram aqui ====

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
