// Testa o §126.2 (redesign de Meus leads, Fase 2: Quadro e Lista).
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
  // ==== Task 1: funções puras ====
  const ag = SP('2026-10-28T15:00:00');
  const LA = (id, o) => Object.assign({ aba: 'O', lead_id: id, nome: 'Zz ' + id, livre: false, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', ligacoes: 1, criado_em_lead: '2026-10-20T10:00:00-03:00', pego_em: '2026-10-20T10:00:00-03:00' }, o);
  eq([kbIniciais('Zzkcon Teste'), kbIniciais('caio'), kbIniciais('  zz  meio  fim '), kbIniciais(null)], ['ZT', 'C', 'ZF', ''], 'iniciais do dono');
  eq([kbRetornoFaixa(LA('a', { retorno_em: '2026-10-27' }), ag), kbRetornoFaixa(LA('b', { retorno_em: '2026-10-28' }), ag), kbRetornoFaixa(LA('c', { retorno_em: '2026-10-30' }), ag), kbRetornoFaixa(LA('d'), ag)],
     ['late', 'hoje', 'fut', null], 'faixa do retorno pela data');
  eq([kbUrgenciaCartao(LA('a', { retorno_em: '2026-10-27' }), ag), kbUrgenciaCartao(LA('d'), ag), kbUrgenciaCartao(LA('c', { categoria: 'convertido' }), ag), kbUrgenciaCartao(LA('l', { livre: true, categoria: 'sem_contato' }), ag)],
     ['late', 'nada', null, null], 'ícone de urgência só em lead em aberto');
  eq([kbFaixaVermelha(LA('a', { retorno_em: '2026-10-27' }), ag),
      kbFaixaVermelha(LA('s1', { ligacoes: 0, pego_em: '2026-10-26T10:00:00-03:00' }), ag),
      kbFaixaVermelha(LA('s2', { ligacoes: 0, pego_em: '2026-10-28T13:00:00-03:00' }), ag),
      kbFaixaVermelha(LA('n', { categoria: 'sem_contato', status: null, ligacoes: undefined, criado_em_lead: '2026-10-28T14:40:00-03:00' }), ag),
      kbFaixaVermelha(LA('d'), ag),
      kbFaixaVermelha(LA('p', { categoria: 'perdido', status: 'CNPJ INAPTO', retorno_em: '2026-10-27' }), ag)],
     [true, true, false, true, false, false], 'faixa vermelha: retorno vencido, Sem ligação há mais de 1 dia, novo sem contato há 15+ min; nunca em perdido');
  eq([kbRetornoTag(LA('a', { retorno_em: '2026-10-27' }), ag), kbRetornoTag(LA('a', { retorno_em: '2026-10-25' }), ag), kbRetornoTag(LA('b', { retorno_em: '2026-10-28' }), ag), kbRetornoTag(LA('c', { retorno_em: '2026-10-30' }), ag), kbRetornoTag(LA('d'), ag)],
     [{ classe: 'late', texto: 'retorno ontem · atrasado' }, { classe: 'late', texto: 'retorno 25/10 · atrasado' }, { classe: 'ok', texto: 'retorno hoje' }, { classe: '', texto: 'retorno 30/10' }, null], 'etiqueta do retorno');
  const lv = (min) => ({ livre: true, criado_em_lead: new Date(ag - min * 60000).toISOString() });
  eq([kbCorIdadeLivre(lv(3), ag), kbCorIdadeLivre(lv(10), ag), kbCorIdadeLivre(lv(20), ag), kbCorIdadeLivre(lv(40), ag), kbCorIdadeLivre({ livre: true }, ag)], ['novo', '', 'soon', 'late', ''], 'cor da idade do livre');
  const LV = [LA('a1', { retorno_em: '2026-10-29' }), LA('a2'), LA('s1', { ligacoes: 0 }), LA('n1', { categoria: 'sem_contato', status: null, ligacoes: undefined }),
    LA('r1', { categoria: 'perdido', status: 'CLIENTE NÃO RESPONDE' }), LA('c1', { categoria: 'convertido' }), LA('p1', { categoria: 'perdido', status: 'CNPJ INAPTO' })];
  eq(kbContarVisoes(LV), { todos: 7, aberto: 4, retornos: 1, semlig: 1, semresp: 1, convertido: 1, perdido: 1 }, 'contagem das visões da Lista');
  eq(LV.filter(l => kbNaVisao(l, 'aberto')).map(l => l.lead_id), ['a1', 'a2', 's1', 'n1'], 'Em aberto = Meus novos, Sem ligação e Em andamento');
  eq(KB_VISOES.map(v => v[1]), ['Todos', 'Em aberto', 'Retornos', 'Sem ligação', 'Sem resposta', 'Convertidos', 'Perdidos'], 'nomes das visões');
  kbEstado.colAbertas = {};
  eq([kbColAberta('convertido'), kbColAberta('perdido'), kbColAberta('andamento')], [false, false, true], 'Convertido e Perdido começam recolhidos');
  kbEstado.colAbertas = { perdido: true }; kbSalvarColAbertas();
  eq([kbColAberta('perdido'), kbLerColAbertas()], [true, { perdido: true }], 'abrir o Perdido fica guardado');
  window.localStorage.setItem('kbDensidade', 'compacto');
  eq(kbLerDensidade(), 'compacto', 'densidade guardada');
  const lsReal = window.localStorage;
  Object.defineProperty(window, 'localStorage', { get(){ throw new Error('bloqueado'); }, configurable: true });
  eq([kbLerDensidade(), kbLerColAbertas()], ['conforto', {}], 'RF3: localStorage bloqueado volta ao padrão');
  kbSalvarDensidade(); kbSalvarColAbertas();
  Object.defineProperty(window, 'localStorage', { value: lsReal, configurable: true, writable: true });
  window.localStorage.removeItem('kbDensidade'); window.localStorage.removeItem('kbColAbertas'); kbEstado.colAbertas = {};
  // ==== Task 2: cartão novo ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  kbEstado.podePegar = true;
  const agC = Date.now(), isoC = (min) => new Date(agC + min * 60000).toISOString(), hojeC = kbDiaSP(agC);
  const c1 = kbCard(LA('c1', { retorno_em: kbSomaDias(hojeC, -1), qtd_linhas: '6', cidade: 'Campinas', uf: 'SP', telefone: '11900000011', obs: 'Zz pediu proposta <b>',
    ultima_ligacao: isoC(-120), ultima_atendida: true, ultima_seg: 95, criado_em_lead: isoC(-60 * 24 * 4) }), agC);
  assert(c1.includes('class="kbCard kbAtrasado"') && c1.includes('kbUrg kbUrg-late'), 'retorno vencido: faixa vermelha e ícone vermelho');
  assert(c1.includes('class="kbStP" data-st="em-negociacao"') && c1.includes('>Em negociaçâo<'), 'STATUS como ponto + texto em frase normal (a planilha grava NEGOCIAÇÂO)');
  assert(c1.includes('Campinas/SP · 6 linhas') && c1.includes('retorno ontem · atrasado') && c1.includes('Ligou há 2 h') && c1.includes('atendida · 1 min 35 s') && c1.includes('há 4 dias'), 'cartão em 3 níveis: meta, retorno, última ligação e chegada');
  assert(c1.includes('Zz pediu proposta &lt;b&gt;') && c1.includes('data-kb-contato="ligar"') && c1.includes('data-kb-whats') && !c1.includes('wa.me') && !c1.includes('data-kb-classificar'), 'OBS escapada; Ligar e WhatsApp sem link pronto; sem link Classificar');
  const c2 = kbCard(LA('c2', { retorno_em: kbSomaDias(hojeC, 2) }), agC);
  assert(!c2.includes('kbAtrasado') && c2.includes('kbUrg-fut') && c2.includes('retorno ' + kbSomaDias(hojeC, 2).slice(8, 10) + '/'), 'retorno marcado: sem faixa, ícone cinza');
  assert(kbCard(LA('c3'), agC).includes('kbUrg-nada') && kbCard(LA('c4', { categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)', receita: 899.9, venda_neo: true }), agC).includes('✓ NEO'), 'nada agendado (amarelo); convertido com receita e NEO, sem ícone');
  assert(!kbCard(LA('c5', { categoria: 'convertido' }), agC).includes('kbUrg'), 'convertido sem ícone de urgência');
  const cl = kbCard({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato', cidade: 'Jundiaí', uf: 'SP', qtd_linhas: '10', criado_em_lead: isoC(-40) }, agC);
  assert(cl.includes('kbCardLivre') && cl.includes('data-kb-pegar') && cl.includes('kbTag late') && cl.includes('Jundiaí/SP · 10 linhas') && !cl.includes('kbUrg'), 'livre: cidade, linhas, idade com cor e Pegar');
  kbEstado.podePegar = false;
  assert(!kbCard({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, agC).includes('data-kb-pegar'), 'quem não pega não vê Pegar');
  kbEstado.podePegar = true;
  // RF1/RF2: campos vazios, STATUS antigo, HTML
  const cv = kbCard({ aba: 'O', lead_id: 'v', nome: null, livre: false, categoria: 'andamento', status: 'STATUS ANTIGO QUALQUER', ligacoes: 1 }, agC);
  assert(!/undefined|>null</.test(cv) && cv.includes('(sem nome)') && cv.includes('Status antigo qualquer'), 'RF1: cartão sem undefined/null e com status antigo em texto');
  const cx = kbCard({ aba: 'O', lead_id: 'x', nome: '<img src=x onerror=alert(1)>', obs: '<script>zz</script>', status: '<b>zz</b>', livre: false, categoria: 'andamento', ligacoes: 1 }, agC);
  assert(!cx.includes('<img') && !cx.includes('<script>') && !cx.includes('<b>zz'), 'RF2: cartão escapa nome, OBS e status');
  // gestor: iniciais e nome do dono
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  const cg = kbCard(LA('g1', { dono_nome: 'Zzkcon Teste' }), agC);
  assert(cg.includes('title="Com Zzkcon Teste"') && cg.includes('<b>ZT</b>Zzkcon'), 'gestor vê as iniciais e o primeiro nome do dono');
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
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
