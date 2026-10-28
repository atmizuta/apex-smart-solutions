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
  // ==== Task 4 ====
  const ag4 = SP('2026-10-28T15:00:00');   // quarta
  const L4 = [
    { aba: 'OUTUBRO', lead_id: 'a', nome: 'Zz A', categoria: 'andamento', livre: false, ligacoes: 0, pego_em: '2026-10-28T10:00:00-03:00', retorno_em: '2026-10-27', cidade: 'Campinas', qtd_linhas: '1 a 5', tipo_empresa: 'MEI', campanha: 'Zz C1', formulario: 'Zz F1' },
    { aba: 'OUTUBRO', lead_id: 'b', nome: 'Zz B', categoria: 'andamento', livre: false, ligacoes: 2, ultima_ligacao: '2026-10-25T10:00:00-03:00', retorno_em: '2026-10-28', cidade: 'Santos', qtd_linhas: '6 a 10', tipo_empresa: 'LTDA', campanha: 'Zz C2', formulario: 'Zz F1' },
    { aba: 'SETEMBRO', lead_id: 'c', nome: 'Zz C', categoria: 'sem_contato', livre: false, ligacoes: 1, ultima_ligacao: '2026-10-20T10:00:00-03:00', retorno_em: '2026-11-01', cidade: 'Campinas', qtd_linhas: '1 a 5', tipo_empresa: 'MEI', campanha: 'Zz C1', formulario: 'Zz F2' },
    { aba: 'OUTUBRO', lead_id: 'l', nome: 'Zz Livre', categoria: 'sem_contato', livre: true, ligacoes: 0, cidade: 'Campinas', qtd_linhas: '1 a 5', campanha: 'Zz C1', formulario: 'Zz F1' },
  ];
  const ids = (ls) => ls.map(l => l.lead_id).join(',');
  eq(ids(kbFiltrar(L4, { parado: 'hoje' }, ag4)), 'a,l', 'parado hoje (livre não é filtrado por parado)');
  eq(ids(kbFiltrar(L4, { parado: '3-4' }, ag4)), 'b,l', 'parado 3–4 dias');
  eq(ids(kbFiltrar(L4, { parado: '5+' }, ag4)), 'c,l', 'parado 5+ dias');
  eq(ids(kbFiltrar(L4, { ligacao: 'nunca' }, ag4)), 'a,l', 'nunca ligado');
  eq(ids(kbFiltrar(L4, { retorno: 'atrasado' }, ag4)), 'a,l', 'retorno atrasado');
  eq(ids(kbFiltrar(L4, { retorno: 'hoje' }, ag4)), 'b,l', 'retorno hoje');
  eq(ids(kbFiltrar(L4, { retorno: 'semana' }, ag4)), 'b,c,l', 'retorno esta semana (hoje até domingo 01/11)');
  eq(ids(kbFiltrar(L4, { cidade: 'Campinas', linhas: '1 a 5' }, ag4)), 'a,c,l', 'filtros se somam');
  eq(ids(kbFiltrar(L4, { cidade: 'Campinas', mes: 'OUTUBRO', campanha: 'Zz C1', formulario: 'Zz F1', tipo: 'MEI' }, ag4)), 'a', 'origem, mês e tipo');
  eq(kbOpcoesFiltro(L4, 'parado', {}, ag4).map(o => o.valor + ':' + o.n).join(' '), 'hoje:1 1-2:0 3-4:1 5+:1', 'contagem por opção (sem livres)');
  eq(kbOpcoesFiltro(L4, 'cidade', { linhas: '6 a 10' }, ag4).map(o => o.valor + ':' + o.n).join(' '), 'Santos:1', 'contagem respeita os outros filtros');
  eq(kbFiltrar(L4, { parado: '1-2' }, ag4).filter(l => !l.livre).length, 0, 'filtro que zera (Review Focus 5)');
  // tela: barra aparece no Quadro, filtra as colunas, Limpar volta, guarda no navegador
  kbEstado.leads = L4.map(l => Object.assign({}, l, { criado_em_lead: '2026-10-20T10:00:00-03:00' }));
  kbTrocarAba('quadro');
  kbRender();
  const barra = document.getElementById('kbFiltroBarra');
  assert(barra.style.display !== 'none' && barra.querySelector('[data-kb-filtro="parado"][data-valor="5+"]'), 'barra de filtros no Quadro');
  barra.querySelector('[data-kb-filtro="parado"][data-valor="5+"]').click();
  eq(kbEstado.filtros.parado, '5+', 'clicar no botão liga o filtro');
  eq(document.querySelector('#kbBoard .kbCol[data-kb-col="novos"] .kbConta').textContent, '1', 'coluna filtrada');
  eq(document.querySelector('#kbBoard .kbCol[data-kb-col="andamento"] .kbConta').textContent, '0', 'coluna zerada mostra 0');
  const cidadeSel = barra.querySelector('select[data-kb-filtro="cidade"]');
  cidadeSel.value = 'Campinas'; cidadeSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(kbEstado.filtros.cidade, 'Campinas', 'select liga o filtro');
  assert(String(window.localStorage.getItem('kbFiltros')).includes('Campinas'), 'filtros guardados no navegador');
  barra.querySelector('[data-kb-filtro-limpar]').click();
  eq(Object.keys(kbEstado.filtros).length, 0, 'Limpar zera os filtros');
  window.localStorage.setItem('kbFiltros', '{"cidade":"Santos"}');
  eq(kbLerFiltros(), { cidade: 'Santos' }, 'lê os filtros guardados');
  Object.defineProperty(window, 'localStorage', { get(){ throw new Error('bloqueado'); }, configurable: true });
  eq(kbLerFiltros(), {}, 'localStorage bloqueado não quebra (Review Focus 5)');
  kbSalvarFiltros();
  delete window.localStorage;   // volta para o localStorage do jsdom (getter do protótipo)
  kbEstado.filtros = {};
  kbTrocarAba('hoje');
  assert(document.getElementById('kbFiltroBarra').style.display === 'none', 'barra some fora do Quadro/Todos');
  // ==== Task 5 ====
  const ag5 = SP('2026-10-28T15:00:00');
  const L5 = [
    { aba: 'O', lead_id: 'n1', nome: 'Zz Novo Ligado', categoria: 'sem_contato', livre: false, ligacoes: 1, pego_em: '2026-10-28T09:00:00-03:00', ultima_ligacao: '2026-10-28T09:10:00-03:00' },
    { aba: 'O', lead_id: 'n2', nome: 'Zz Nunca Ligado', categoria: 'sem_contato', livre: false, ligacoes: 0, pego_em: '2026-10-28T08:00:00-03:00' },
    { aba: 'O', lead_id: 'a1', nome: 'Zz Parado', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, ligacoes: 3, ultima_ligacao: '2026-10-22T10:00:00-03:00' },
    { aba: 'O', lead_id: 'a2', nome: 'Zz Andando', categoria: 'andamento', status: 'PROPOSTA ENVIADA', livre: false, ligacoes: 2, ultima_ligacao: '2026-10-28T11:00:00-03:00' },
    { aba: 'O', lead_id: 'c1', nome: 'Zz Venda', categoria: 'convertido', livre: false, receita: 199.9, classificado_em: '2026-10-10T10:00:00-03:00' },
    { aba: 'O', lead_id: 'l1', nome: 'Zz Livre', categoria: 'sem_contato', livre: true, ligacoes: 0 },
  ];
  const R5 = [
    { aba: 'O', lead_id: 'a2', nome: 'Zz Andando', quando: '2026-10-28T10:00:00-03:00', vencido: true },
    { aba: 'O', lead_id: 'n1', nome: 'Zz Novo Ligado', quando: '2026-10-28T17:30:00-03:00', vencido: false },
  ];
  eq(kbCartoesHoje(L5, R5).map(c => c.chave + ':' + c.n).join(' '), 'sem_contato:2 andamento:2 retorno_hoje:1 retorno_atrasado:1 convertido:1', 'cartões por etapa (livre fora)');
  eq(kbCartoesHoje(L5, R5)[4].extra.replace(/\\s/g, ' '), 'R$ 199,90', 'convertidos com receita do mês (Intl usa espaço fixo)');
  eq(kbListaDoCartao('andamento', L5, R5, ag5).map(i => i.lead_id), ['a1', 'a2'], 'lista do cartão Em andamento');
  eq(kbListaDoCartao('retorno_atrasado', L5, R5, ag5).map(i => i.lead_id), ['a2'], 'lista dos retornos atrasados');
  eq(kbListaDoCartao('parados3', L5, R5, ag5).map(i => i.lead_id), ['a1'], 'lista dos parados 3+ dias');
  const fz = kbFacaAgora(L5, R5, ag5, 5);
  eq(fz.map(i => i.lead_id), ['a2', 'n1', 'n2', 'a1'], 'Faça agora: atrasado → hoje → nunca ligado → parado');
  eq(fz.map(i => i.motivo), ['Retorno atrasado 5 h', 'Retorno hoje às 17:30', 'Nunca ligado', 'Parado há 6 dias'], 'motivos do Faça agora');
  eq(kbFacaAgora(L5, R5, ag5, 2).length, 2, 'Faça agora respeita o máximo');
  const muitos = Array.from({ length: 30 }, (_, i) => ({ aba: 'O', lead_id: 'x' + i, nome: 'Zz ' + i }));
  const lh = kbListaCartaoHtml(muitos, 20);
  assert((lh.match(/data-kb-abrir=/g) || []).length === 20 && lh.includes('data-kb-cartao-mais'), 'lista do cartão mostra 20 e "ver mais"');
  // tela
  currentUser = { id: 'u-pode', nome: 'Zzpode Teste', role: 'consultor' };
  kbEstado.leads = L5;
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: R5, livres: 4, placar: { classificacoes: 7, retornos_hoje: 2, retornos_cumpridos: 1 } }, error: null };
  window.__rpcRespostas.meu_placar_ligacoes = { data: [{ lig_hoje: 23, meta_ligacoes_dia: 80, tem_telefonia: true, tem_dados: true }], error: null };
  kbEstado.alertas = [{ tipo: 'parado', aba: 'O', lead_id: 'a1', nome: 'Zz Parado' }];
  kbTrocarAba('hoje');
  await espera(80);
  const hoje = document.getElementById('kbHoje');
  eq(hoje.querySelectorAll('[data-kb-cartao]').length, 5, 'Hoje mostra 5 cartões');
  assert(!hoje.textContent.includes('Zz Venda'), 'Hoje não despeja a lista de leads de uma vez');
  hoje.querySelector('[data-kb-cartao="andamento"]').click();
  assert(hoje.querySelector('[data-kb-cartao="andamento"]').classList.contains('active') && hoje.textContent.includes('Zz Parado'), 'clicar no cartão abre só aquela lista');
  hoje.querySelector('[data-kb-cartao="andamento"]').click();
  assert(!hoje.querySelector('.kbCartaoLista'), 'clicar de novo fecha a lista');
  eq(hoje.querySelectorAll('.kbFaca [data-kb-abrir]').length, 4, 'Faça agora na tela');
  assert(hoje.textContent.includes('23') && hoje.textContent.includes('/ 80') && hoje.textContent.includes('7') && hoje.textContent.includes('1 de 2'), 'placar: ligações/meta, classificações, retornos cumpridos');
  assert(hoje.querySelector('[data-kb-ver-alertas]') && !hoje.querySelector('.kbAlertasLista'), 'alertas recolhidos numa linha');
  hoje.querySelector('[data-kb-ver-alertas]').click();
  assert(hoje.querySelector('.kbAlertasLista') && hoje.textContent.includes('Parado em andamento'), 'ver alertas abre a lista');
  assert(hoje.querySelector('[data-kb-pegar-proximo]') && hoje.textContent.includes('4'), 'quem pega vê "Pegar o próximo livre" com quantos esperam');
  kbEstado.podePegar = false;
  kbRenderHoje();
  assert(!document.querySelector('#kbHoje [data-kb-pegar-proximo]'), 'quem não pega não vê o botão de pegar');
  kbEstado.podePegar = true;
  // ==== Task 6 ====
  eq(kbAtividade(null, null, SP('2026-10-28T12:59:00')), { cor: 'cinza', min: null }, 'antes das 13h: fora do expediente (Review Focus 3)');
  eq(kbAtividade(null, null, SP('2026-10-28T21:00:00')), { cor: 'cinza', min: null }, '21:00: fora do expediente');
  eq(kbAtividade(null, null, SP('2026-10-31T15:00:00')), { cor: 'cinza', min: null }, 'sábado: fora do expediente');
  eq(kbAtividade('2026-10-27T20:50:00-03:00', null, SP('2026-10-28T13:10:00')), { cor: 'verde', min: 10 }, '13:10 conta a partir das 13:00, não de ontem');
  eq(kbAtividade('2026-10-28T14:00:00-03:00', '2026-10-28T14:20:00-03:00', SP('2026-10-28T14:49:00')), { cor: 'verde', min: 29 }, 'vale a ação mais recente (OBS)');
  eq(kbAtividade('2026-10-28T14:00:00-03:00', null, SP('2026-10-28T14:30:00')), { cor: 'amarelo', min: 30 }, '30 min: amarelo');
  eq(kbAtividade('2026-10-28T14:00:00-03:00', null, SP('2026-10-28T15:00:00')), { cor: 'vermelho', min: 60 }, '60 min: vermelho');
  const ag6 = SP('2026-10-28T15:00:00');
  eq(kbAtividadeTexto({ tem_telefonia: true, ultima_ligacao: '2026-10-28T14:48:00-03:00', lig_hoje: 34, ultima_obs: null, obs_hoje: 0 }, ag6),
     { lig: 'ligou há 12 min · 34 hoje', obs: 'nenhuma OBS recente · 0 hoje' }, 'texto da atividade');
  eq(kbAtividadeTexto({ tem_telefonia: false, ultima_ligacao: null, lig_hoje: 0, ultima_obs: '2026-10-28T14:20:00-03:00', obs_hoje: 9 }, ag6),
     { lig: 'sem usuário de telefonia', obs: 'OBS há 40 min · 9 hoje' }, 'sem usuário de telefonia (Review Focus 4)');
  const L6 = [
    { aba: 'O', lead_id: 'p1', nome: 'Zz P1', dono_id: 'u-zz', categoria: 'sem_contato', livre: false, ligacoes: 0, pego_em: '2026-10-28T09:00:00-03:00' },
    { aba: 'O', lead_id: 'p2', nome: 'Zz P2', dono_id: 'u-zz', categoria: 'andamento', livre: false, ligacoes: 1, ultima_ligacao: '2026-10-20T10:00:00-03:00', pego_em: '2026-10-15T09:00:00-03:00' },
    { aba: 'O', lead_id: 'p3', nome: 'Zz P3', dono_id: 'u-zz', categoria: 'convertido', livre: false, receita: 100, pego_em: '2026-10-02T09:00:00-03:00', classificado_em: '2026-10-05T10:00:00-03:00' },
    { aba: 'O', lead_id: 'p4', nome: 'Zz P4', dono_id: 'u-zz', categoria: 'perdido', livre: false, pego_em: '2026-09-25T09:00:00-03:00', classificado_em: '2026-10-03T10:00:00-03:00' },
    { aba: 'O', lead_id: 'q1', nome: 'Zz Q1', dono_id: 'u-yy', categoria: 'andamento', livre: false, ligacoes: 1, ultima_ligacao: '2026-10-28T10:00:00-03:00', pego_em: '2026-10-28T09:00:00-03:00' },
    { aba: 'O', lead_id: 'l9', nome: 'Zz Livre', categoria: 'sem_contato', livre: true },
  ];
  const A6 = [{ tipo: 'retorno_vencido', aba: 'O', lead_id: 'p2', nome: 'Zz P2', dono_id: 'u-zz', dono_nome: 'Zzkcon Teste', desde: '2026-10-28T10:00:00-03:00' }];
  eq(kbContagemEquipe(L6, A6, ag6)['u-zz'], { sem_contato: 1, andamento: 1, parados3: 1, retornos_atrasados: 1, convertidos: 1, receita: 100, pegos_mes: 3 }, 'contagens por consultor');
  eq(kbContagemEquipe(L6, A6, ag6)['u-yy'].parados3, 0, 'quem ligou hoje não está parado');
  // tela do gestor
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__rpcRespostas.leads_kanban3 = { data: L6, error: null };
  window.__rpcRespostas.leads_alertas = { data: A6, error: null };
  window.__rpcRespostas.leads_atividade_equipe = { data: [
    { dono_id: 'u-zz', nome: 'Zzkcon Teste', tem_telefonia: true, ultima_ligacao: new Date(Date.now() - 5 * 60000).toISOString(), lig_hoje: 34, ultima_obs: null, obs_hoje: 0 },
    { dono_id: 'u-yy', nome: 'Zzyy Teste', tem_telefonia: false, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0 },
  ], error: null };
  await kbAplicarPermissao();
  kbEstado.aba = null;
  await kbCarregar();
  await espera(100);
  const eqEl = document.getElementById('kbEquipe');
  assert(eqEl.style.display !== 'none' && eqEl.querySelector('tr[data-kb-dono="u-zz"]') && eqEl.querySelector('tr[data-kb-dono="u-yy"]'), 'Equipe lista os consultores da atividade');
  assert(eqEl.textContent.includes('34 hoje') && eqEl.textContent.includes('sem usuário de telefonia'), 'Equipe mostra a atividade');
  assert(eqEl.querySelector('tr[data-kb-dono="u-zz"] .kbSemaforo'), 'bolinha do semáforo na linha');
  assert(eqEl.textContent.includes('Ligações chegam do ProContact de hora em hora'), 'rodapé avisa do atraso das ligações');
  eqEl.querySelector('[data-kb-eq="u-zz|parados3"]').click();
  await espera(20);
  assert(document.querySelector('#kbEquipe .kbCartaoLista') && document.getElementById('kbEquipe').textContent.includes('Zz P2'), 'número abre a lista do consultor naquela etapa');
  assert(kbEstado.aba === 'equipe', 'clicar no número não troca de aba');
  // ==== Task 7 ====
  eq(kbAbasDoPerfil(false), ['hoje', 'quadro', 'todos'], 'consultor: Hoje, Quadro e Todos');
  eq(kbAbasDoPerfil(true), ['hoje', 'quadro', 'todos', 'equipe'], 'gestor: + Equipe');
  const L7 = Array.from({ length: 120 }, (_, i) => ({ aba: 'OUTUBRO', lead_id: 't' + i, nome: 'Zz Todos ' + String(i).padStart(3, '0'), categoria: i % 3 ? 'perdido' : 'andamento', status: i % 3 ? 'CNPJ INAPTO' : 'EM NEGOCIAÇÂO',
    livre: false, dono_id: 'u-pode', ligacoes: i % 2, ultima_ligacao: i % 2 ? '2026-10-2' + (i % 8) + 'T10:00:00-03:00' : null, pego_em: '2026-10-01T10:00:00-03:00', qtd_linhas: (i % 10 + 1) + ' linhas', cidade: i % 2 ? 'Campinas' : 'Santos', telefone: '119000' + String(i).padStart(5, '0'), cnpj: '000000000' + String(i).padStart(5, '0') }));
  eq(kbOrdenar(L7, 'nome', true)[0].lead_id, 't119', 'ordena por nome (desc)');
  eq(kbOrdenar(L7, 'linhas', false)[0].qtd_linhas, '1 linhas', 'ordena por linhas pelo número');
  eq(kbPagina(L7, 3, 50), { itens: L7.slice(100, 120), pagina: 3, total: 3 }, 'página 3 de 3');
  eq(kbPagina(L7, 9, 50).pagina, 3, 'página além do fim volta para a última');
  eq(kbPagina([], 1, 50), { itens: [], pagina: 1, total: 1 }, 'lista vazia');
  eq([kbBuscaLocal(L7[5], 'todos 005'), kbBuscaLocal(L7[5], '11900000005'), kbBuscaLocal(L7[5], '00000000000005'), kbBuscaLocal(L7[5], 'zz x'), kbBuscaLocal(L7[5], 'zz')], [true, true, true, false, true], 'busca por nome (com letras) ou telefone/CNPJ (só dígitos); menos de 3 caracteres não filtra');
  eq(kbBuscaLocal(L7[70], 'todos 007'), false, 'texto com letras não casa por dígitos do telefone');
  // tela
  currentUser = { id: 'u-pode', nome: 'Zzpode Teste', role: 'consultor' };
  window.__tabelas.leads_equipe = [{ id: 1, pode_pegar: true }];
  await kbAplicarPermissao();
  window.__rpcRespostas.leads_kanban3 = (args) => ({ data: args.p_todos ? L7 : [], error: null });
  kbEstado.filtros = {};
  kbTrocarAba('todos');
  await espera(80);
  assert(window.__rpcCalls.some(c => c.nome === 'leads_kanban3' && c.args.p_todos === true), 'Todos carrega com p_todos');
  const td = document.getElementById('kbTodos');
  assert(td.style.display !== 'none' && document.getElementById('kbBoard').style.display === 'none', 'aba Todos aparece');
  eq(td.querySelectorAll('tbody tr').length, 50, '50 por página');
  assert(td.textContent.includes('Página 1 de 3') && td.textContent.includes('120 leads'), 'paginação');
  td.querySelector('[data-kb-pag="2"]').click();
  assert(document.getElementById('kbTodos').textContent.includes('Página 2 de 3'), 'próxima página');
  document.querySelector('#kbTodos th[data-kb-ord="nome"]').click();
  document.querySelector('#kbTodos th[data-kb-ord="nome"]').click();
  eq(document.querySelector('#kbTodos tbody tr').dataset.kbAbrir, 'OUTUBRO|t119', 'clicar duas vezes no cabeçalho inverte a ordem');
  const busca = document.getElementById('kbTodosBusca');
  busca.value = 'todos 007'; busca.dispatchEvent(new window.Event('input'));
  await espera(350);
  eq(document.querySelectorAll('#kbTodos tbody tr').length, 1, 'busca na aba Todos');
  busca.value = ''; busca.dispatchEvent(new window.Event('input'));
  await espera(350);
  kbEstado.filtros = { cidade: 'Santos' }; kbAoMudarFiltros();
  assert(document.getElementById('kbTodos').textContent.includes('60 leads'), 'filtros valem na aba Todos');
  assert(document.getElementById('kbFiltroBarra').style.display !== 'none', 'barra de filtros na aba Todos');
  document.querySelector('#kbTodos tbody tr').click();
  await espera(60);
  assert(window.__rpcCalls.some(c => c.nome === 'leads_ficha'), 'clicar na linha abre a ficha');
  kbFecharFicha();
  kbEstado.filtros = {};
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
