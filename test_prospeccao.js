// Testa a §161 (subaba Prospecção em Meus leads). Spec: docs/superpowers/specs/2026-11-19-prospeccao-caio-luria-design.md.
// DADOS FICTÍCIOS (repo público).
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

window.__abertos = [];
window.open = (url, alvo) => { window.__abertos.push({ url, alvo }); return null; };

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const AG = Date.parse('2026-11-20T15:00:00-03:00');
  const C = (o) => Object.assign({ id: 1, cnpj: '11222333000181', aba_origem: 'LURIA', razao_social: 'Zz Oficina Ltda', cidade: 'Campinas', uf: 'SP',
    segmento: 'Zz Segmento', porte: 'MEI', obs_planilha: null, dados: { linha: '2', resultado: 'Encontrado' }, telefone: '11900000001', tel_fonte: 'nova_vida',
    whatsapp: true, socio_nome: 'ZZKSOCIO FULANO DE TAL', nv_status: 'ok', etapa: 'livre', retorno_em: null, obs: null, dono_id: null, dono_nome: null,
    dono_em: null, atualizado_em: '2026-11-20T10:00:00-03:00' }, o || {});

  // ==== etapas ====
  eq(PROSPEC_ETAPAS.map(e => e[0]), ['livre', 'contato', 'retornar', 'venda', 'sem_interesse', 'sem_contato'], 'ordem das colunas');
  eq(PROSPEC_ETAPAS.map(e => e[1]), ['Livres', 'Em contato', 'Retornar', 'Venda', 'Sem interesse', 'Sem contato'], 'rótulos');

  // ==== telefone ====
  eq(prospecTelInfo(C()), { numero: '11900000001', celular: true, rotulo: '(11) 90000-0001', selo: 'whats' }, 'celular com WhatsApp');
  eq(prospecTelInfo(C({ telefone: '(16) 98111-0000', whatsapp: null })).numero, '16981110000', 'formatado vira dígitos');
  eq(prospecTelInfo(C({ telefone: '5516981110000', whatsapp: false })), { numero: '16981110000', celular: true, rotulo: '(16) 98111-0000', selo: 'semwhats' }, '55 na frente sai; sem WhatsApp');
  eq(prospecTelInfo(C({ telefone: '1930000000', whatsapp: false })), { numero: '1930000000', celular: false, rotulo: '(19) 3000-0000', selo: '' }, 'fixo: sem selo');
  eq(prospecTelInfo(C({ telefone: null, nv_status: 'pendente' })).rotulo, 'Consultando telefone…', 'pendente');
  eq(prospecTelInfo(C({ telefone: null, nv_status: 'erro' })).rotulo, 'Consulta com erro', 'erro');
  eq(prospecTelInfo(C({ telefone: null, nv_status: 'sem_socios' })).rotulo, 'Sem sócio na Nova Vida', 'sem sócios');
  eq(prospecTelInfo(C({ telefone: null, nv_status: 'sem_telefone' })).rotulo, 'Sem telefone', 'sem telefone');

  // ==== WhatsApp ====
  eq(prospecPrimeiroNome('ZZKSOCIO FULANO'), 'Zzksocio', 'primeiro nome capitalizado');
  eq(prospecPrimeiroNome('  '), '', 'nome vazio');
  eq(prospecWhatsTexto(C(), 'Zzkcon Teste'),
     'Olá, Zzksocio! Aqui é Zzkcon, da Claro Empresas. Estou entrando em contato sobre a Zz Oficina Ltda: temos condições especiais de internet e móvel para empresas. Posso te explicar rapidinho?', 'texto completo');
  eq(prospecWhatsTexto(C({ socio_nome: null, razao_social: null }), 'Zzkcon'),
     'Olá! Aqui é Zzkcon, da Claro Empresas. Temos condições especiais de internet e móvel para empresas. Posso te explicar rapidinho?', 'sem sócio e sem razão');
  const link = prospecWhatsLink(C({ razao_social: 'Zz & "Filhos" <b>' }), 'Zzkcon');
  assert(link.startsWith('https://wa.me/5511900000001?text=') && link.includes(encodeURIComponent('Zz & "Filhos" <b>')), 'link codificado');
  eq(prospecWhatsLink(C({ telefone: '1930000000' }), 'Zzkcon'), '', 'fixo: sem link');
  eq(prospecWhatsLink(C({ telefone: null }), 'Zzkcon'), '', 'sem número: sem link');

  // ==== filtrar e agrupar ====
  const L = [C({ id: 1 }), C({ id: 2, etapa: 'contato', dono_id: 'u-a', dono_nome: 'Zz A', razao_social: 'Zz Padaria', telefone: '11900000002' }),
    C({ id: 3, etapa: 'retornar', dono_id: 'u-b', retorno_em: '2026-11-21T10:00:00-03:00', cnpj: '11444777000161' }),
    C({ id: 4, etapa: 'retornar', dono_id: 'u-a', retorno_em: '2026-11-20T09:00:00-03:00', socio_nome: 'ZZ JOSÉ' })];
  eq(prospecFiltrar(L, { meus: true, uid: 'u-a', busca: '' }).map(c => c.id), [2, 4], 'Meus');
  eq(prospecFiltrar(L, { meus: false, uid: 'u-a', busca: 'padaria' }).map(c => c.id), [2], 'busca pela razão, sem maiúscula');
  eq(prospecFiltrar(L, { meus: false, uid: 'u-a', busca: '11.444.777' }).map(c => c.id), [3], 'busca pelo CNPJ com pontuação');
  eq(prospecFiltrar(L, { meus: false, uid: 'u-a', busca: '90000-0002' }).map(c => c.id), [2], 'busca pelo telefone');
  eq(prospecFiltrar(L, { meus: false, uid: 'u-a', busca: 'jose' }).map(c => c.id), [4], 'busca pelo sócio, sem acento');
  const g = prospecAgrupar(L);
  eq(Object.keys(g), ['livre', 'contato', 'retornar', 'venda', 'sem_interesse', 'sem_contato'], 'grupos');
  eq(g.retornar.map(c => c.id), [4, 3], 'Retornar pela data, mais cedo primeiro');

  // ==== cartão ====
  const livre = prospecCardHtml(C(), { uid: 'u-a', agoraMs: AG, pegando: new Set() });
  assert(livre.includes('data-prospec-pegar="1"') && livre.includes('data-prospec-id="1"'), 'livre: botão Pegar');
  assert(livre.includes('data-prospec-whats="1"') && livre.includes('data-prospec-ligar="1"'), 'livre: WhatsApp e Ligar');
  assert(prospecCardHtml(C(), { uid: 'u-a', agoraMs: AG, pegando: new Set([1]) }).includes('disabled'), 'Pegar em andamento: desabilitado');
  const dono = prospecCardHtml(L[1], { uid: 'u-x', agoraMs: AG, pegando: new Set() });
  assert(!dono.includes('data-prospec-pegar') && dono.includes('kbCartDono') && dono.includes('Zz'), 'com dono: chip, sem Pegar');
  const fixo = prospecCardHtml(C({ telefone: '1930000000' }), { uid: 'u-a', agoraMs: AG, pegando: new Set() });
  assert(!fixo.includes('data-prospec-whats') && fixo.includes('data-prospec-ligar'), 'fixo: só Ligar');
  assert(!prospecCardHtml(C({ telefone: null, nv_status: 'pendente' }), { uid: 'u-a', agoraMs: AG, pegando: new Set() }).includes('data-prospec-ligar'), 'sem número: sem botões');
  const atras = prospecCardHtml(L[3], { uid: 'u-a', agoraMs: AG, pegando: new Set() });
  assert(atras.includes('kbTag late'), 'retorno vencido: tag late');
  const xss = prospecCardHtml(C({ razao_social: '<img src=x>', socio_nome: '<b>z' }), { uid: 'u-a', agoraMs: AG, pegando: new Set() });
  assert(!xss.includes('<img') && !xss.includes('<b>z'), 'cartão escapa HTML');
  assert(prospecCardHtml(C({ razao_social: null }), { uid: 'u-a', agoraMs: AG, pegando: new Set() }).includes('11.222.333/0001-81'), 'sem razão: CNPJ formatado');

  // ==== ficha ====
  const fDono = prospecFichaHtml(L[1], { uid: 'u-a', admin: false, agoraMs: AG });
  assert(fDono.includes('data-prospec-etapa="venda"') && fDono.includes('id="prospecObs"') && fDono.includes('data-prospec-salvar') && fDono.includes('data-prospec-soltar'), 'dono: edita');
  assert(fDono.includes('linha') && fDono.includes('Encontrado'), 'ficha mostra as colunas originais');
  const fOutro = prospecFichaHtml(L[1], { uid: 'u-x', admin: false, agoraMs: AG });
  assert(!fOutro.includes('data-prospec-salvar') && fOutro.includes('Com Zz A'), 'outro: só leitura');
  assert(prospecFichaHtml(L[1], { uid: 'u-x', admin: true, agoraMs: AG }).includes('data-prospec-salvar'), 'admin edita');
  assert(prospecFichaHtml(C(), { uid: 'u-a', admin: false, agoraMs: AG }).includes('data-prospec-pegar="1"'), 'livre: Pegar na ficha');
  assert(!prospecFichaHtml(C({ dados: { '<x>': '<img src=y>' } }), { uid: 'u-a', admin: false, agoraMs: AG }).includes('<img'), 'ficha escapa dados');

  // __FLUXO__ (Task 3 acrescenta aqui)

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
