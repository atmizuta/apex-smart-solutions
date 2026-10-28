// Testa o §126.1 (redesign de Meus leads, Fase 1: ficha nova com Classificar dentro + Hoje B).
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
  // ==== Task 1: funções puras ====
  eq([kbStTexto('AGENDADO RETORNO'), kbStTexto('CNPJ INAPTO'), kbStTexto('CLIENTE SÓ QUERIA FIBRA'), kbStTexto(null)],
     ['Agendado retorno', 'CNPJ inapto', 'Cliente só queria fibra', ''], 'STATUS em frase normal, siglas em maiúscula');
  eq(kbDataLongaSP(SP('2026-10-28T15:12:00')), 'Quarta, 28 de outubro · 15:12', 'data longa em SP');
  const ag1 = SP('2026-10-28T15:12:00');   // quarta 15:12
  const LF = (id, o) => Object.assign({ aba: 'O', lead_id: id, nome: 'Zz ' + id, livre: false, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', ligacoes: 1, ultima_ligacao: '2026-10-28T13:00:00-03:00', pego_em: '2026-10-20T10:00:00-03:00' }, o);
  const L1 = [
    LF('n1', { categoria: 'sem_contato', status: null, ligacoes: undefined, ultima_ligacao: null, pego_em: '2026-10-28T15:06:00-03:00' }),
    LF('n2', { categoria: 'sem_contato', status: null, ligacoes: undefined, ultima_ligacao: null, pego_em: '2026-10-28T14:00:00-03:00' }),
    LF('s1', { ligacoes: 0, ultima_ligacao: null, pego_em: '2026-10-28T12:40:00-03:00' }),
    LF('s2', { ligacoes: 0, ultima_ligacao: null, pego_em: '2026-10-27T10:00:00-03:00' }),
    LF('p1', { ligacoes: 2, ultima_ligacao: '2026-10-24T10:00:00-03:00', classificado_em: '2026-10-24T10:05:00-03:00' }),
    LF('p2', { ligacoes: 2, ultima_ligacao: '2026-10-26T10:00:00-03:00' }),
    LF('a1', { ligacoes: 3, ultima_ligacao: '2026-10-27T17:40:00-03:00' }),
    LF('r1'), LF('r2'), LF('r3', { ultima_ligacao: '2026-10-26T11:00:00-03:00' }),
    LF('c1', { categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)' }),
    LF('l1', { livre: true, categoria: 'sem_contato', status: null }),
  ];
  const R1 = [
    { aba: 'O', lead_id: 's1', nome: 'Zz s1', quando: '2026-10-28T18:00:00-03:00', vencido: false },
    { aba: 'O', lead_id: 'r2', nome: 'Zz r2', quando: '2026-10-28T16:45:00-03:00', vencido: false },
    { aba: 'O', lead_id: 'r1', nome: 'Zz r1', quando: '2026-10-28T15:30:00-03:00', vencido: false },
    { aba: 'O', lead_id: 'a1', nome: 'Zz a1', quando: '2026-10-28T14:00:00-03:00', vencido: true },
    { aba: 'O', lead_id: 'r3', nome: 'Zz r3', quando: '2026-10-27T17:30:00-03:00', vencido: true },
  ];
  const f1 = kbFilaHoje(L1, R1, ag1);
  eq(f1.map(i => i.lead_id), ['r3', 'a1', 'n2', 'n1', 'r1', 'r2', 's1', 's2', 'p1'], 'fila: atrasados → agora (novos, depois retorno da próxima 1 h) → mais tarde → nunca ligados → parados; cada lead uma vez');
  eq(f1.map(i => i.grupo), ['atrasados', 'atrasados', 'agora', 'agora', 'agora', 'tarde', 'tarde', 'nunca', 'parados'], 'grupos da fila');
  eq(f1.map(i => i.rotulo), ['ontem', '14:00', 'novo', 'novo', '15:30', '16:45', '18:00', '—', '4 d'], 'rótulo da coluna da esquerda');
  eq(f1.map(i => i.classe), ['late', 'late', 'novo', 'novo', '', '', '', '', ''], 'cor do rótulo');
  assert(!f1.some(i => ['c1', 'l1', 'p2'].includes(i.lead_id)), 'convertido, livre e parado há só 2 dias ficam fora');
  eq(f1[0].chave, 'O|r3', 'chave aba|id');
  eq(kbFilaHoje([LF('b1')], [{ aba: 'O', lead_id: 'b1', nome: 'Zz b1', quando: '2026-10-28T16:12:00-03:00', vencido: false }], ag1)[0].grupo, 'agora', 'retorno em exatamente 60 min entra em Agora');
  eq(kbFilaHoje([LF('b2')], [{ aba: 'O', lead_id: 'b2', nome: 'Zz b2', quando: '2026-10-28T16:13:00-03:00', vencido: false }], ag1)[0].grupo, 'tarde', 'retorno em 61 min vai para Mais tarde');
  const fora = kbFilaHoje([], [{ aba: 'O', lead_id: 'zz', nome: 'Zz Fora do Quadro', quando: '2026-10-28T09:00:00-03:00', vencido: true }], ag1);
  eq([fora.length, fora[0].nome, fora[0].lead], [1, 'Zz Fora do Quadro', null], 'retorno de lead que não veio no Quadro entra com o nome do retorno');
  eq(kbFilaHoje([LF('t1')], [{ aba: 'O', lead_id: 't1', nome: 'Zz t1', quando: '2026-10-29T10:00:00-03:00', vencido: false }], ag1).length, 0, 'retorno de amanhã não entra');
  eq(kbFilaHoje(null, null, ag1), [], 'sem dados: fila vazia');
  eq([kbProximoHoje(['a', 'b', 'c', 'd'], 'b', ['a', 'c', 'd']), kbProximoHoje(['a', 'b', 'c', 'd'], 'b', ['a', 'b', 'c', 'd']),
      kbProximoHoje(['a', 'b', 'c'], 'c', ['a', 'b']), kbProximoHoje(['a'], 'a', []), kbProximoHoje(['a', 'b'], 'b', ['b']),
      kbProximoHoje(['a', 'b', 'c'], 'b', ['a', 'b'])],
     ['c', 'c', 'a', null, null, 'a'], 'próximo depois de salvar: o seguinte que ainda existe; senão o primeiro que não é o atual');
  const at = kbAtalhosRetorno(ag1);
  eq(at.map(a => a.rotulo), ['Hoje 17h', 'Amanhã 10h', 'Amanhã 14h', 'Em 3 dias', 'Próxima semana'], 'atalhos de retorno às 15:12');
  eq(at.map(a => a.data + ' ' + a.hora), ['2026-10-28 17:00', '2026-10-29 10:00', '2026-10-29 14:00', '2026-10-31 10:00', '2026-11-02 10:00'], 'datas e horas dos atalhos');
  assert(!kbAtalhosRetorno(SP('2026-10-28T17:00:00')).some(a => a.rotulo === 'Hoje 17h'), 'a partir das 17h some o Hoje 17h');
  eq([kbAtalhosRetorno(SP('2026-11-02T09:00:00')).pop().data, kbAtalhosRetorno(SP('2026-11-01T09:00:00')).pop().data], ['2026-11-09', '2026-11-02'], 'próxima semana = próxima segunda');
  eq([kbObsParaSalvar('  ', 'Zz antiga'), kbObsParaSalvar('Zz nova', 'Zz antiga'), kbObsParaSalvar('', null)], ['Zz antiga', 'Zz nova', ''], 'OBS em branco mantém a atual (decisão 1)');
  const u = (l, r) => kbUrgenciaFicha(l, r, ag1);
  eq(u(LF('a1'), { quando: '2026-10-28T14:00:00-03:00', vencido: true }), { classe: 'late', texto: 'retorno era às 14:00' }, 'urgência: retorno vencido hoje');
  eq(u(LF('r3'), { quando: '2026-10-27T17:30:00-03:00', vencido: true }).texto, 'retorno era ontem às 17:30', 'urgência: retorno vencido ontem');
  eq(u(LF('r9'), { quando: '2026-10-25T10:00:00-03:00', vencido: true }).texto, 'retorno era 25/10 às 10:00', 'urgência: retorno vencido há dias');
  eq(u(LF('r1'), { quando: '2026-10-28T15:30:00-03:00', vencido: false }), { classe: 'ok', texto: 'retorno hoje às 15:30' }, 'urgência: retorno hoje');
  eq(u(L1[0], null), { classe: 'novo', texto: 'lead novo · pego há 6 min' }, 'urgência: lead novo');
  eq(u(L1[2], null), { classe: 'soon', texto: 'classificado, mas nunca ligado' }, 'urgência: nunca ligado');
  eq(u(L1[4], null), { classe: 'soon', texto: 'parado há 4 dias' }, 'urgência: parado');
  eq(u(L1[10], null), null, 'convertido sem urgência');
  eq(u(LF('lv', { livre: true, categoria: 'sem_contato', status: null, criado_em_lead: '2026-10-28T14:47:00-03:00' }), null), { classe: 'novo', texto: 'livre · chegou há 25 min' }, 'urgência: livre');
  // ==== Task 2: tokens e barra da aba ====
  const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\\n');
  assert(css.includes('#panel-meusleads,#kbFicha{--ml-ink:var(--c-grafite);--ml-ink-2:#464A4E;'), 'tokens da aba declarados');
  const stKb = [...document.querySelectorAll('style')].map(s => s.textContent).find(t => t.includes('/* Meus leads — Kanban')) || '';
  const cssKb = stKb.slice(stKb.indexOf('/* Meus leads — Kanban'));   // o bloco de Meus leads vai até o fim desse <style>
  const hexSolto = cssKb.split('\\n').filter(l => /#[0-9a-fA-F]{3,6}\\b/.test(l) && !/^\\s*\\[data-st=/.test(l) && !/--ml-ink-2:#464A4E;.*--ml-surface-2:#F7F7F8;/.test(l));
  eq(hexSolto, [], 'CSS de Meus leads: hex só nos tokens e nas cores de STATUS');
  eq(cssKb.match(/border-radius:(10|12|14|16)px/g) || [], [], 'CSS de Meus leads: cantos pelos tokens da marca (sem os 10–14px antigos)');
  const seg = document.getElementById('kbAbas');
  assert(seg.classList.contains('kbSeg'), 'abas viram controle segmentado');
  eq([...seg.querySelectorAll('[data-kb-aba]')].map(b => b.dataset.kbAba), ['equipe', 'hoje', 'quadro', 'todos'], 'Equipe primeiro (só o gestor vê)');
  assert(document.querySelector('.kbBarra #kbBusca') && document.querySelector('.kbBarra .kbAtalhoTecla').textContent === '/', 'busca na barra, com o atalho /');
  assert(document.querySelector('#kbFiltrosGestor .kbMaisMenu #kbSoDiverg') && document.querySelector('#kbFiltrosGestor .kbMaisMenu #kbReescrever'), 'Só divergências e Reescrever no menu ⋯ do gestor');
  assert(!document.querySelector('#panel-meusleads .kbTopo'), 'sai o cartão antigo do topo');
  const painel = document.getElementById('panel-meusleads');
  painel.classList.add('active');
  const tecla = (k, alvo) => (alvo || document).dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  document.body.focus();
  tecla('/');
  assert(document.activeElement === document.getElementById('kbBusca'), '/ leva para a busca');
  const ta = document.createElement('textarea'); document.body.appendChild(ta); ta.focus();
  tecla('/', ta);
  assert(document.activeElement === ta, '/ dentro de um campo de texto não rouba o foco');
  ta.remove();
  painel.classList.remove('active');
  // ==== Task 3: ficha nova com Classificar dentro ====
  const OPC = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'AGENDADO RETORNO', grupo: 'andamento', ordem: 2 },
    { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  const F3 = { aba: 'OUTUBRO', lead_id: 'f3', nome: 'Zz Padaria', cidade: 'Campinas', uf: 'SP', qtd_linhas: '6', tipo_empresa: 'MEI', telefone: '11900000031',
    email: 'zz@teste.invalid', cnpj: '00000000000131', status: 'AGENDADO RETORNO', categoria: 'andamento', obs: 'Zz ligar depois do almoço', campanha: 'Zz Campanha',
    criado_em_lead: '2026-10-24T09:14:00-03:00', livre: false, dono_nome: 'Zzkcon Teste', ligacoes: 3 };
  const h3 = kbFichaHtml(F3, { gestor: false, agoraMs: ag1, opcoes: OPC, retorno: { quando: '2026-10-28T14:00:00-03:00', vencido: true } });
  ['Zz Padaria', '(11) 90000-0031', 'zz@teste.invalid', '00000000000131', 'MEI · 6 linhas · Campinas/SP', 'Zz Campanha', 'Zz ligar depois do almoço', 'retorno era às 14:00', 'Agendado retorno']
    .forEach(x => assert(h3.includes(x), 'ficha nova mostra ' + x));
  assert(h3.includes('data-kb-ficha-aba="classificar"') && h3.includes('data-kb-ficha-pane="historico"') && h3.includes('data-kb-ficha-pane="anuncio"'), 'abas Classificar · Histórico · Anúncio');
  assert(h3.includes('id="kbClassStatus"') && h3.includes('data-kb-status="CNPJ INAPTO"') && h3.includes('Sem resposta ou perdido') && h3.includes('Venda'), 'Classificar dentro da ficha, com os grupos renomeados');
  assert(h3.includes('class="kbStatusChip kbSt ativo" data-st="agendado-retorno"'), 'status atual já vem marcado');
  assert(h3.includes('id="kbClassSalvar"') && !h3.includes('kbClassSalvarProx'), 'na gaveta o botão é só Salvar');
  assert(kbFichaHtml(F3, { gestor: false, agoraMs: ag1, opcoes: OPC, naHoje: true }).includes('id="kbClassSalvarProx"'), 'na Hoje tem Salvar e ir para o próximo');
  assert(!h3.includes('kbMaisMenu') && kbFichaHtml(F3, { gestor: true, agoraMs: ag1, opcoes: OPC }).includes('data-kb-ficha-redistribuir'), 'menu ⋯ (Redistribuir, Apagar) só para o gestor');
  const hLivre = kbFichaHtml({ aba: 'O', lead_id: 'lv', nome: 'Zz Livre', livre: true, categoria: 'sem_contato', qtd_linhas: '10', campanha: 'Zz Camp' }, { gestor: false, agoraMs: ag1, podePegar: true, opcoes: OPC });
  assert(hLivre.includes('data-kb-ficha-pegar') && hLivre.includes('aparecem quando você pega o lead') && !hLivre.includes('kbClassStatus'), 'livre: prévia com Pegar e sem Classificar');
  // RF1: campos vazios e STATUS antigo
  const hVazio = kbFichaHtml({ aba: 'O', lead_id: 'v', nome: null, livre: false, categoria: 'andamento', status: 'STATUS ANTIGO QUALQUER' }, { gestor: false, agoraMs: ag1, opcoes: OPC });
  assert(!/undefined|>null</.test(hVazio) && hVazio.includes('Status antigo qualquer') && !hVazio.includes('kbSt ativo'), 'RF1: sem undefined/null; status antigo em texto e nenhum botão marcado');
  // RF2: HTML no nome, OBS e STATUS
  const hX = kbFichaHtml({ aba: 'O', lead_id: 'x', nome: '<img src=x onerror=alert(1)>', obs: '<script>zz</script>', status: '<b>zz</b>', livre: false, categoria: 'andamento', telefone: '11900000032' }, { gestor: false, agoraMs: ag1, opcoes: OPC });
  assert(!hX.includes('<img') && !hX.includes('<script>') && !hX.includes('<b>zz'), 'RF2: ficha escapa nome, OBS e status');
  // tela: abrir pelo arraste destaca o grupo e não salva nada
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = OPC;
  window.__rpcRespostas.leads_kanban3 = { data: [Object.assign({}, F3, { lead_id: 'f3' }), Object.assign({}, F3, { lead_id: 'f4', nome: 'Zz Segundo', status: null, categoria: 'sem_contato' })], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({}, F3, { lead_id: a.p_id, nome: a.p_id === 'f4' ? 'Zz Segundo' : 'Zz Padaria' })], error: null });
  window.__rpcRespostas.leads_ficha_detalhes = { data: { anuncio: { campanha: 'Zz Camp', conjunto: 'Zz Conj' }, resumo: { ligacoes: 3, atendidas: 1, cliques: 0, ultimo: new Date().toISOString() },
    eventos: [{ em: new Date().toISOString(), tipo: 'ligacao', titulo: 'Ligação não atendida', quem: 'zz.usuario' }] }, error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  kbTrocarAba('quadro');
  await espera(60);
  const nClass0 = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length;
  await kbAbrirClassificar('OUTUBRO', 'f3', 'perdido');
  const ficha = document.getElementById('kbFicha');
  assert(ficha.classList.contains('aberta') && ficha.querySelector('[data-kb-grupo="perdido"]').classList.contains('kbDestaque'), 'arrastar para Perdido abre a ficha com o grupo de perda em destaque');
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length, nClass0, 'abrir pelo arraste não salva nada');
  assert(document.getElementById('kbFichaResumo').textContent.includes('3 tentativas') && document.getElementById('kbFichaAnuncio').textContent.includes('Zz Conj'), 'resumo e anúncio carregados');
  ficha.querySelector('[data-kb-ficha-aba="historico"]').click();
  assert(!ficha.querySelector('[data-kb-ficha-pane="historico"]').hidden && ficha.querySelector('[data-kb-ficha-pane="classificar"]').hidden, 'trocar para a aba Histórico');
  ficha.querySelector('[data-kb-ficha-aba="classificar"]').click();
  // escolher status mostra os blocos certos
  ficha.querySelector('[data-kb-status="PEDIDO CONCLUIDO (VENDA)"]').click();
  assert(document.getElementById('kbClassVenda').style.display !== 'none' && document.getElementById('kbClassRetornoBox').style.display === 'none', 'venda mostra Receita/Converteu');
  document.getElementById('kbClassRetorno').value = '';
  ficha.querySelector('[data-kb-status="AGENDADO RETORNO"]').click();
  assert(document.getElementById('kbClassRetornoBox').style.display !== 'none' && document.getElementById('kbClassRetorno').value === kbSomaDias(kbDiaSP(Date.now()), 1), 'retorno vem em Amanhã 10h');
  [...ficha.querySelectorAll('[data-kb-ret-data]')].find(b => b.textContent === 'Em 3 dias').click();
  eq([document.getElementById('kbClassRetorno').value, document.getElementById('kbClassHora').value], [kbSomaDias(kbDiaSP(Date.now()), 3), '10:00'], 'atalho Em 3 dias preenche data e hora');
  // OBS em branco mantém a anterior; Ctrl+Enter salva
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  window.__rpcRespostas.leads_agendar_retorno = { data: null, error: null };
  ficha.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await espera(80);
  const c3 = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').pop();
  eq([c3.args.p_id, c3.args.p_status, c3.args.p_obs], ['f3', 'AGENDADO RETORNO', 'Zz ligar depois do almoço'], 'Ctrl+Enter salva; OBS em branco mantém a anterior');
  assert(/T10:00:00-03:00$/.test(window.__rpcCalls.filter(c => c.nome === 'leads_agendar_retorno').pop().args.p_quando), 'retorno com a hora escolhida');
  assert(document.getElementById('kbFicha').classList.contains('aberta') && document.getElementById('kbClassObs').value === '', 'depois de salvar a ficha reabre com a OBS em branco');
  // RF3: erro do banco não perde a OBS
  window.__rpcRespostas.leads_classificar = { data: null, error: { message: 'rede' } };
  document.getElementById('kbClassStatus').value = 'EM NEGOCIAÇÂO';
  document.getElementById('kbClassObs').value = 'Zz texto que não pode sumir';
  const ok3 = await kbSalvarClassificacao();
  assert(ok3 === false && document.getElementById('kbClassErro').textContent.includes('Não foi possível salvar agora') && document.getElementById('kbClassObs').value === 'Zz texto que não pode sumir', 'RF3: erro avisa e mantém a OBS');
  // RF4: dois cliques seguidos = uma chamada só
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  const n4 = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length;
  await Promise.all([kbSalvarClassificacao(), kbSalvarClassificacao()]);
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length - n4, 1, 'RF4: duplo salvar chama o banco uma vez');
  // setas trocam de lead na lista de onde a ficha veio; Esc fecha a gaveta
  await kbAbrirFicha('OUTUBRO', 'f3', { lista: ['OUTUBRO|f3', 'OUTUBRO|f4'] });
  assert(document.getElementById('kbFicha').textContent.includes('1 de 2'), 'posição na lista');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await espera(60);
  document.getElementById('panel-meusleads').classList.add('active');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await espera(60);
  assert(kbEstado.fichaAlvo.id === 'f4' && document.getElementById('kbFicha').textContent.includes('Zz Segundo'), 'seta para baixo abre o próximo da lista');
  document.getElementById('kbClassObs').value = 'Zz pendente';
  window.confirm = () => false;   // revisão final: o painel pergunta antes de descartar; 'não' mantém o lead
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  await espera(40);
  assert(kbEstado.fichaAlvo.id === 'f4', 'com OBS digitada e resposta não, a seta não troca de lead');
  window.confirm = () => true;
  document.getElementById('kbClassObs').value = '';
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!document.getElementById('kbFicha').classList.contains('aberta'), 'Esc fecha a gaveta');
  document.getElementById('panel-meusleads').classList.remove('active');
  assert(!document.getElementById('kbClassOverlay'), 'a janela Classificar saiu do painel');
  // ==== Task 4: Hoje B ====
  const agora4 = Date.now();
  const iso = (minDelta) => new Date(agora4 + minDelta * 60000).toISOString();
  const L4 = [
    { aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Novo', categoria: 'sem_contato', livre: false, pego_em: iso(-10), criado_em_lead: iso(-12) },
    { aba: 'OUTUBRO', lead_id: 'h2', nome: 'Zz Retorno Vencido', categoria: 'andamento', status: 'AGENDADO RETORNO', livre: false, ligacoes: 2, ultima_ligacao: iso(-60), obs: 'Zz obs h2' },
    { aba: 'OUTUBRO', lead_id: 'h3', nome: 'Zz Nunca', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, ligacoes: 0, pego_em: iso(-120) },
    { aba: 'OUTUBRO', lead_id: 'lv1', nome: 'Zz Livre Antigo', categoria: 'sem_contato', livre: true, criado_em_lead: iso(-30), cidade: 'Campinas', qtd_linhas: '10' },
    { aba: 'OUTUBRO', lead_id: 'lv2', nome: 'Zz Livre Novo', categoria: 'sem_contato', livre: true, criado_em_lead: iso(-2) },
  ];
  const R4 = [{ aba: 'OUTUBRO', lead_id: 'h2', nome: 'Zz Retorno Vencido', quando: iso(-30), vencido: true }];
  window.__rpcRespostas.leads_kanban3 = { data: L4, error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: R4, livres: 2, placar: { classificacoes: 7, retornos_hoje: 2, retornos_cumpridos: 1 } }, error: null };
  window.__rpcRespostas.meu_placar_ligacoes = { data: [{ lig_hoje: 23, meta_ligacoes_dia: 80, tem_telefonia: true, tem_dados: true }], error: null };
  window.__rpcRespostas.leads_alertas = { data: [{ tipo: 'sem_contato', aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Novo', desde: iso(-10) }], error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({ telefone: '11900000041' }, L4.find(l => l.lead_id === a.p_id) || { aba: 'OUTUBRO', lead_id: a.p_id, nome: 'Zz ?', categoria: 'andamento' })], error: null });
  kbFecharFicha();
  document.getElementById('panel-meusleads').classList.add('active');
  await kbCarregar();
  kbTrocarAba('hoje');
  await espera(120);
  const hoje4 = document.getElementById('kbHoje'), lista4 = document.getElementById('kbFilaLista');
  assert(hoje4.querySelector('#kbHojeTopo').textContent.includes('23') && hoje4.textContent.includes('/ 80') && hoje4.textContent.includes('1 de 2') && hoje4.querySelector('#kbHojeTopo').textContent.includes('7'), 'placar: ligações/meta, classificados, retornos cumpridos');
  eq([...lista4.querySelectorAll('[data-kb-fila]')].map(b => b.dataset.kbFila), ['OUTUBRO|h2', 'OUTUBRO|h1', 'OUTUBRO|h3'], 'fila: atrasado, novo, nunca ligado');
  assert(lista4.textContent.includes('Atrasados') && lista4.textContent.includes('Agora') && lista4.textContent.includes('Nunca ligados'), 'títulos dos grupos');
  const no4 = document.getElementById('kbFicha');
  assert(no4.parentElement.id === 'kbHojeFicha' && no4.classList.contains('noPainel'), 'na Hoje a ficha mora no painel da direita');
  assert(kbEstado.fichaAlvo && kbEstado.fichaAlvo.id === 'h2' && no4.textContent.includes('Zz Retorno Vencido') && no4.textContent.includes('1 de 3 na sua fila'), 'o primeiro da fila já abre ao lado');
  assert(no4.querySelector('#kbClassSalvarProx'), 'na Hoje o botão é Salvar e ir para o próximo');
  eq(document.getElementById('kbFilaNFazer').textContent, '3', 'contador de Fazer agora');
  // clicar em outro lead troca a ficha; com OBS digitada não troca
  lista4.querySelector('[data-kb-fila="OUTUBRO|h3"]').click();
  await espera(60);
  assert(kbEstado.fichaAlvo.id === 'h3' && lista4.querySelector('[data-kb-fila="OUTUBRO|h3"]').classList.contains('sel'), 'clicar na fila abre o lead ao lado');
  document.getElementById('kbClassObs').value = 'Zz digitando';
  window.confirm = () => false;
  lista4.querySelector('[data-kb-fila="OUTUBRO|h1"]').click();
  await espera(40);
  assert(kbEstado.fichaAlvo.id === 'h3', 'com OBS digitada e resposta não, clicar em outro lead não troca');
  window.confirm = () => true;
  // a recarga de 10 s não apaga o que foi digitado
  const nFicha = window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length;
  await kbCarregar();
  assert(document.getElementById('kbClassObs').value === 'Zz digitando' && window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length === nFicha, 'recarga não redesenha a ficha com OBS digitada');
  // RF3-hoje: erro ao salvar não avança
  window.__rpcRespostas.leads_classificar = { data: null, error: { message: 'rede' } };
  document.getElementById('kbClassStatus').value = 'EM NEGOCIAÇÂO';
  document.getElementById('kbClassSalvarProx').click();
  await espera(80);
  assert(kbEstado.fichaAlvo.id === 'h3' && document.getElementById('kbClassObs').value === 'Zz digitando', 'RF3-hoje: erro não avança e mantém a OBS');
  // Salvar e ir para o próximo: h3 sai da fila (agora tem ligação) e o próximo da ordem antiga abre
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  window.__rpcRespostas.leads_kanban3 = { data: L4.map(l => l.lead_id === 'h3' ? Object.assign({}, l, { ligacoes: 1, ultima_ligacao: iso(0) }) : l), error: null };
  document.getElementById('kbClassSalvarProx').click();
  await espera(150);
  eq([...lista4.querySelectorAll('[data-kb-fila]')].map(b => b.dataset.kbFila), ['OUTUBRO|h2', 'OUTUBRO|h1'], 'lead salvo que não se encaixa mais sai da fila');
  assert(kbEstado.fichaAlvo.id === 'h2' && kbEstado.hojeSel === 'OUTUBRO|h2', 'h3 era o último: volta para o primeiro que sobrou');
  // setas na Hoje andam pela fila
  document.body.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await espera(60);
  assert(kbEstado.hojeSel === 'OUTUBRO|h1' && kbEstado.fichaAlvo.id === 'h1', 'seta para baixo vai para o próximo da fila');
  // Livres: do mais antigo para o mais novo; prévia e Pegar
  hoje4.querySelector('[data-kb-fila-aba="livres"]').click();
  eq([...lista4.querySelectorAll('[data-kb-fila]')].map(b => b.dataset.kbFila), ['OUTUBRO|lv1', 'OUTUBRO|lv2'], 'Livres do mais antigo para o mais novo');
  assert(lista4.querySelector('[data-kb-pegar-proximo]'), 'Pegar o próximo livre na aba Livres');
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [L4.find(l => l.lead_id === a.p_id)], error: null });
  lista4.querySelector('[data-kb-fila="OUTUBRO|lv1"]').click();
  await espera(60);
  assert(no4.querySelector('[data-kb-ficha-pegar]') && !no4.querySelector('#kbClassStatus'), 'livre: prévia com Pegar');
  window.__rpcRespostas.leads_pegar = { data: { ok: true }, error: null };
  window.__rpcRespostas.leads_kanban3 = { data: L4.map(l => l.lead_id === 'lv1' ? Object.assign({}, l, { livre: false, pego_em: iso(0) }) : l), error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({ telefone: '11900000042' }, L4.find(l => l.lead_id === a.p_id), a.p_id === 'lv1' ? { livre: false, pego_em: iso(0) } : {})], error: null });
  no4.querySelector('[data-kb-ficha-pegar]').click();
  await espera(150);
  assert(kbEstado.filaAba === 'fazer' && kbEstado.hojeSel === 'OUTUBRO|lv1' && hoje4.querySelector('[data-kb-fila-aba="fazer"]').classList.contains('active'), 'pegar leva para Fazer agora com o lead selecionado');
  // Alertas
  hoje4.querySelector('[data-kb-fila-aba="alertas"]').click();
  assert(lista4.textContent.includes('Pego e sem contato') && lista4.textContent.includes('Zz Novo'), 'aba Alertas lista os alertas');
  lista4.querySelector('[data-kb-fila="OUTUBRO|h1"]').click();
  await espera(60);
  assert(kbEstado.fichaAlvo.id === 'h1', 'clicar no alerta abre o lead');
  hoje4.querySelector('[data-kb-fila-aba="fazer"]').click();
  // RF2-fila: nome com HTML na fila sai escapado
  kbEstado.leads = [{ aba: 'OUTUBRO', lead_id: 'x9', nome: '<img src=x onerror=alert(1)>', categoria: 'sem_contato', livre: false, pego_em: iso(-1) }];
  kbRenderHoje();
  assert(!lista4.innerHTML.includes('<img'), 'RF2-fila: nome escapado');
  // Tudo em dia
  kbEstado.leads = []; kbEstado.hoje = { fila: [], retornos: [], livres: 0, placar: {} };
  kbFecharFicha(); kbEstado.fichaAlvo = null;
  kbRenderHoje();
  assert(!document.getElementById('kbHojeVazio').hidden && document.getElementById('kbHojeVazio').textContent.includes('Tudo em dia') && no4.hidden, 'fila vazia: Tudo em dia no lugar da ficha');
  // RF5: flutuar na Hoje, trocar de aba e fechar a flutuante
  window.__rpcRespostas.leads_kanban3 = { data: L4, error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({ telefone: '11900000041' }, L4.find(l => l.lead_id === a.p_id))], error: null });
  await kbCarregar(); await espera(100);
  const pip4 = document.implementation.createHTMLDocument('pip');
  const win4 = { document: pip4, addEventListener: (ev, fn) => { if(ev === 'pagehide') win4._ph = fn; }, close(){ if(win4._ph) win4._ph(); } };
  window.documentPictureInPicture = { requestWindow: async () => win4 };
  await kbFlutuarFicha(); await espera(60);
  kbTrocarAba('quadro'); kbRenderHoje();
  assert(pip4.getElementById('kbFicha') && !document.getElementById('kbFicha'), 'RF5: flutuando, trocar de aba não puxa a ficha de volta');
  kbTrocarAba('hoje'); await espera(80);
  kbFecharFicha(); await espera(80);
  assert(document.getElementById('kbFicha') && document.getElementById('kbFicha').parentElement.id === 'kbHojeFicha', 'RF5: fechar a flutuante na Hoje devolve a ficha ao painel da direita');
  delete window.documentPictureInPicture;
  // sair da Hoje: ficha volta para a casa e fecha (sem nada digitado)
  kbTrocarAba('quadro');
  assert(document.getElementById('kbFicha').parentElement.id === 'kbFichaCasa' && !document.getElementById('kbFicha').classList.contains('aberta'), 'fora da Hoje a ficha volta a ser gaveta, fechada');
  // gestor sem consultor escolhido
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  kbEstado.dono = '';
  kbTrocarAba('hoje'); await espera(80);
  assert(document.getElementById('kbFilaLista').textContent.includes('Escolha um consultor'), 'gestor sem consultor escolhido vê o aviso');
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  document.getElementById('panel-meusleads').classList.remove('active');
  // ==== Revisão final: correções ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  kbEstado.dono = '';
  document.getElementById('panel-meusleads').classList.add('active');
  window.__rpcRespostas.leads_kanban3 = { data: L4, error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: R4, livres: 2, placar: {} }, error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({ telefone: '11900000041' }, L4.find(l => l.lead_id === a.p_id) || { aba: 'OUTUBRO', lead_id: a.p_id, nome: 'Zz ?', categoria: 'andamento' })], error: null });
  await kbCarregar();
  kbTrocarAba('quadro'); kbFecharFicha();
  // I1: abrir outro lead com algo digitado pergunta antes; "não" mantém tudo
  await kbAbrirFicha('OUTUBRO', 'h3');
  document.getElementById('kbClassObs').value = 'Zz nao pode sumir';
  let perguntas = 0; window.confirm = () => { perguntas++; return false; };
  await kbAbrirFicha('OUTUBRO', 'h1');
  assert(perguntas === 1 && kbEstado.fichaAlvo.id === 'h3' && document.getElementById('kbClassObs').value === 'Zz nao pode sumir', 'I1: abrir outro lead com OBS digitada pergunta e, com "não", mantém tudo');
  window.confirm = () => true;
  await kbAbrirFicha('OUTUBRO', 'h1');
  assert(kbEstado.fichaAlvo.id === 'h1', 'I1: com "sim", abre o outro lead');
  // I1: flutuar leva a ficha como está (sem recarregar); fechar a janela devolve o mesmo lead com o texto
  document.getElementById('kbClassObs').value = 'Zz anotando';
  const pipF = document.implementation.createHTMLDocument('pip');
  const winF = { document: pipF, addEventListener: (ev, fn) => { if(ev === 'pagehide') winF._ph = fn; }, close(){ if(winF._ph) winF._ph(); } };
  window.documentPictureInPicture = { requestWindow: async () => winF };
  const nFichaF = window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length;
  await kbFlutuarFicha(); await espera(40);
  assert(pipF.getElementById('kbClassObs') && pipF.getElementById('kbClassObs').value === 'Zz anotando' && window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length === nFichaF, 'I1: flutuar leva a ficha como está, sem recarregar');
  winF.close(); await espera(40);
  assert(document.getElementById('kbClassObs').value === 'Zz anotando' && kbEstado.fichaAlvo && kbEstado.fichaAlvo.id === 'h1' && document.getElementById('kbFicha').classList.contains('aberta'), 'I1: fechar a janela flutuante devolve a ficha com o lead e o texto');
  delete window.documentPictureInPicture;
  // I2: status escolhido por engano se desfaz clicando de novo
  document.getElementById('kbClassObs').value = '';
  const fichaN = document.getElementById('kbFicha');
  fichaN.querySelector('[data-kb-status="EM NEGOCIAÇÂO"]').click();
  assert(kbFichaSuja(), 'pré: escolher status deixa a ficha alterada');
  fichaN.querySelector('[data-kb-status="EM NEGOCIAÇÂO"]').click();
  assert(!kbFichaSuja() && document.getElementById('kbClassStatus').value === '', 'I2: clicar de novo no status escolhido desfaz a escolha');
  // retorno: a hora do retorno marcado vem preenchida (salvar só a OBS não muda o horário)
  const hRet = kbClassificarHtml({ status: 'AGENDADO RETORNO', retorno_em: '2026-10-28' }, OPC, { agoraMs: ag1, retorno: { quando: '2026-10-28T15:30:00-03:00', vencido: false } });
  assert(hRet.includes('id="kbClassHora" value="15:30"') && hRet.includes('id="kbClassRetorno" value="2026-10-28"'), 'retorno: data e hora do retorno marcado vêm preenchidas');
  assert(kbClassificarHtml({ status: 'EM NEGOCIAÇÂO' }, OPC, { agoraMs: ag1 }).includes('id="kbClassHora" value="10:00"'), 'retorno: sem retorno marcado a hora padrão é 10:00');
  assert(kbFichaHtml(Object.assign({}, F3, { retorno_em: '2026-10-28' }), { gestor: false, agoraMs: ag1, opcoes: OPC, retorno: { quando: '2026-10-28T15:30:00-03:00', vencido: false } }).includes('id="kbClassHora" value="15:30"'), 'retorno: a ficha repassa o retorno ao Classificar');
  // I4: clicar na notificação leva para a aba Meus leads
  window.Notification = function(){ window.__notif = this; }; window.Notification.permission = 'granted';
  window.__rpcRespostas.leads_alertas = { data: [{ tipo: 'lead_novo', aba: 'OUTUBRO', lead_id: 'h3', nome: 'Zz Notif', desde: iso(0) }], error: null };
  kbEstado.leadNovoIniciado = true; kbEstado.notificados = new Set(); window.__notif = null;
  await kbCarregarAlertas(true);
  document.getElementById('panel-meusleads').classList.remove('active');
  assert(window.__notif && typeof window.__notif.onclick === 'function', 'pré: notificação criada');
  window.__notif.onclick(); await espera(120);
  assert(document.getElementById('panel-meusleads').classList.contains('active'), 'I4: clicar na notificação abre a aba Meus leads');
  delete window.Notification;
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  // I5: ficha flutuante aberta pela Hoje
  document.getElementById('panel-meusleads').classList.add('active');
  kbTrocarAba('hoje'); await espera(120);
  const pipH = document.implementation.createHTMLDocument('pip');
  const winH = { document: pipH, addEventListener: (ev, fn) => { if(ev === 'pagehide') winH._ph = fn; }, close(){ if(winH._ph) winH._ph(); } };
  window.documentPictureInPicture = { requestWindow: async () => winH };
  await kbFlutuarFicha(); await espera(60);
  assert(!document.getElementById('kbHojeVazio').hidden && document.getElementById('kbHojeVazio').textContent.includes('janela flutuante'), 'I5: a Hoje avisa que a ficha está na janela flutuante');
  const cssRF = [...document.querySelectorAll('style')].map(s => s.textContent).join('\\n');
  assert(cssRF.includes('.kbFicha.flutuante.noPainel{height:100vh;}') && cssRF.includes('.kbFicha.flutuante [data-kb-ficha-fechar]{display:inline-flex;}') && cssRF.includes('.kbFicha.flutuante [data-kb-ficha-flutuar]{display:none;}'), 'I5: no PiP a ficha rola por dentro, tem Fechar e não mostra Flutuar');
  winH.close(); await espera(60);
  delete window.documentPictureInPicture;
  // gestor: trocar o consultor no seletor fecha a ficha do anterior; Livres sem "Pegar" para quem não pega
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  const selDono = document.getElementById('kbDono');
  selDono.innerHTML = '<option value="">Todos</option><option value="u-zz">Zz</option>';
  selDono.value = 'u-zz'; kbEstado.dono = 'u-zz';
  await kbAbrirFicha('OUTUBRO', 'h2');
  selDono.value = ''; selDono.dispatchEvent(new window.Event('change'));
  assert(!kbEstado.fichaAlvo && !kbEstado.hojeSel, 'gestor: trocar o consultor fecha a ficha do anterior');
  kbEstado.filaAba = 'livres'; kbRenderHoje();
  assert(document.querySelector('#kbFilaLista [data-kb-fila]') && !document.querySelector('#kbFilaLista [data-kb-pegar-proximo]'), 'gestor: Livres sem o botão Pegar (ele não pega)');
  kbEstado.filaAba = 'fazer'; kbEstado.dono = ''; selDono.value = '';
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  // I3: sair zera ficha, fila e placar (outro usuário entra na mesma aba do navegador)
  kbTrocarAba('hoje'); await espera(120);
  assert(kbEstado.fichaAlvo, 'pré: Hoje com ficha aberta');
  kbParar();
  assert(!kbEstado.fichaAlvo && !kbEstado.fichaLead && !kbEstado.fichaLista && document.getElementById('kbFichaCorpo').innerHTML === '' && document.getElementById('kbFilaLista').innerHTML === '' && document.getElementById('kbHojeTopo').innerHTML === '', 'I3: sair limpa ficha, fila e placar');
  document.getElementById('panel-meusleads').classList.remove('active');
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
