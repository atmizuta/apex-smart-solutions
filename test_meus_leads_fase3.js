// Testa o §126.3 (redesign de Meus leads, Fase 3: Equipe).
// Spec: docs/superpowers/specs/2026-10-28-meus-leads-redesign-design.md. DADOS FICTÍCIOS (repo público).
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
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const SP = (s) => Date.parse(s + '-03:00');
  // ==== Task 2: funções puras ====
  eq([kbDuracaoMin(5), kbDuracaoMin(38), kbDuracaoMin(60), kbDuracaoMin(72), kbDuracaoMin(null)], ['5 min', '38 min', '1 h', '1 h 12 min', ''], 'duração em minutos');
  const ag = SP('2026-10-28T15:00:00');   // quarta
  const at = (o) => Object.assign({ dono_id: 'u1', nome: 'Zz Um', tem_telefonia: true, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0 }, o);
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T14:56:00-03:00' }), ag), { cor: 'verde', texto: 'ligou há 4 min' }, 'verde: ligou há pouco');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T14:00:00-03:00', ultima_obs: '2026-10-28T14:51:00-03:00' }), ag), { cor: 'verde', texto: 'OBS há 9 min' }, 'verde: a ação mais recente é a OBS');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T14:22:00-03:00' }), ag), { cor: 'amarelo', texto: 'parado 38 min' }, 'amarelo: parado 38 min');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T13:48:00-03:00' }), ag), { cor: 'vermelho', texto: 'parado 1 h 12 min' }, 'vermelho: parado 1 h 12 min');
  eq(kbAgoraEquipe(at({ tem_telefonia: false, ultima_obs: '2026-10-28T14:55:00-03:00' }), ag), { cor: 'verde', texto: 'OBS há 5 min' }, 'sem telefonia, com OBS recente: vale a OBS');
  eq(kbAgoraEquipe(at({ tem_telefonia: false }), ag), { cor: 'cinza', texto: 'sem telefonia' }, 'RF4: sem telefonia e sem OBS hoje');
  eq(kbAgoraEquipe(at({ tem_telefonia: false, ultima_obs: '2026-10-27T20:00:00-03:00' }), ag), { cor: 'cinza', texto: 'sem telefonia' }, 'RF4: OBS de ontem não conta');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-27T20:50:00-03:00' }), SP('2026-10-28T13:10:00')), { cor: 'verde', texto: 'nenhuma ação ainda' }, 'RF4: 13:10 sem nada hoje (a ligação de ontem não conta)');
  eq(kbAgoraEquipe(at({}), SP('2026-10-31T15:00:00')), { cor: 'cinza', texto: 'fora do expediente' }, 'RF4: sábado');
  eq(kbAgoraEquipe(at({}), SP('2026-10-28T12:30:00')).cor, 'cinza', 'RF4: antes das 13h');
  eq([0, 1, 4, 5, 9, 10, 14, 15, 40].map(kbNivelHora), [0, 1, 1, 2, 2, 3, 3, 4, 4], 'nível da hora no mapa');
  eq([kbHoraAtualIdx(SP('2026-10-28T12:59:00')), kbHoraAtualIdx(SP('2026-10-28T13:00:00')), kbHoraAtualIdx(ag), kbHoraAtualIdx(SP('2026-10-28T20:59:00')), kbHoraAtualIdx(SP('2026-10-28T21:30:00'))], [-1, 0, 2, 7, 8], 'hora atual no mapa (13h = 0)');
  eq([kbCorBarraLig(5, 80, ag), kbCorBarraLig(30, 80, ag), kbCorBarraLig(10, 80, ag), kbCorBarraLig(0, 80, SP('2026-10-28T12:00:00')), kbCorBarraLig(0, 80, SP('2026-10-31T15:00:00')), kbCorBarraLig(5, 0, ag)],
     ['red', 'green', '', '', '', ''], 'RF4: barra vermelha < 30% da meta proporcional, verde > 70%, neutra antes das 13h, no fim de semana e sem meta');
  const cont = { u1: { sem_contato: 4, andamento: 11, parados3: 3, retornos_atrasados: 2, convertidos: 3, receita: 300, pegos_mes: 30 }, u2: { sem_contato: 0, andamento: 5, parados3: 0, retornos_atrasados: 0, convertidos: 1, receita: 50.5, pegos_mes: 8 } };
  const ativ = [at({ dono_id: 'u1', nome: 'Zz Lucas', ultima_ligacao: '2026-10-28T13:48:00-03:00', lig_hoje: 19, meta_dia: 80 }), at({ dono_id: 'u2', nome: 'Zz Luria', ultima_ligacao: '2026-10-28T14:55:00-03:00', lig_hoje: 57, meta_dia: 80 }), at({ dono_id: 'u3', nome: 'Zz Vitoria', tem_telefonia: false })];
  eq(kbFaixasAtencao(ativ, cont, ag), [{ dono_id: 'u1', nome: 'Zz Lucas', min: 72, sem_contato: 4 }], 'faixa de atenção: só quem está vermelho (sem telefonia sem OBS não entra)');
  const LE = [{ livre: true, criado_em_lead: '2026-10-28T14:35:00-03:00' }, { livre: true, criado_em_lead: '2026-10-28T14:50:00-03:00' }, { livre: false, dono_id: 'u1' }];
  eq(kbKpisEquipe(ativ, LE, cont, ag), { lig: 76, meta: 160, livres: 2, livreAntigo: '2026-10-28T14:35:00-03:00', semContato: 4, retornosAtras: 2, vendas: 4, receita: 350.5 }, 'números do topo: meta × consultores com telefonia');
  const pes = [{ id: 'a', nome: 'Zz Caio' }, { id: 'b', nome: 'Zz Ana' }, { id: 'c', nome: 'Zz Bia' }];
  eq(kbMenosCarga(pes, { a: 5, b: 9, c: 5 }), 'c', 'menos carga; empate pelo nome (Zz Bia antes de Zz Caio)');
  eq(kbMenosCarga(pes, {}), 'b', 'sem carga conhecida: o primeiro em ordem alfabética');
  eq(kbMenosCarga([], {}), null, 'ninguém');
  eq(kbDividirIgual(['k1', 'k2', 'k3', 'k4'], pes, { a: 1, b: 0, c: 3 }).map(x => x.para), ['b', 'b', 'a', 'b'], 'dividir igual: cada lead vai para quem está com menos (somando o que já recebeu; empate pelo nome)');
  eq(kbDividirIgual(['k1'], [], {}), [], 'dividir sem ninguém: nada');
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
