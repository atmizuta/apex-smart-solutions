// Testa o comparativo Lead × Mailing (Boletim da Manhã e Mesa do Supervisor) — REGRAS_NEGOCIO.md §99.
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público (nada de telefone, nome ou CNPJ real).
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
window.__lidas = [];
function builder(tabela){
  const linhasFiltradas = () => { const f = b.__eq || {}; return (window.__tabelas[tabela] || []).filter(l => Object.keys(f).every(c => l[c] === undefined || l[c] === f[c])); };
  const b = {
    select: () => b, in: () => b, is: () => b, not: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b, lt: () => b, gt: () => b, neq: () => b,
    eq: (c, v) => { b.__eq = Object.assign(b.__eq || {}, { [c]: v }); return b; },
    maybeSingle: async () => ({ data: linhasFiltradas()[0] || null, error: null }),
    then: (resolve) => resolve({ data: linhasFiltradas(), error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => { window.__lidas.push(t); return builder(t); },
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
window.jspdf = require('jspdf');
window.process = process;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const sp = (s) => Date.parse(s + '-03:00');
  const iso = (s) => new Date(sp(s)).toISOString();
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  // ==== Lead × Mailing (§99) — DADOS FICTÍCIOS ====
  const fora = n => /FORA/.test(String(n || ''));
  const dados = {
    pedidos: [
      { tipo: 'venda', dia: '2026-10-18', numero_pedido: '1', usuario: 'ANA TESTE', valor: 100, origem: 'lead' },
      { tipo: 'venda', dia: '2026-10-18', numero_pedido: '1', usuario: 'ANA TESTE', valor: 100, origem: 'lead' },   // repetido: conta 1
      { tipo: 'venda', dia: '2026-10-16', numero_pedido: '2', usuario: 'BIA TESTE', valor: 50.5, origem: 'mailing' },
      { tipo: 'venda', dia: '2026-10-13', numero_pedido: '3', usuario: 'ANA TESTE', valor: 80, origem: 'lead' },
      { tipo: 'venda', dia: '2026-10-13', numero_pedido: '4', usuario: 'FORA TESTE', valor: 999, origem: 'lead' },  // pessoa fora
      { tipo: 'venda', dia: '2026-10-11', numero_pedido: '5', usuario: 'ANA TESTE', valor: 70, origem: 'lead' },    // antes da janela
      { tipo: 'perda', dia: '2026-10-17', numero_pedido: '6', usuario: 'BIA TESTE', valor: 40, origem: 'mailing' },
      { tipo: 'perda', dia: '2026-10-14', numero_pedido: '7', usuario: 'ANA TESTE', valor: 60, origem: 'lead' },
      { tipo: 'venda', dia: '2026-10-18', numero_pedido: '8', usuario: 'ANA TESTE', valor: 10, origem: 'outros' },  // origem desconhecida: fora
    ],
    leads: { '2026-10-16': 3, '2026-10-18': 7, '2026-10-13': 10, '2026-10-11': 99 },
    atendidas: { '2026-10-16': 100, '2026-10-14': 200 },
  };
  const s = origSomar(dados, '2026-10-16', '2026-10-18', fora);
  eq([s.lead.base, s.lead.vendas, s.lead.valor, s.lead.perdas], [10, 1, 100, 0], 'ontem: lead');
  eq([s.mailing.base, s.mailing.vendas, s.mailing.valor, s.mailing.perdas, s.mailing.valorPerdido], [100, 1, 50.5, 1, 40], 'ontem: mailing');
  eq([s.lead.conversao, s.mailing.conversao, s.mailing.pctPerda, s.lead.ticket], [0.1, 0.01, 0.5, 100], 'ontem: conversão, % perdida, ticket');
  const s7 = origSomar(dados, '2026-10-12', '2026-10-18', fora);
  eq([s7.lead.base, s7.lead.vendas, s7.lead.valor, s7.lead.perdas, s7.lead.valorPerdido], [20, 2, 180, 1, 60], '7 dias: lead sem a pessoa fora e sem o dia anterior');
  eq([s7.mailing.base, s7.mailing.vendas], [300, 1], '7 dias: mailing');
  const vazio = origSomar({ pedidos: [], leads: {}, atendidas: {} }, '2026-10-16', '2026-10-18', fora);
  eq([vazio.lead.conversao, vazio.lead.ticket, vazio.lead.pctPerda], [null, null, null], 'sem base: conversão, ticket e % perdida vazios');

  const per = { de: '2026-10-16', ate: '2026-10-18' };
  const c = origComparativo(dados, per, fora);
  eq(c.janelas.map(j => [j.chave, j.de, j.ate]), [['ontem', '2026-10-16', '2026-10-18'], ['sete', '2026-10-12', '2026-10-18']], 'janelas: período do boletim e 7 dias até o fim dele');
  eq(c.janelas.map(j => j.rotulo), ['Sex a dom', '7 dias'], 'rótulos das janelas');
  eq(origComparativo(dados, { de: '2026-10-16', ate: '2026-10-16' }, fora).janelas[0].rotulo, 'Ontem', 'um dia só = Ontem');
  eq([c.janelas[0].melhor.conversao, c.janelas[1].melhor.conversao], ['lead', 'lead'], 'lead converte mais nas duas janelas');
  eq([c.janelas[0].melhor.pctPerda, c.janelas[0].melhor.valor], ['lead', 'lead'], '% perdida: menor é melhor; valor: maior é melhor');
  eq(c.janelas[0].melhor.vendas, null, 'empate não destaca ninguém');
  assert(c.vencedor === 'lead' && /7 dias/.test(c.frase) && /Lead 10,0%/.test(c.frase), 'frase diz quem converteu mais: ' + c.frase);
  const semMailing = origComparativo({ pedidos: dados.pedidos, leads: dados.leads, atendidas: {} }, per, fora);
  eq(semMailing.janelas[0].melhor.conversao, null, 'sem atendidas no mailing: não compara a conversão');

  const h = origTabelaHtml(c);
  assert(/Lead/.test(h) && /Mailing/.test(h) && /Sex a dom/.test(h) && /7 dias/.test(h), 'tabela com as duas origens e as duas janelas');
  assert(!/Outras|outros/.test(h), 'só Lead e Mailing (sem "Outras")');
  const conv = h.match(new RegExp('<tr class="origConv">([^]*?)</tr>'));
  assert(conv && (conv[1].match(/origMelhor/g) || []).length === 2, 'linha de conversão destaca o vencedor de cada janela');
  assert(/origFrase/.test(h), 'frase de destaque acima da tabela');
  eq(origTabelaHtml(null), '', 'sem dados: nada');

  // ==== Boletim: retrato, tela e PDF ====
  const ctxB = { hoje: '2026-10-19', agoraMs: sp('2026-10-19T10:10:00'), periodo: bmPeriodo('2026-10-19'), cfg: bmCfg(null), vlcfg: vlCfg(null), nome: 'Sup' };
  const R = bmMontar({ origens: dados }, ctxB);
  assert(R.origens && R.origens.janelas.length === 2, 'retrato guarda o comparativo');
  eq(bmMontar({}, ctxB).origens, null, 'sem a fonte: comparativo nulo');
  const tela = bmTelaHtml({ retrato: R });
  assert(/Lead × Mailing/.test(tela) && /origConv/.test(tela), 'tela do boletim mostra a tabela');
  const antigo = Object.assign({}, R); delete antigo.origens;
  assert(!/Lead × Mailing/.test(bmTelaHtml({ retrato: antigo })), 'boletim antigo (sem comparativo): sem o card');
  const doc = bmPdf({ dia: '2026-10-19', gerado_em: iso('2026-10-19T10:10:00'), retrato: R });
  const saida = doc.output();
  eq(doc.getNumberOfPages(), 4, 'PDF continua com 4 páginas');
  assert(/LEAD X MAILING/.test(saida) && /Maior convers/.test(saida), 'PDF tem o comparativo');

  // ==== bmCarregar busca a janela de 7 dias ====
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.lead_mailing_comparativo = { data: dados, error: null };
  const d = await bmCarregar({ hoje: '2026-10-19', periodo: bmPeriodo('2026-10-19'), cfg: bmCfg(null) });
  const chamada = window.__rpcCalls.find(x => x.nome === 'lead_mailing_comparativo');
  eq(chamada && chamada.args, { p_de: '2026-10-12', p_ate: '2026-10-18' }, 'boletim pede 7 dias até ontem');
  assert(d.origens && d.origens.pedidos.length === dados.pedidos.length, 'boletim recebe os dados');

  // ==== Mesa: mesma tabela, ao vivo ====
  window.__rpcCalls.length = 0;
  await mesaCarregarOrigens('2026-10-19');
  eq((window.__rpcCalls.find(x => x.nome === 'lead_mailing_comparativo') || {}).args, { p_de: '2026-10-12', p_ate: '2026-10-18' }, 'Mesa pede a mesma janela');
  assert(/origConv/.test(document.getElementById('mesaOrig').innerHTML), 'Mesa mostra a tabela');
  window.__rpcRespostas.lead_mailing_comparativo = { data: null, error: { message: 'x' } };
  await mesaCarregarOrigens('2026-10-19');
  assert(/Não foi possível/.test(document.getElementById('mesaOrig').innerHTML), 'Mesa: erro na função não derruba, só avisa');
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  window.__rpcCalls.length = 0;
  await mesaCarregarOrigens('2026-10-19');
  assert(!window.__rpcCalls.length, 'consultor: Mesa não chama a função');

  console.log('--- test_lead_mailing RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__resultado = fail > 0 ? 1 : 0;
}catch(e){ console.log('ERRO FATAL:', e && e.stack || e); window.__resultado = 1; }
})();
`;
window.eval(jsCode + '\n' + testScript);
const espera = setInterval(() => {
  if(window.__resultado === undefined) return;
  clearInterval(espera);
  process.exit(window.__resultado);
}, 50);
setTimeout(() => { console.log('TEMPO ESGOTADO'); process.exit(1); }, 60000);
