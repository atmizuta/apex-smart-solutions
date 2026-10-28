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

  // ==== Task 9: tela do consultor ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.leads_equipe = [{ id: 1 }];
  window.__tabelas.config = [{ valor: 'planilha' }];
  await kbAplicarPermissao();
  assert(document.getElementById('tabBtnMeusLeads').style.display === 'none', 'antes da virada (modo planilha) consultor não vê a aba');
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'AGENDADO RETORNO', grupo: 'andamento', ordem: 2 },
    { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  window.__rpcRespostas.leads_kanban3 = { data: [L('n1', { livre: true, telefone: null }), L('m1', { telefone: '11900000001' })], error: null };
  await kbAplicarPermissao();
  assert(document.getElementById('tabBtnMeusLeads').style.display !== 'none', 'consultor da equipe vê a aba');
  await kbCarregar();
  const colLivres = document.querySelector('#kbBoard [data-kb-col="livres"]');
  assert(colLivres && colLivres.textContent.includes('Zz n1'), 'Livres renderiza o lead livre');
  assert(!colLivres.textContent.includes('11900000001'), 'Livres sem telefone');
  assert(document.querySelector('#kbBoard [data-kb-col="novos"]').textContent.includes('Zz m1'), 'Meus novos renderiza o meu lead');
  // pegar com sucesso move o card; pegar perdido avisa e recarrega
  window.__rpcRespostas.leads_pegar = { data: { ok: true, consultor: 'ZZKCON' }, error: null };
  window.__rpcRespostas.leads_kanban3 = { data: [L('n1', { livre: false, telefone: '11900000009' }), L('m1')], error: null };
  await kbPegar('OUTUBRO', 'n1');
  assert(window.__rpcCalls.some(c => c.nome === 'leads_pegar' && c.args.p_id === 'n1'), 'chamou leads_pegar');
  assert(document.querySelector('#kbBoard [data-kb-col="novos"]').textContent.includes('Zz n1'), 'depois de pegar vai para Meus novos');
  window.__rpcRespostas.leads_pegar = { data: { ok: false, dono: 'Fulana Zz' }, error: null };
  await kbPegar('OUTUBRO', 'n1');
  assert([...window.__alertas, document.body.textContent].join(' ').includes('Esse lead já foi pego por Fulana Zz'), 'aviso de lead já pego');
  // §126: classificar abre a ficha (sem janela) com o grupo da coluna em destaque e valida
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [L(a.p_id, { telefone: '11900000001' })], error: null });
  await kbAbrirClassificar('OUTUBRO', 'm1', 'perdido');
  eq([...document.querySelectorAll('#kbFicha #kbClassStatus option')].map(o => o.value).filter(Boolean), ['EM NEGOCIAÇÂO', 'AGENDADO RETORNO', 'PEDIDO CONCLUIDO (VENDA)', 'CNPJ INAPTO'], 'a ficha traz todas as tabulações');
  assert(document.querySelector('#kbFicha [data-kb-grupo="perdido"]').classList.contains('kbDestaque'), 'arrastar para Perdido destaca o grupo de perda');
  document.getElementById('kbClassStatus').value = 'CNPJ INAPTO';
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  await kbSalvarClassificacao();
  const call = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').pop();
  eq([call.args.p_aba, call.args.p_id, call.args.p_status], ['OUTUBRO', 'm1', 'CNPJ INAPTO'], 'classificar manda aba/id/status');
  await kbAbrirClassificar('OUTUBRO', 'm1', null);
  document.getElementById('kbClassStatus').value = 'AGENDADO RETORNO';
  document.getElementById('kbClassRetorno').value = '';
  const antes = window.__rpcCalls.length;
  await kbSalvarClassificacao();
  assert(window.__rpcCalls.length === antes, 'AGENDADO RETORNO sem data não chama o banco');
  assert(document.getElementById('kbClassErro').textContent.includes('data do retorno'), 'mostra o erro na ficha');
  kbFecharFicha();
  // retorno rápido grava em leads_followups como a tela antiga (§64); perdido "para resgatar" ganha selo
  window.__rpcRespostas.leads_kanban3 = { data: [L('a1', { categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001' }),
    L('p1', { categoria: 'perdido', status: 'CLIENTE NÃO RESPONDE', classificado_em: new Date().toISOString() })], error: null };
  await kbCarregar();
  kbEstado.perdidoAberto = true; kbRender();   // §120: o Perdido só monta os cartões quando é aberto
  assert(document.querySelector('#kbBoard .kbCol[data-kb-col="semresp"] [data-id="p1"]').textContent.includes('para resgatar'), 'selo para resgatar (pedido 28/10: na coluna Sem resposta)');
  // ajuste 26/10: retorno rápido saiu do cartão e foi para a ficha do lead
  assert(kbFichaHtml(L('a1', { categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001' }), { gestor: false, agoraMs: Date.now() }).includes('>Em 3 dias</button>'), 'ficha de lead em andamento tem o atalho Em 3 dias');
  // versão leve: igual não recarrega; mudou recarrega
  window.__rpcRespostas.leads_kanban_versao_dono = { data: 'v1', error: null };   // §120: versão por consultor
  assert(await kbVerificarVersao() === true, 'versão nova recarrega');
  const nCarga = window.__rpcCalls.filter(c => c.nome === 'leads_kanban3').length;
  assert(await kbVerificarVersao() === false, 'versão igual não recarrega');
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_kanban3').length === nCarga, 'não chamou leads_kanban de novo');
  // consultor fora da equipe não vê a aba
  window.__tabelas.leads_equipe = [];
  await kbAplicarPermissao();
  assert(document.getElementById('tabBtnMeusLeads').style.display === 'none', 'fora da equipe não vê');

  // ==== Task 10: supervisão ====
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__tabelas.leads_equipe = [{ profile_id: 'u-zz', nome_planilha: 'ZZKCON' }, { profile_id: 'u-zz2', nome_planilha: 'ZZOUTRA' }];
  window.__rpcRespostas.leads_kanban3 = { data: [L('m1', { dono_id: 'u-zz', dono_nome: 'Zzkcon Teste', telefone: '11900000001' }), L('d1', { categoria: 'convertido', converteu: true, venda_neo: false, dono_id: 'u-zz' })], error: null };
  await kbAplicarPermissao();
  await kbCarregarFiltros();
  assert(document.getElementById('kbFiltrosGestor').style.display !== 'none', 'gestor vê filtros');
  eq([...document.querySelectorAll('#kbDono option')].map(o => o.value), ['', 'u-zz', 'u-zz2'], 'seletor de consultor: Todos + equipe');
  await kbCarregar();
  assert(document.querySelector('#kbBoard [data-id="m1"]').textContent.includes('Com Zzkcon Teste'), 'card mostra com quem está');
  document.getElementById('kbSoDiverg').click();
  assert(!document.querySelector('#kbBoard [data-id="m1"]') && document.querySelector('#kbBoard [data-id="d1"]'), 'filtro de divergências');
  document.getElementById('kbSoDiverg').click();
  window.__rpcRespostas.leads_redistribuir = { data: null, error: null };
  kbAbrirRedistribuir('OUTUBRO', 'm1');
  document.getElementById('kbRedNovo').value = 'u-zz2';
  await kbSalvarRedistribuicao();
  const red = window.__rpcCalls.filter(c => c.nome === 'leads_redistribuir').pop();
  eq([red.args.p_id, red.args.p_novo], ['m1', 'u-zz2'], 'redistribuir manda o novo dono');
  window.__rpcRespostas.leads_kanban_resumo = { data: [{ livres: 4, livre_mais_antigo: '2026-10-26T11:00:00Z', fila_pendente: 0, fila_mais_antiga: null, aviso: 'Crie a guia de NOVEMBRO na planilha' }], error: null };
  const card = await kbMesaCard();
  assert(card.includes('4 livre') && card.includes('Crie a guia de NOVEMBRO'), 'card da Mesa com livres e aviso');

  // ==== Revisão final (crítico 1): os modais fecham de verdade depois de Salvar/Cancelar ====
  const aberto = (id) => { const el = document.getElementById(id); return el.classList.contains('active') || el.style.display === 'flex'; };
  window.__rpcRespostas.leads_kanban3 = { data: [L('m9', { dono_id: 'u-zz', telefone: '11900000001' })], error: null };
  await kbCarregar();
  window.__rpcRespostas.leads_ficha = { data: [L('m9', { dono_id: 'u-zz', telefone: '11900000001', obs: 'Zz obs antiga' })], error: null };
  await kbAbrirClassificar('OUTUBRO', 'm9', 'perdido');
  assert(document.getElementById('kbFicha').classList.contains('aberta'), 'Classificar abre a ficha (não há mais janela)');
  document.getElementById('kbClassStatus').value = 'CNPJ INAPTO';
  document.getElementById('kbClassObs').value = 'Zz obs nova';
  await kbSalvarClassificacao();
  await espera(60);
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_classificar').pop().args.p_obs, 'Zz obs nova', 'OBS digitada vai para o banco');
  assert(document.getElementById('kbClassObs').value === '', 'depois de salvar a ficha reabre com a OBS em branco');
  kbFecharFicha();
  kbAbrirRedistribuir('OUTUBRO', 'm9');
  assert(aberto('kbRedOverlay'), 'Redistribuir abre');
  document.getElementById('kbRedCancelar').click();
  await espera(200);
  assert(!aberto('kbRedOverlay'), 'Redistribuir fecha no Cancelar');
  // ==== Revisão final: receita com ponto decimal; card da Mesa só depois da virada ====
  eq([kbNumeroBR('1234.56'), kbNumeroBR('1.234'), kbNumeroBR('1.234,50'), kbNumeroBR('99,9'), kbNumeroBR('1.234.567')], [1234.56, 1234, 1234.5, 99.9, 1234567], 'receita: ponto decimal, milhar e formato BR');
  kbEstado.modo = 'planilha';
  eq(await kbMesaCard(), '', 'antes da virada a Mesa não mostra o card (números ainda não valem)');
  kbEstado.modo = 'painel';
  // ==== Ajuste de design (26/10 noite): arrastar para pegar + ficha do lead ====
  eq([kbAcaoDoArraste('livres', 'novos'), kbAcaoDoArraste('livres', 'andamento'), kbAcaoDoArraste('novos', 'andamento'),
      kbAcaoDoArraste('andamento', 'perdido'), kbAcaoDoArraste('novos', 'livres'), kbAcaoDoArraste('andamento', 'andamento'), kbAcaoDoArraste('perdido', 'novos')],
     ['pegar', null, 'classificar', 'classificar', null, null, null], 'regra do arraste: Livres→Meus novos pega; meus leads→etapas classificam; resto não aceita');
  const fichaMeu = { aba: 'OUTUBRO', lead_id: 'f1', nome: 'Zz Padaria', cidade: 'Campinas', uf: 'SP', qtd_linhas: '5', tipo_empresa: 'MEI',
    telefone: '11900000001', email: 'zz@teste.invalid', cnpj: '00000000000101', status: 'EM NEGOCIAÇÂO', categoria: 'andamento', obs: 'ligar à tarde',
    campanha: 'Zz Campanha', criado_em_lead: '2026-10-26T12:00:00Z', livre: false, dono_nome: 'Zzkcon Teste', venda_neo: false, converteu: false };
  const h1 = kbFichaHtml(fichaMeu, { gestor: false, agoraMs: Date.parse('2026-10-26T13:00:00Z') });
  ['Zz Padaria', '00000000000101', '11900000001', 'zz@teste.invalid', 'Campinas/SP', '5', 'MEI', 'Zz Campanha', 'ligar à tarde'].forEach(x => assert(h1.includes(x), 'ficha do meu lead mostra ' + x));
  assert(h1.includes('data-kb-ficha-copiar') && h1.includes('wa.me/5511900000001'), 'ficha tem copiar e WhatsApp');
  const h2 = kbFichaHtml(Object.assign({}, fichaMeu, { livre: true, telefone: null, email: null, cnpj: null, status: null, categoria: 'sem_contato' }), { gestor: false, agoraMs: Date.now() });
  assert(h2.includes('aparecem quando você pega o lead') && h2.includes('data-kb-ficha-pegar') && !h2.includes('11900000001'), 'ficha de lead Livre esconde contato e oferece Pegar');
  assert(!kbFichaHtml(Object.assign({}, fichaMeu, { nome: '<img src=x onerror=alert(1)>' }), { gestor: false, agoraMs: Date.now() }).includes('<img'), 'ficha escapa HTML');
  assert(kbAtrasado(L('t1', { criado_em_lead: '2026-10-26T12:00:00Z' }), Date.parse('2026-10-26T12:20:00Z')) === true, 'novo sem contato há 20 min = atrasado');
  assert(kbAtrasado(L('t2', { criado_em_lead: '2026-10-26T12:00:00Z', primeiro_clique: '2026-10-26T12:05:00Z' }), Date.parse('2026-10-26T12:20:00Z')) === false, 'com contato não fica atrasado');
  // arrastar dos Livres para Meus novos pega o lead
  window.__rpcRespostas.leads_kanban3 = { data: [L('lv1', { livre: true })], error: null };
  await kbCarregar();
  window.__rpcRespostas.leads_pegar = { data: { ok: true, consultor: 'ZZKCON' }, error: null };
  const antesPegar = window.__rpcCalls.filter(c => c.nome === 'leads_pegar').length;
  const cardLv = document.querySelector('#kbBoard .kbCard[data-id="lv1"]');
  assert(cardLv && cardLv.getAttribute('draggable') === 'true', 'cartão dos Livres pode ser arrastado');
  const soltar = (alvoSel, dados) => {
    const ev = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { getData: () => JSON.stringify(dados) } });
    document.querySelector(alvoSel).dispatchEvent(ev);
  };
  soltar('#kbBoard [data-kb-col="novos"]', { aba: 'OUTUBRO', id: 'lv1', col: 'livres' });
  await espera(50);
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_pegar').length === antesPegar + 1, 'soltar em Meus novos chama leads_pegar');
  soltar('#kbBoard [data-kb-col="perdido"]', { aba: 'OUTUBRO', id: 'lv1', col: 'livres' });
  await espera(50);
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_pegar').length === antesPegar + 1 && !document.getElementById('kbFicha').classList.contains('aberta'), 'soltar Livre em Perdido não faz nada');
  // clicar no cartão abre a ficha (busca leads_ficha)
  window.__rpcRespostas.leads_kanban3 = { data: [L('f1', { telefone: '11900000001' })], error: null };
  await kbCarregar();
  window.__rpcRespostas.leads_ficha = { data: [fichaMeu], error: null };
  document.querySelector('#kbBoard .kbCard[data-id="f1"] .kbNome').click();
  await espera(50);
  assert(window.__rpcCalls.some(c => c.nome === 'leads_ficha' && c.args.p_id === 'f1'), 'clique no cartão busca a ficha');
  assert(document.getElementById('kbFicha').classList.contains('aberta') && document.getElementById('kbFicha').textContent.includes('00000000000101'), 'ficha abre com o CNPJ');
  document.querySelector('#kbFicha [data-kb-ficha-fechar]').click();
  assert(!document.getElementById('kbFicha').classList.contains('aberta'), 'ficha fecha');
  // ==== Acabamento do visual: celular e receita no formato brasileiro ====
  eq([kbFoneBR('11900000003'), kbFoneBR('5511900000003'), kbFoneBR('1133334444'), kbFoneBR('123'), kbFoneBR('')], ['(11) 90000-0003', '(11) 90000-0003', '(11) 3333-4444', '123', ''], 'celular formatado');
  eq([kbMoeda(899.9), kbMoeda(1234.5), kbMoeda(0)], ['R$ 899,90', 'R$ 1.234,50', ''], 'receita em reais');
  assert(kbFichaHtml(fichaMeu, { gestor: false, agoraMs: Date.now() }).includes('(11) 90000-0001'), 'ficha mostra o celular formatado');
  // ==== Receita total do consultor no topo (27/10) ====
  const rr = kbResumoMes([L('v1', { categoria: 'convertido', converteu: true, receita: 899.9 }), L('v2', { categoria: 'convertido', converteu: true, receita: 100.1 }),
    L('v3', { categoria: 'perdido', receita: 50 }), L('v4', { livre: true, receita: 0 }), L('v5', { categoria: 'andamento' })]);
  eq([rr.vendas, rr.receita, rr.abertos], [2, 1000, 1], 'resumo: vendas e receita só dos convertidos; abertos = andamento + novos (sem Livres)');
  window.__rpcRespostas.leads_kanban3 = { data: [L('v1', { categoria: 'convertido', converteu: true, receita: 899.9 })], error: null };
  await kbCarregar();
  assert(document.getElementById('kbResumo').textContent.includes('R$') && document.getElementById('kbResumo').textContent.includes('899,90') && document.getElementById('kbResumo').textContent.includes('1 venda'), 'topo mostra a receita do mês');
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
