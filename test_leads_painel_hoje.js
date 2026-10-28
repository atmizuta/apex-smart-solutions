// Testa o §122 de "Meus leads": quem pega, Hoje em painel, filtros, Todos, Equipe com atividade, lead novo. Spec: docs/superpowers/specs/2026-10-28-meus-leads-painel-hoje-design.md
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
  const SP = (s) => Date.parse(s + '-03:00');   // horário de São Paulo
  // ==== Task 3 ====
  eq(kbPartesSP(SP('2026-10-28T13:05:00')), { dia: '2026-10-28', hora: '13:05', min: 785, dow: 3 }, 'partes em SP (quarta 13:05)');
  eq(kbDiaSP('2026-10-29T02:30:00Z'), '2026-10-28', 'dia SP de madrugada UTC');
  eq([kbSomaDias('2026-10-31', 1), kbDiasEntre('2026-10-28', '2026-11-02')], ['2026-11-01', 5], 'somar dias e diferença');
  eq([kbTelCopiar('p:+5511999998888'), kbTelCopiar('p:+551199998888'), kbTelCopiar('(11) 90000-0001'), kbTelCopiar('p:11999998888'), kbTelCopiar(null)],
     ['11999998888', '1199998888', '11900000001', '11999998888', ''], 'telefone copiado começa no DDD');
  const agoraT3 = SP('2026-10-28T15:00:00');
  eq(kbDiasParado({ pego_em: '2026-10-25T12:00:00-03:00', classificado_em: '2026-10-26T23:30:00-03:00', ultima_ligacao: null }, agoraT3), 2, 'parado conta da última ação em dias corridos SP');
  eq(kbDiasParado({}, agoraT3), null, 'sem nenhuma ação: null');
  // Copiar da ficha usa o número normalizado
  const fichaT3 = kbFichaHtml({ aba: 'O', lead_id: 'f1', nome: 'Zz Ficha', livre: false, categoria: 'andamento', telefone: 'p:+5511900000061' }, { gestor: false, agoraMs: agoraT3, podePegar: true });
  assert(fichaT3.includes('data-kb-ficha-copiar="11900000061"') && !fichaT3.includes('data-kb-ficha-copiar="p:'), 'Copiar do celular sem p:+55');
  // consultor sem pode_pegar: sem Livres, sem Pegar, ficha avisa
  currentUser = { id: 'u-nao', nome: 'Zznao Teste', role: 'consultor' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 2, pode_pegar: false }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }];
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0 }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_kanban3 = { data: [
    { aba: 'OUTUBRO', lead_id: 'l1', nome: 'Zz Livre', categoria: 'sem_contato', livre: true, criado_em_lead: new Date().toISOString(), ligacoes: 0 },
    { aba: 'OUTUBRO', lead_id: 'm1', nome: 'Zz Meu', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, dono_id: 'u-nao', pego_em: new Date().toISOString(), criado_em_lead: new Date().toISOString(), ligacoes: 1 },
  ], error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  await espera(80);
  assert(window.__rpcCalls.some(c => c.nome === 'leads_kanban3' && c.args.p_todos === false), 'Quadro carrega pelo leads_kanban3');
  eq(kbPodePegar(), false, 'consultor sem pode_pegar');
  assert(document.querySelector('#kbBoard .kbCol[data-kb-col="livres"]').style.display === 'none', 'coluna Livres some para quem não pega');
  assert(document.querySelector('#kbNavQuadro [data-kb-ir="livres"]').style.display === 'none', 'atalho Livres some');
  assert(!kbCard({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, Date.now()).includes('data-kb-pegar'), 'cartão livre sem botão Pegar');
  const fichaNao = kbFichaHtml({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, { gestor: false, agoraMs: Date.now(), podePegar: false });
  assert(!fichaNao.includes('data-kb-ficha-pegar') && fichaNao.includes('não está liberado para pegar leads'), 'ficha de livre avisa quem não pode pegar (Review Focus 1)');
  // consultor com pode_pegar: tudo como antes
  currentUser = { id: 'u-pode', nome: 'Zzpode Teste', role: 'consultor' };
  window.__tabelas.leads_equipe = [{ id: 1, pode_pegar: true }];
  await kbAplicarPermissao();
  await kbCarregar();
  await espera(80);
  eq(kbPodePegar(), true, 'consultor com pode_pegar');
  assert(document.querySelector('#kbBoard .kbCol[data-kb-col="livres"]').style.display !== 'none', 'Livres aparece para quem pega');
  assert(kbCard({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, Date.now()).includes('data-kb-pegar'), 'cartão livre com Pegar');
  const fichaPode = kbFichaHtml({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, { gestor: false, agoraMs: Date.now(), podePegar: true });
  assert(fichaPode.includes('data-kb-ficha-pegar'), 'ficha de livre com Pegar para quem pode');
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
