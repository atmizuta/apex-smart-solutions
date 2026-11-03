// Testa o §132 (Meus leads: bloquear todos de pegar e chave de quem pega). DADOS FICTÍCIOS (repo público).
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
  const avisos = [];
  mostrarAviso = (m, t) => avisos.push([String(m), t]);
  const BLOQ = JSON.stringify({ bloqueado: true, por: 'Zz Supervisora Teste', em: new Date(Date.now() - 5 * 60000).toISOString() });
  // ==== kbBloqueioDe ====
  eq(kbBloqueioDe(BLOQ).bloqueado, true, 'texto JSON bloqueado');
  eq(kbBloqueioDe({ bloqueado: false }).bloqueado, false, 'objeto liberado');
  eq(kbBloqueioDe('painel').bloqueado, false, 'valor inválido = liberado');
  eq(kbBloqueioDe(null).bloqueado, false, 'sem chave = liberado');
  eq(kbBloqueioDe({ bloqueado: 'true' }).bloqueado, false, 'só true de verdade bloqueia');
  // ==== Equipe (supervisor) ====
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__tabelas.config = [{ valor: JSON.stringify({ bloqueado: false }) }];
  const ATV = [
    { dono_id: 'u1', nome: 'Zz Um', tem_telefonia: true, lig_hoje: 3, lig_por_hora: [1,2,0,0,0,0,0,0], meta_dia: 80, pode_pegar: true },
    { dono_id: 'u2', nome: 'Zz Dois', tem_telefonia: true, lig_hoje: 0, lig_por_hora: [0,0,0,0,0,0,0,0], meta_dia: 80, pode_pegar: false },
  ];
  kbEstado.atividade = ATV; kbEstado.leadsEquipe = []; kbEstado.alertasEquipe = []; kbEstado.equipeLista = null;
  await kbCarregarBloqueio();
  kbRenderEquipe();
  const eqEl = document.getElementById('kbEquipe');
  let faixa = eqEl.querySelector('.kbEqPegar');
  assert(faixa && !faixa.classList.contains('bloq') && faixa.textContent.includes('Pegar leads: Liberado') && faixa.textContent.includes('1 consultor pega leads'), 'faixa liberada com quantos pegam');
  eq(faixa.querySelector('[data-kb-pegar-bloquear]').textContent, 'Bloquear todos', 'botão Bloquear todos');
  const chaves = [...eqEl.querySelectorAll('[data-kb-pode-pegar]')];
  eq(chaves.map(c => [c.dataset.kbPodePegar, c.classList.contains('on'), c.getAttribute('aria-checked')]), [['u1', true, 'true'], ['u2', false, 'false']], 'chave de cada consultor');
  assert(!eqEl.textContent.includes('só os que já tem'), 'o texto antigo saiu');
  // bloquear
  window.__rpcRespostas.leads_pegar_bloquear = (a) => ({ data: { bloqueado: a.p_bloqueado, por: 'Zzksup Teste', em: new Date().toISOString() }, error: null });
  faixa.querySelector('[data-kb-pegar-bloquear]').click(); await espera();
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_pegar_bloquear').map(c => c.args), [{ p_bloqueado: true }], 'chama leads_pegar_bloquear(true)');
  faixa = eqEl.querySelector('.kbEqPegar');
  assert(faixa.classList.contains('bloq') && faixa.textContent.includes('Pegar leads: Bloqueado') && faixa.textContent.includes('por Zzksup'), 'faixa vira Bloqueado com quem bloqueou');
  eq(faixa.querySelector('[data-kb-pegar-bloquear]').textContent, 'Liberar', 'botão vira Liberar');
  assert(avisos.some(a => a[0].includes('bloqueado para todos') && a[1] === 'ok'), 'aviso de bloqueio');
  faixa.querySelector('[data-kb-pegar-bloquear]').click(); await espera();
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_pegar_bloquear').map(c => c.args.p_bloqueado), [true, false], 'Liberar chama com false');
  assert(!eqEl.querySelector('.kbEqPegar').classList.contains('bloq'), 'volta a liberado');
  // chave por consultor
  window.__rpcRespostas.leads_definir_pode_pegar = { data: null, error: null };
  eqEl.querySelector('[data-kb-pode-pegar="u1"]').click(); await espera();
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_definir_pode_pegar').map(c => c.args), [{ p_profile: 'u1', p_pode: false }], 'desliga o u1');
  assert(!eqEl.querySelector('[data-kb-pode-pegar="u1"]').classList.contains('on') && ATV[0].pode_pegar === false, 'chave do u1 desligada');
  eq(kbEstado.equipeLista, null, 'clicar na chave não abre os leads da linha');
  eqEl.querySelector('[data-kb-pode-pegar="u2"]').click(); await espera();
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_definir_pode_pegar').map(c => c.args.p_pode), [false, true], 'liga o u2');
  assert(eqEl.querySelector('[data-kb-pode-pegar="u2"]').classList.contains('on'), 'chave do u2 ligada');
  // erro do banco: nada muda
  window.__rpcRespostas.leads_definir_pode_pegar = { data: null, error: { message: 'sem permissão' } };
  eqEl.querySelector('[data-kb-pode-pegar="u2"]').click(); await espera();
  assert(ATV[1].pode_pegar === true && eqEl.querySelector('[data-kb-pode-pegar="u2"]').classList.contains('on') && avisos.some(a => a[1] === 'erro'), 'erro mantém a chave e avisa');
  // v1 da função (sem pode_pegar): sem chave
  kbEstado.atividade = [{ dono_id: 'u9', nome: 'Zz Velho', tem_telefonia: false, lig_hoje: 0 }]; kbRenderEquipe();
  eq(eqEl.querySelectorAll('[data-kb-pode-pegar]').length, 0, 'sem pode_pegar não mostra chave');
  // ==== consultor ====
  currentUser = { id: 'u1', nome: 'Zz Um', role: 'consultor', operacao: 'apex' };
  kbEstado.naEquipe = true; kbEstado.podePegar = true; kbEstado.modo = 'painel';
  window.__tabelas.config = [{ valor: BLOQ }];
  await kbCarregarBloqueio();
  assert(kbPegarBloqueado() && !kbPodePegar() && kbVeLivres(), 'bloqueado: não pega, mas ainda vê os livres');
  assert(!document.getElementById('kbPausaAviso').hidden, 'aviso de pausa aparece');
  const livre = { aba: 'O', lead_id: 'lv', nome: 'Zz Livre', categoria: 'sem_contato', livre: true, criado_em_lead: new Date().toISOString() };
  assert(!kbCard(livre, Date.now()).includes('data-kb-pegar'), 'cartão livre sem botão Pegar');
  window.__tabelas.config = [{ valor: JSON.stringify({ bloqueado: false }) }];
  await kbCarregarBloqueio();
  assert(kbPodePegar() && document.getElementById('kbPausaAviso').hidden && kbCard(livre, Date.now()).includes('data-kb-pegar'), 'liberado: volta o Pegar e some o aviso');
  kbEstado.podePegar = false;
  window.__tabelas.config = [{ valor: BLOQ }];
  await kbCarregarBloqueio();
  assert(document.getElementById('kbPausaAviso').hidden && !kbVeLivres(), 'quem não pega não vê aviso nem livres');
  kbEstado.podePegar = true;
  // alerta de lead novo some com o bloqueio
  window.__rpcRespostas.leads_alertas = { data: [{ tipo: 'lead_novo', aba: 'O', lead_id: 'n1', nome: 'Zz Novo' }, { tipo: 'sem_contato', aba: 'O', lead_id: 's1', nome: 'Zz Sem' }], error: null };
  await kbCarregarAlertas(false);
  eq(kbEstado.alertas.map(a => a.tipo), ['sem_contato'], 'bloqueado: sem alerta de lead novo');
  // painel aberto antes do bloqueio: o banco recusa e o aviso explica
  window.__rpcRespostas.leads_pegar = { data: null, error: { message: 'pegar leads está pausado pelo supervisor', code: '42501' } };
  avisos.length = 0;
  eq(await kbPegar('O', 'lv'), false, 'kbPegar devolve false');
  assert(avisos.some(a => a[0] === 'Pegar leads está pausado pelo supervisor.' && a[1] === 'erro'), 'mensagem do banco no aviso');
  // CSS sem cor fixa e sem cantos antigos
  const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\\n');
  const regras = (css.match(/\\.kb(EqPegar|PegaChave)[^{]*\\{[^}]*\\}/g) || []).join('');
  assert(regras.length > 0 && !/#[0-9a-fA-F]{3,6}/.test(regras) && !/border-radius:(10|12|14)px/.test(regras), 'CSS novo só com variáveis');
  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
