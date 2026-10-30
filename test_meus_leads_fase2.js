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
  // ==== Task 3: colunas ====
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  const LQ = [LA('q1', { telefone: '11900000021' }), LA('q2', { cidade: 'Campinas', telefone: '11900000022' }), LA('cv1', { categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)', receita: 100 }), LA('cv2', { categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)', receita: 50.5, cidade: 'Campinas' }),
    LA('pp1', { categoria: 'perdido', status: 'CNPJ INAPTO' }), { aba: 'O', lead_id: 'lv1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato', criado_em_lead: isoC(-3) }];
  window.__rpcRespostas.leads_kanban3 = { data: LQ, error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 1, placar: {} }, error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({ telefone: '11900000021' }, LQ.find(l => l.lead_id === a.p_id) || {})], error: null });
  await kbAplicarPermissao(); await kbCarregar();
  kbTrocarAba('quadro'); await espera(40);
  const col = (c) => document.querySelector('#kbBoard .kbCol[data-kb-col="' + c + '"]');
  assert(!document.getElementById('kbNavQuadro'), 'sai a barra de atalhos das colunas');
  eq(col('andamento').querySelector('.kbColSub').textContent, 'Pela chegada do lead', 'subtítulo explica a coluna');
  assert(col('livres').querySelector('.kbColAcoes [data-kb-pegar-proximo]') && col('livres').querySelector('.kbColAcoes [data-kb-pegar-proximo]').style.display !== 'none', 'Livres com Pegar próximo no cabeçalho');
  assert(col('convertido').classList.contains('kbRecolhida') && col('perdido').classList.contains('kbRecolhida') && !col('convertido').querySelector('.kbCard'), 'Convertido e Perdido começam recolhidos, sem montar cartões');
  assert(col('convertido').querySelector('.kbColFaixa').textContent.includes('2') && col('convertido').querySelector('.kbColFaixa').textContent.includes('150,50'), 'faixa do Convertido com contagem e receita');
  col('convertido').querySelector('[data-kb-abrircol="convertido"]').click();
  assert(!col('convertido').classList.contains('kbRecolhida') && col('convertido').querySelector('.kbCard[data-id="cv1"]') && String(window.localStorage.getItem('kbColAbertas')).includes('"convertido":true'), 'clicar na faixa abre a coluna e guarda');
  col('convertido').querySelector('[data-kb-recolher="convertido"]').click();
  assert(col('convertido').classList.contains('kbRecolhida'), 'Recolher fecha de novo');
  // RF4: filtro ativo com coluna recolhida
  kbEstado.filtros = { cidade: 'Campinas' }; kbAoMudarFiltros();
  assert(col('convertido').querySelector('.kbColFaixa').textContent.includes('1') && col('convertido').querySelector('.kbConta').textContent === '1', 'RF4: faixa recolhida conta só os filtrados');
  kbEstado.filtros = {}; kbAoMudarFiltros();
  // RF6: soltar num Convertido recolhido abre a ficha com o grupo em destaque
  const soltar = (alvoSel, dados) => { const ev = new window.Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: { getData: () => JSON.stringify(dados) } }); document.querySelector(alvoSel).dispatchEvent(ev); };
  const nCls = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length;
  soltar('#kbBoard .kbCol[data-kb-col="convertido"] .kbColFaixa', { aba: 'O', id: 'q1', col: 'andamento' });
  await espera(60);
  assert(kbEstado.fichaAlvo && kbEstado.fichaAlvo.id === 'q1' && document.querySelector('#kbFicha [data-kb-grupo="convertido"]').classList.contains('kbDestaque') && window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length === nCls, 'RF6: soltar no Convertido recolhido abre a ficha com Venda em destaque');
  kbFecharFicha(true);
  // densidade
  kbEstado.densidade = 'compacto'; kbRender();
  assert(document.getElementById('kbBoard').classList.contains('kbCompacto'), 'densidade compacta no Quadro');
  kbEstado.densidade = 'conforto'; kbRender();
  // ==== Task 4: filtros em botões e densidade ====
  const hf = kbFiltroBarraHtml(LQ, { cidade: 'Campinas' }, Date.now(), { densidade: 'conforto' });
  assert(hf.includes('data-kb-menu="cidade"') && hf.includes('class="kbFb on">Cidade: <b>Campinas</b><span class="kbFbX" data-kb-filtro-tirar="cidade"') && hf.includes('class="kbFiltroOp" data-kb-filtro-tirar="cidade">Todos'), 'filtro ativo: botão escuro com o valor, × e opção Todos');
  assert(hf.includes('class="kbFiltroOp ativo" data-kb-filtro="cidade" data-valor="Campinas"') && !hf.includes('<select'), 'opções em lista de botões, sem select');
  assert(hf.includes('data-kb-filtro="ligacao"') && hf.includes('data-kb-densidade="compacto"') && hf.includes('Limpar filtros (1)'), 'Nunca ligado direto, densidade e Limpar');
  assert(kbFiltroBarraHtml([{ aba: 'O', lead_id: 'x', cidade: 'Santos', livre: false }], { cidade: 'Campinas' }, Date.now()).includes('Cidade: <b>Campinas</b>'), 'filtro guardado que sumiu dos leads continua à vista');
  kbTrocarAba('quadro'); kbRenderFiltroBarra();
  const barraF = document.getElementById('kbFiltroBarra');
  assert(!barraF.classList.contains('card'), 'barra de filtros sem caixa');
  barraF.querySelector('[data-kb-filtro="cidade"][data-valor="Campinas"]').click();
  eq(kbEstado.filtros.cidade, 'Campinas', 'clicar na opção liga o filtro');
  barraF.querySelector('.kbFbX[data-kb-filtro-tirar="cidade"]').click();
  assert(!kbEstado.filtros.cidade, 'o × tira o filtro do grupo');
  barraF.querySelector('[data-kb-densidade="compacto"]').click();
  assert(kbEstado.densidade === 'compacto' && document.getElementById('kbBoard').classList.contains('kbCompacto') && window.localStorage.getItem('kbDensidade') === 'compacto', 'densidade compacta aplicada e guardada');
  document.getElementById('kbFiltroBarra').querySelector('[data-kb-densidade="conforto"]').click();
  // menu aberto fecha ao clicar fora
  const menu = document.querySelector('#kbFiltroBarra details[data-kb-menu="cidade"]');
  menu.open = true; document.body.click();
  assert(!menu.open, 'menu de filtro fecha ao clicar fora');
  // ==== Task 5: Lista ====
  eq(document.querySelector('#kbAbas [data-kb-aba="todos"]').textContent.trim(), 'Lista', 'a sub-aba Todos passa a se chamar Lista');
  const LL = [LA('t1', { nome: 'Zz Alfa', cidade: 'Campinas', uf: 'SP', campanha: 'Zz Camp', telefone: '11900000031', retorno_em: kbSomaDias(hojeC, -1), ultima_ligacao: isoC(-120), ultima_atendida: true, ultima_seg: 240, qtd_linhas: '12' }),
    LA('t2', { nome: 'Zz Beta', telefone: '11900000032', ligacoes: 0 }), LA('t3', { nome: 'Zz Gama', categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)' }),
    LA('t4', { nome: 'Zz Delta', categoria: 'perdido', status: 'CLIENTE NÃO RESPONDE' })];
  window.__rpcRespostas.leads_kanban3 = (args) => ({ data: args.p_todos ? LL : LQ, error: null });
  kbEstado.filtros = {};
  kbTrocarAba('todos'); await espera(80);
  const vis = [...document.querySelectorAll('#kbVisoes [data-kb-visao]')];
  eq(vis.map(b => b.dataset.kbVisao), ['todos', 'aberto', 'retornos', 'semlig', 'semresp', 'convertido', 'perdido'], 'visões prontas');
  assert(vis[0].classList.contains('active') && vis[0].textContent.includes('4') && vis[1].textContent.includes('2'), 'visões com contagem');
  vis[1].click();
  eq([...document.querySelectorAll('#kbTodos tbody tr')].map(t => t.dataset.kbAbrir).sort(), ['O|t1', 'O|t2'], 'visão Em aberto filtra a tabela');
  document.querySelector('#kbVisoes [data-kb-visao="todos"]').click();
  const ths = [...document.querySelectorAll('#kbTodos thead th[data-kb-ord]')].map(t => t.textContent.replace(/[▲▼]/g, '').trim());
  eq(ths, ['Empresa', 'Telefone', 'Etapa', 'STATUS', 'Último contato', 'Próximo retorno', 'Linhas', 'Pego em'], 'colunas da Lista (consultor)');
  const lt1 = document.querySelector('#kbTodos tr[data-kb-abrir="O|t1"]');
  // Telefone na Lista: já limpo (sem "P:55"), copia sem abrir a ficha
  const celP = kbCelulaTabela(LA('tp', { telefone: 'P:5511900000039' }), 'telefone', agC);
  assert(celP.includes('data-kb-copiar-tel="11900000039"') && !/P:|55119/.test(celP), 'telefone "P:55..." aparece só com DDD e número');
  assert(kbCelulaTabela(LA('tv', { telefone: '' }), 'telefone', agC).includes('kbMuted'), 'lead sem telefone mostra traço');
  const copiados = []; Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (t) => { copiados.push(t); } }, configurable: true });
  const nFT = window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length;
  lt1.querySelector('.kbTd-telefone [data-kb-copiar-tel]').click();
  await espera(40);
  assert(copiados[0] === '11900000031' && window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length === nFT, 'clicar no telefone copia o número sem abrir a ficha');
  assert(lt1.querySelector('.kbTd-nome').textContent.includes('Campinas/SP · Zz Camp') && lt1.querySelector('.kbTd-etapa .kbEtapa') && lt1.querySelector('.kbTd-status .kbStP'), 'Empresa com cidade e campanha; etapa e STATUS com marcador');
  assert(lt1.querySelector('.kbTd-contato').textContent.includes('atendida · 4 min') && lt1.querySelector('.kbTd-retorno .kbTag.late') && lt1.querySelector('.kbTd-linhas').textContent.trim() === '12', 'último contato, retorno atrasado e linhas');
  assert(document.querySelector('#kbTodos tr[data-kb-abrir="O|t2"] .kbTd-contato').textContent.includes('nunca ligado'), 'nunca ligado');
  assert(!document.querySelector('#kbTodos table').classList.contains('tbl') && document.querySelector('#kbTodos table').classList.contains('kbTabelaTodos'), 'tabela própria da Lista');
  // RF5: Ligar na linha não abre a ficha
  const nF = window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length;
  const abertosL = []; const openL = window.open; window.open = (u) => { abertosL.push(String(u)); return null; };
  lt1.querySelector('.kbLnAcoes [data-kb-whats]').click();
  await espera(40);
  window.open = openL;
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length === nF && abertosL.some(u => u.includes('wa.me/5511900000031')), 'RF5: WhatsApp na linha abre a conversa sem abrir a ficha');
  lt1.querySelector('.kbTd-nome').click();
  await espera(60);
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length === nF + 1, 'clicar na linha abre a ficha');
  kbFecharFicha(true);
  // densidade e gestor
  kbEstado.densidade = 'compacto'; kbRenderTodos();
  assert(document.querySelector('#kbTodos table').classList.contains('kbCompacto'), 'densidade compacta na Lista');
  kbEstado.densidade = 'conforto';
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  kbEstado.todos = LL.map(l => Object.assign({}, l, { dono_nome: 'Zzkcon Teste' })); kbRenderTodos();
  assert([...document.querySelectorAll('#kbTodos thead th[data-kb-ord]')].some(t => t.textContent.includes('Consultor')) && document.querySelector('#kbTodos .kbTd-dono').textContent.includes('Zzkcon'), 'gestor vê a coluna Consultor');
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  // ==== Revisão final da Fase 2: correções ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  kbEstado.filtros = {}; kbEstado.densidade = 'conforto';
  window.__rpcRespostas.leads_kanban3 = { data: LQ, error: null };
  await kbCarregar(); kbTrocarAba('quadro'); await espera(40);
  // F1: "Pegar próximo" com OBS digitada pergunta antes de descartar
  await kbAbrirFicha('O', 'q1');
  document.getElementById('kbClassObs').value = 'Zz anotando';
  let pergF = 0; window.confirm = () => { pergF++; return false; };
  window.__rpcRespostas.leads_pegar = { data: { ok: true }, error: null };
  const nPeg = window.__rpcCalls.filter(c => c.nome === 'leads_pegar').length;
  document.querySelector('#kbBoard .kbCol[data-kb-col="livres"] [data-kb-pegar-proximo]').click();
  await espera(60);
  assert(pergF === 1 && window.__rpcCalls.filter(c => c.nome === 'leads_pegar').length === nPeg && document.getElementById('kbClassObs').value === 'Zz anotando', 'F1: Pegar próximo com OBS digitada pergunta e, com não, não pega');
  window.confirm = () => true;
  document.getElementById('kbClassObs').value = '';
  kbFecharFicha(true);
  // F2: faixa vermelha sempre com texto (cor nunca sozinha)
  const cA = kbCard(LA('fa', { categoria: 'sem_contato', status: null, ligacoes: undefined, criado_em_lead: isoC(-40), pego_em: isoC(-40) }), agC);
  assert(cA.includes('kbAtrasado') && cA.includes('class="kbTag late">sem contato há 40 min'), 'F2: novo sem contato há 40 min: faixa com texto');
  const cB = kbCard(LA('fb', { ligacoes: 0, pego_em: isoC(-60 * 24 * 2) }), agC);
  assert(cB.includes('kbAtrasado') && cB.includes('class="kbTag late">nunca ligado · pego há 2 dias'), 'F2: Sem ligação há mais de 1 dia: faixa com texto');
  // F3: filtro e densidade escolhidos na Lista valem ao voltar para o Quadro
  kbTrocarAba('todos'); await espera(60);
  kbEstado.filtros = { cidade: 'Campinas' }; kbAoMudarFiltros();
  document.querySelector('#kbFiltroBarra [data-kb-densidade="compacto"]').click();
  kbTrocarAba('quadro');
  assert(document.getElementById('kbBoard').classList.contains('kbCompacto') && document.querySelector('#kbBoard .kbCol[data-kb-col="andamento"] .kbConta').textContent === '1', 'F3: filtro e densidade da Lista valem ao voltar para o Quadro');
  kbEstado.filtros = {}; kbAoMudarFiltros();
  document.querySelector('#kbFiltroBarra [data-kb-densidade="conforto"]').click();
  // F4: em tela de toque as ações ficam à vista (não há toque invisível registrando contato)
  const cssF = [...document.querySelectorAll('style')].map(s => s.textContent).join('\\n');
  assert(cssF.includes('@media (hover:none){ .kbCartAcoes,.kbLnAcoes{opacity:1;} }'), 'F4: ações visíveis em tela de toque');
  // F5: cartão abre pelo teclado
  const cardK = document.querySelector('#kbBoard .kbCard[data-id="q2"]');
  assert(cardK && cardK.getAttribute('tabindex') === '0', 'F5: cartão focável pelo teclado');
  const nFK = window.__rpcCalls.filter(c => c.nome === 'leads_ficha' && c.args.p_id === 'q2').length;
  cardK.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await espera(60);
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_ficha' && c.args.p_id === 'q2').length === nFK + 1, 'F5: Enter no cartão abre a ficha');
  kbFecharFicha(true);
  // F6: menu de filtro aberto continua aberto quando os dados mudam; escolher uma opção fecha
  kbRenderFiltroBarra();
  document.querySelector('#kbFiltroBarra details[data-kb-menu="cidade"]').open = true;
  kbEstado.leads = kbEstado.leads.concat([LA('novoZ', { cidade: 'Sumaré' })]); kbRenderFiltroBarra();
  assert(document.querySelector('#kbFiltroBarra details[data-kb-menu="cidade"]').open && document.getElementById('kbFiltroBarra').textContent.includes('Sumaré'), 'F6: menu aberto continua aberto quando os dados mudam');
  document.querySelector('#kbFiltroBarra [data-kb-filtro="cidade"][data-valor="Sumaré"]').click();
  assert(kbEstado.filtros.cidade === 'Sumaré' && !document.querySelector('#kbFiltroBarra details[data-kb-menu="cidade"]').open, 'F6: escolher uma opção fecha o menu');
  kbEstado.filtros = {}; kbAoMudarFiltros();
  eq([kbTempoDesde(new Date(agC - 86400000 - 60000).toISOString(), agC), kbTempoDesde(new Date(agC - 3 * 86400000).toISOString(), agC)], ['há 1 dia', 'há 3 dias'], 'singular: há 1 dia');
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
