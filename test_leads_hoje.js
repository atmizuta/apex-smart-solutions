// Testa as abas Hoje / Quadro / Equipe de "Meus leads" (§118). Spec: docs/superpowers/specs/2026-10-27-meus-leads-hoje-equipe-design.md
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
window.__alertas = [];
window.alert = (m) => window.__alertas.push(String(m));   // sem ApexMotion no jsdom, mostrarAviso cai aqui
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

  // ==== Task 3: funções puras ====
  eq(kbAbasDoPerfil(false), ['hoje', 'quadro'], 'consultor: Hoje e Quadro');
  eq(kbAbasDoPerfil(true), ['hoje', 'quadro', 'equipe'], 'gestor: + Equipe');
  eq([kbAbaPadrao(false), kbAbaPadrao(true)], ['hoje', 'equipe'], 'aba padrão por perfil');
  const fila = [{ aba: 'OUTUBRO', lead_id: 'a', motivo: 'Novo sem contato' }, { aba: 'OUTUBRO', lead_id: 'b', motivo: 'Esfriando' }];
  const agora = Date.parse('2026-10-27T15:00:00Z');
  eq(kbProximoDaFila(fila, {}, agora).lead_id, 'a', 'próximo = primeiro da fila');
  eq(kbProximoDaFila(fila, { 'OUTUBRO|a': agora - 60000 }, agora).lead_id, 'b', 'aberto há 1 min é pulado');
  eq(kbProximoDaFila(fila, { 'OUTUBRO|a': agora - 180000 }, agora).lead_id, 'a', 'exceção vence em 2 min');
  eq(kbProximoDaFila([], {}, agora), null, 'fila vazia');
  eq(kbSemaforo({ sem_contato: 1, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 0 }), 'vermelho', 'semáforo vermelho: novo sem contato');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 2, parados: 0, perdas_suspeitas: 0 }), 'vermelho', 'semáforo vermelho: retorno vencido');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 0, parados: 1, perdas_suspeitas: 0 }), 'amarelo', 'semáforo amarelo: parado');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 3 }), 'amarelo', 'semáforo amarelo: perda suspeita');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 0 }), 'verde', 'semáforo verde');
  eq([kbConversao({ pegos_mes: 0, convertidos_mes: 0 }), kbConversao({ pegos_mes: 40, convertidos_mes: 10 })], ['—', '25%'], 'conversão');
  eq(kbResumoContatoTexto({ ligacoes: 5, atendidas: 2, cliques: 1, ultimo: '2026-10-27T12:00:00Z' }, agora), '5 tentativas · 2 atendidas · última há 3 h', 'resumo de contato');
  eq(kbResumoContatoTexto({ ligacoes: 1, atendidas: 0, cliques: 0, ultimo: '2026-10-27T14:58:00Z' }, agora), '1 tentativa · 0 atendidas · última há 2 min', 'singular');
  eq(kbResumoContatoTexto({ ligacoes: 0, atendidas: 0, cliques: 2, ultimo: '2026-10-27T14:00:00Z' }, agora), 'Nenhuma ligação ainda · 2 cliques no painel', 'só cliques');
  eq(kbResumoContatoTexto({ ligacoes: 0, atendidas: 0, cliques: 0, ultimo: null }, agora), 'Nenhuma ligação ainda', 'nada');
  eq(kbResumoContatoTexto(null, agora), '', 'sem resumo (Livre)');
  const ev = Array.from({ length: 35 }, (_, i) => ({ em: new Date(agora - i * 60000).toISOString(), tipo: i % 2 ? 'ligacao' : 'clique', titulo: 'Evento ' + i, detalhe: i === 0 ? '<b>x</b>' : null, quem: 'Zz' }));
  const lt = kbLinhaTempoHtml(ev, 30);
  assert((lt.match(/class="kbEv /g) || []).length === 30 && lt.includes('data-kb-ver-tudo'), 'linha do tempo: 30 eventos e "ver tudo"');
  assert(!lt.includes('<b>x</b>') && lt.includes('&lt;b&gt;'), 'linha do tempo escapa HTML');
  assert(!kbLinhaTempoHtml(ev.slice(0, 3), 30).includes('data-kb-ver-tudo'), 'sem "ver tudo" com poucos eventos');
  eq([kbBuscaValida('ab'), kbBuscaValida(' abc '), kbBuscaValida('')], [false, true, false], 'busca a partir de 3 caracteres');
  eq(kbAlertaTexto({ tipo: 'sem_contato' }), 'Pego e sem contato', 'texto do alerta');
  const al = [{ tipo: 'sem_contato', aba: 'O', lead_id: '1' }, { tipo: 'parado', aba: 'O', lead_id: '2' }, { tipo: 'sem_contato', aba: 'O', lead_id: '3' }];
  eq(kbAlertasParaNotificar(al, new Set(['O|3'])).map(a => a.lead_id), ['1'], 'notifica só sem_contato ainda não notificado');
  eq(kbQuandoSP('2026-10-28', '14:30'), '2026-10-28T14:30:00-03:00', 'data + hora em SP');
  eq(kbQuandoSP('2026-10-28', ''), '2026-10-28T10:00:00-03:00', 'hora padrão 10:00');
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
