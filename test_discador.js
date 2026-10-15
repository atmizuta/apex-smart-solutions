// Testa a aba Discador (15/10/2026) — REGRAS_NEGOCIO.md §87.
// Spec: docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md
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
window.__rpcAtraso = {};
window.__tabelas = {};
window.__avisos = [];
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b, eq: () => b, not: () => b,
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    const atraso = window.__rpcAtraso[nome] || 0;
    const p = new Promise(ok => setTimeout(() => ok(res), atraso));
    return { range: () => p, then: (ok, ko) => p.then(ok, ko) };
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
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const avisos = [];
  mostrarAviso = (msg, tipo) => avisos.push([tipo, String(msg)]);

  // ==== TASK 1: funções puras ====
  eq(dcPeriodo('hoje', '2026-10-15'), { de: '2026-10-15', ate: '2026-10-15' }, 'hoje');
  eq(dcPeriodo('ontem', '2026-10-01'), { de: '2026-09-30', ate: '2026-09-30' }, 'ontem atravessa o mês');
  eq(dcPeriodo('7dias', '2026-10-15'), { de: '2026-10-09', ate: '2026-10-15' }, '7 dias inclui hoje');
  eq(dcPeriodo('mes', '2026-10-15'), { de: '2026-10-01', ate: '2026-10-15' }, 'mês até hoje');
  eq(dcPeriodo('custom', '2026-10-15', '2026-09-01', '2026-10-10'), { de: '2026-09-01', ate: '2026-10-10' }, 'personalizado válido');
  eq(dcPeriodo('custom', '2026-10-15', '2026-10-10', '2026-10-01'), null, 'personalizado invertido');
  eq(dcPeriodo('custom', '2026-10-15', '2026-01-01', '2026-10-01'), null, 'personalizado acima de 120 dias');
  eq(dcPeriodo('custom', '2026-10-15', '2026-06-03', '2026-10-01'), { de: '2026-06-03', ate: '2026-10-01' }, '120 dias exatos valem');
  eq(dcPeriodo('custom', '2026-10-15', '', '2026-10-01'), null, 'personalizado vazio');
  eq(dcPeriodo('xyz', '2026-10-15'), { de: '2026-10-15', ate: '2026-10-15' }, 'chave desconhecida = hoje');

  eq(dcTaxa(1, 4), 0.25, 'taxa');
  eq(dcTaxa(3, 0), null, 'taxa com divisor 0');
  eq(dcFmtPct(0.30627), '30,6%', 'pct com 1 casa');
  eq(dcFmtPct(null), '—', 'pct nulo');
  eq(dcFmtNum(139925), '139.925', 'milhar pt-BR');
  eq(dcFmtNum(null), '0', 'número nulo');
  eq(dcFmtSeg(48), '48 s', 'segundos');
  eq(dcFmtSeg(125), '2 min 05 s', 'minutos');
  eq(dcFmtSeg(null), '—', 'segundos nulos');
  eq(dcDdMm('2026-10-05'), '05/10', 'dd/mm');

  const ph = [
    { hora: 13, contato: 40, abandonadas: 4 },
    { hora: 14, contato: 50, abandonadas: 10 },
    { hora: 15, contato: 8, abandonadas: 6 },
  ];
  eq(dcAlertaAbandono(ph, 15, 0.15), { hora: 14, taxa: 0.2, abandonadas: 10, contato: 50 }, 'às 15h olha 14h: 20% > 15%');
  eq(dcAlertaAbandono(ph, 14, 0.15), null, 'às 14h olha 13h: 10% não alerta');
  eq(dcAlertaAbandono(ph, 16, 0.15), null, 'às 16h olha 15h: só 8 contatos, sem alerta');
  eq(dcAlertaAbandono(ph, 9, 0.15), null, 'hora sem linha');
  eq(dcAlertaAbandono(null, 15, 0.15), null, 'sem dados');

  const cons = [
    { atendidas: 100, sem_avanco: 50, sem_tabulacao: 2, vendas: 4 },
    { atendidas: 100, sem_avanco: 30, sem_tabulacao: 8, vendas: 0 },
    { atendidas: 5, sem_avanco: 5, sem_tabulacao: 5, vendas: 0 },
  ];
  const m = dcMediaEquipe(cons);
  eq([Math.round(m.semAvanco * 1000), Math.round(m.semTab * 1000), Math.round(m.conversao * 1000)], [415, 73, 20], 'média ponderada pelas atendidas');
  eq(dcMediaEquipe([]), { semAvanco: null, semTab: null, conversao: null }, 'equipe vazia');
  eq(dcPiorQueMedia(0.6, 0.4, true), true, 'sem avanço 50% acima: pior');
  eq(dcPiorQueMedia(0.5, 0.4, true), false, 'sem avanço 25% acima: normal');
  eq(dcPiorQueMedia(0.01, 0.02, false), true, 'conversão 50% abaixo: pior');
  eq(dcPiorQueMedia(0.5, null, true), false, 'sem média: nunca destaca');

  // ==== TASK 2: HTML dos blocos ====
  const R = { tentativas: 139925, contato: 8551, atendidas: 5932, abandonadas: 2619, sem_tabulacao: 47, seg_falados_medio: 48, vendas: 34, abandono_alerta: 0.15, ultima_sync: null };
  const k = dcKpisHtml(R);
  assert(k.includes('139.925') && k.includes('6,1%') && k.includes('30,6%') && k.includes('5.932') && k.includes('48 s') && k.includes('>34<'), 'cartões com números formatados');
  assert(k.includes('47 sem tabulação'), 'sub das atendidas');
  const k0 = dcKpisHtml({ tentativas: 0, contato: 0, atendidas: 0, abandonadas: 0, sem_tabulacao: 0, seg_falados_medio: null, vendas: 0 });
  assert(!k0.includes('NaN') && k0.includes('—'), 'período vazio: sem NaN, taxas com traço');
  assert(dcKpisHtml(null).includes('Não foi possível carregar'), 'resumo com erro');

  const horas = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(h => ({ hora: h, tentativas: h === 14 ? 2935 : 0, contato: h === 14 ? 137 : 0, atendidas: h === 14 ? 120 : 0, abandonadas: h === 14 ? 17 : 0, media_atendidas: h === 14 ? 101 : 0, media_abandonadas: h === 14 ? 31 : 0 }));
  const hh = dcHorasHtml(horas, true);
  assert((hh.match(/class="bmHora"/g) || []).length === 13, '13 colunas de hora');
  assert(hh.includes('14h') && hh.includes('12,4%'), 'hora 14 com % de abandono (17/137)');
  assert(hh.includes('dashed'), 'linha da média quando comMedia');
  assert(!dcHorasHtml(horas, false).includes('dashed'), 'sem média em período de vários dias');
  assert(dcHorasHtml(null, true).includes('Não foi possível carregar'), 'por hora com erro');

  const calor = [{ dia_semana: 1, hora: 14, tentativas: 1000, contato: 80 }, { dia_semana: 3, hora: 10, tentativas: 500, contato: 10 }];
  const ch = dcCalorHtml(calor);
  assert(ch.includes('bmCalor') && ch.includes('Seg') && ch.includes('Qua') && ch.includes('8,0%') && ch.includes('2,0%'), 'mapa de calor com taxa de contato');
  assert(dcCalorHtml([]).includes('Sem chamadas'), 'mapa vazio');

  const consultores = [
    { agente_id: 189, profile_id: null, nome: 'Agente 189', atendidas: 100, seg_falados_total: 4800, seg_falados_medio: 48, sem_avanco: 60, retornos: 5, ganhos: 1, sem_tabulacao: 1, vendas: 3 },
    { agente_id: 193, profile_id: 'p1', nome: 'Caio Teste', atendidas: 100, seg_falados_total: 6000, seg_falados_medio: 60, sem_avanco: 30, retornos: 2, ganhos: 2, sem_tabulacao: 9, vendas: 0 },
    { agente_id: 93, profile_id: null, nome: 'Agente 93', atendidas: 4, seg_falados_total: 12, seg_falados_medio: 3, sem_avanco: 4, retornos: 0, ganhos: 0, sem_tabulacao: 4, vendas: 0 },
  ];
  const ct = dcConsultoresHtml(consultores);
  assert(ct.includes('data-dc-agente="189"') && ct.includes('Caio Teste') && ct.includes('60,0%'), 'linha por agente, clicável');
  assert(/data-dc-agente="189"[^]*?dcPior[^]*?60,0%/.test(ct), 'agente 189: sem avanço 60% vs média ~44% → destacado');
  assert(/data-dc-agente="193"[^]*?dcPior[^]*?9,0%/.test(ct), 'agente 193: sem tabulação 9% vs média ~6,9% → destacado');
  assert(!ct.split('data-dc-agente="93"')[1].split('</tr>')[0].includes('dcPior'), 'agente 93 com 4 atendidas não é destacado');
  assert(dcConsultoresHtml([]).includes('Ninguém atendeu'), 'sem consultores');

  const ml = dcMailingHtml([{ chave: 'ZZ-CARGA <b>1</b>', tentativas: 45570, contato: 2524, atendidas: 1854, abandonadas: 670, ganhos: 5, vendas: 15 }], 'Carga');
  assert(ml.includes('ZZ-CARGA &lt;b&gt;1&lt;/b&gt;') && !ml.includes('<b>1</b>'), 'texto do banco escapado');
  assert(ml.includes('45.570') && ml.includes('5,5%') && ml.includes('26,5%') && ml.includes('0,33'), 'contato, abandono e vendas por mil');
  assert(dcMailingHtml([], 'Cidade').includes('Sem dados'), 'mailing vazio');

  const dd = dcDiasHtml('Caio Teste', [{ dia: '2026-10-05', atendidas: 30, seg_falados_total: 1500, sem_avanco: 10, ganhos: 1, vendas: 2 }]);
  assert(dd.includes('Caio Teste') && dd.includes('05/10') && dd.includes('25 min 00 s'), 'detalhe por dia');

  const vh = dcVinculoHtml([{ agente_id: 189, atendidas_30d: 971, ultima_chamada: '2026-10-14T19:00:00Z' }], [{ id: 'p1', nome: 'Caio Teste', role: 'consultor' }, { id: 'p2', nome: 'Ana <Teste>', role: 'supervisor' }]);
  assert(vh.includes('1 agente sem consultor') && vh.includes('Agente 189') && vh.includes('971'), 'vínculo: lista');
  assert(vh.includes('data-dc-vinc="189"') && vh.includes('value="p1"') && vh.includes('Ana &lt;Teste&gt;'), 'vínculo: seletor com perfis escapados');
  eq(dcVinculoHtml([], []), '', 'sem pendências: nada');

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
