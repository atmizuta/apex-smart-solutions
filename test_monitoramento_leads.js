// Testa o Monitoramento Leads (ligações manuais x leads) e a seção "Meus leads para tratar" (01/10/2026).
// Ver REGRAS_NEGOCIO.md e docs/superpowers/specs/2026-10-01-monitoramento-leads-design.md.
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público (nada de telefone, nome ou CNPJ real).
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
window.__rpcRespostas = {};   // nome da rpc -> { data, error } | função(args)
window.__tabelas = {};        // tabela -> linhas
window.__escritas = [];       // upsert/insert/delete feitos pelo painel
window.__xlsx = [];           // arquivos que o painel mandou baixar
function builder(tabela){
  const linhasFiltradas = () => { const f = b.__eq || {}; return (window.__tabelas[tabela] || []).filter(l => Object.keys(f).every(c => l[c] === undefined || l[c] === f[c])); };
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b,
    eq: (c, v) => { b.__eq = Object.assign(b.__eq || {}, { [c]: v }); return b; },
    upsert: (rows, opts) => { window.__escritas.push({ tabela, op: 'upsert', rows, opts }); return Promise.resolve({ error: window.__erroEscrita || null }); },
    insert: (rows) => { window.__escritas.push({ tabela, op: 'insert', rows }); return Promise.resolve({ error: null }); },
    delete: () => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'delete', filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    maybeSingle: async () => ({ data: linhasFiltradas()[0] || null, error: null }),
    then: (resolve) => resolve({ data: linhasFiltradas(), error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: (wb, nome) => window.__xlsx.push({ wb, nome }) });
window.alert = () => {};
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

  // ==== TASK 2: funções puras ====
  // telefone: formatos diferentes, mesma chave; curto/vazio = null
  eq(chaveTel('p:+5519900000001'), '1900000001', 'chaveTel com 55 e 9º dígito');
  eq(chaveTel('(19) 90000-0001'), '1900000001', 'chaveTel formatado');
  eq(chaveTel(19900000001), '1900000001', 'chaveTel numérico');
  eq(chaveTel('1900000001'), '1900000001', 'chaveTel sem 9º dígito');
  eq(chaveTel('5532221234'), '5532221234', 'DDD 55 (RS) com 10 dígitos não perde o 55');
  eq(chaveTel('123'), null, 'chaveTel curto');
  eq(chaveTel(null), null, 'chaveTel null');
  eq(chaveTel(''), null, 'chaveTel vazio');

  // relatório da telefonia
  const rel = [
    { 'ID': 1001, 'Usuario': 'apex.fulano', 'Telefone': 19900000001, 'Status': 'ANSWERED', 'DataHora_Geracao': '08/09/2026 12:20:59', 'Tempo_Chamada': '00:01:30', 'Última Tabulação': 'SEM CONTATO', 'Transferido': null, 'Gravacao': 'g/1' },
    { 'ID': 1002, 'Usuario': 'apex.fulano', 'Telefone': '(19) 90000-0001', 'Status': 'FAILED', 'DataHora_Geracao': '08/09/2026 23:59:59', 'Tempo_Chamada': null, 'Última Tabulação': '-' },
    { 'ID': 1002, 'Usuario': 'apex.fulano', 'Telefone': 19900000001, 'Status': 'FAILED', 'DataHora_Geracao': '08/09/2026 13:00:00' },
    { 'ID': 1003, 'Usuario': 'apex.fulano', 'Telefone': 19900000001, 'Status': 'ANSWERED', 'DataHora_Geracao': 'data ruim' },
    { 'ID': '', 'Usuario': 'apex.fulano', 'Telefone': 19900000001, 'Status': 'ANSWERED', 'DataHora_Geracao': '08/09/2026 14:00:00' },
  ];
  const p = mlParseRelatorio(rel);
  eq(p.faltando, [], 'relatório completo não falta coluna');
  eq(p.linhas.length, 2, 'ID repetido conta uma vez; data ruim e ID vazio são inválidos');
  eq(p.invalidas, 2, 'duas linhas inválidas');
  eq(p.linhas[0], { id: 1001, usuario: 'apex.fulano', telefone: '19900000001', chave_tel: '1900000001', gerada_em: '2026-09-08T12:20:59-03:00', atendida: true, seg_falados: 90, tabulacao: 'SEM CONTATO', transferido: null, gravacao: 'g/1' }, 'linha 1 convertida');
  assert(p.linhas[1].atendida === false && p.linhas[1].seg_falados === 0 && p.linhas[1].gerada_em === '2026-09-08T23:59:59-03:00', 'linha 2: falhou, 0 s, 23:59 mantém o dia');
  // cabeçalho com outra grafia
  const p2 = mlParseRelatorio([{ ' id ': 5, 'USUÁRIO': 'x', 'telefone': 1, 'STATUS': 'ANSWERED', 'datahora geração': '01/10/2026 09:00' }]);
  eq(p2.faltando, [], 'cabeçalho com acento/caixa/espaço diferente é aceito');
  eq(p2.linhas.length, 1, 'e a linha entra');
  // sem colunas obrigatórias
  const p3 = mlParseRelatorio([{ 'Nome': 'a', 'Valor': 1 }]);
  assert(p3.faltando.length === 5 && p3.linhas.length === 0, 'arquivo errado: todas as obrigatórias faltando e nenhuma linha');
  eq(mlParseRelatorio([]).faltando.length, 5, 'arquivo vazio recusado');

  // metas
  eq(mlMetas(null), ML_METAS_PADRAO, 'sem config = padrão');
  eq(mlMetas('{ruim'), ML_METAS_PADRAO, 'JSON inválido = padrão');
  eq(mlMetas('{"min_tentativas":5}').min_tentativas, 5, 'config sobrescreve só o que veio');
  eq(mlMetas('{"min_tentativas":5}').max_tentativas, 10, 'e mantém o resto');

  // classificação (agora = 2026-10-03 12:00 UTC)
  const agora = Date.parse('2026-10-03T12:00:00Z');
  const L = (id, cat, tent, extra) => Object.assign({ lead_id: id, nome: 'Lead ' + id, telefone: '+55', consultor: 'Caio', status: '', categoria: cat, receita: 0,
    criado_em_lead: '2026-10-03T00:00:00Z', tentativas: tent, atendidas: 0, ultima_ligacao: null }, extra || {});
  const cl = mlClassificarLeads([
    L('a', 'sem_contato', 0, { criado_em_lead: '2026-10-01T00:00:00Z' }),   // 60 h sem ligação -> fila + SLA estourado
    L('b', 'sem_contato', 0, { criado_em_lead: '2026-10-03T08:00:00Z' }),   // 4 h sem ligação -> fila, dentro do SLA
    L('c', 'andamento', 2),                                                 // abaixo do mínimo (3)
    L('d', 'andamento', 3),                                                 // exatamente o mínimo: NÃO é abaixo
    L('e', 'andamento', 10),                                                // exatamente o teto: NÃO é acima
    L('f', 'andamento', 11),                                                // acima do teto
    L('g', 'sem_contato', 4),                                               // planilha desatualizada
    L('h', 'perdido', 1, { status: 'CLIENTE NÃO RESPONDE' }),               // perdido cedo
    L('i', 'perdido', 1, { status: 'CNPJ INAPTO' }),                        // perdido, mas não por "não responde"
    L('j', 'convertido', 0),                                                // venda sem ligação
    L('k', 'convertido', 5),
  ], ML_METAS_PADRAO, agora);
  eq(cl.semLigacao.map(x => x.lead_id), ['a', 'b'], 'fila: só em aberto sem ligação, mais antigo primeiro');
  assert(cl.semLigacao[0].atrasadoSla === true && cl.semLigacao[1].atrasadoSla === false, 'SLA de 24 h: a (60 h) estoura, b (4 h) não');
  eq(cl.abaixoMin.map(x => x.lead_id), ['c'], 'abaixo do mínimo: só o c (2 tentativas)');
  eq(cl.acimaTeto.map(x => x.lead_id), ['f'], 'acima do teto: só o f (11)');
  eq(cl.inconsistencias.planilhaDesatualizada.map(x => x.lead_id), ['g'], 'sem_contato com 4 ligações');
  eq(cl.inconsistencias.perdidoCedo.map(x => x.lead_id), ['h'], 'perdido por "não responde" com 1 tentativa');
  eq(cl.inconsistencias.vendaSemLigacao.map(x => x.lead_id), ['j'], 'venda sem nenhuma ligação');
  const vazio = mlClassificarLeads([], ML_METAS_PADRAO, agora);
  assert(vazio.semLigacao.length === 0 && vazio.inconsistencias.vendaSemLigacao.length === 0, 'lista vazia não quebra');
  assert(mlClassificarLeads(null, null, agora).semLigacao.length === 0, 'null não quebra');

  // cards da equipe
  const equipe = [{ id: 1, nome_planilha: 'Caio', usuario_telefonia: 'apex.caiocosta', monitorar: true }, { id: 2, nome_planilha: 'Zé', usuario_telefonia: null, monitorar: false }, { id: 3, nome_planilha: 'Luria', usuario_telefonia: 'Apex.luria', monitorar: true }];
  const cards = mlCardsEquipe(equipe, [
    L('1', 'convertido', 2, { receita: 100 }), L('2', 'convertido', 1, { receita: 50 }), L('3', 'perdido', 3), L('4', 'andamento', 0), L('5', 'sem_contato', 0),
    L('6', 'convertido', 1, { consultor: 'caio ' }),
  ]);
  eq(cards.map(c => c.nome), ['Caio', 'Luria'], 'só quem é monitorado, na ordem da equipe');
  eq(cards[0], { nome: 'Caio', usuario: 'apex.caiocosta', leads: 6, convertidos: 3, perdidos: 1, andamento: 1, semContato: 1, receita: 150, ticket: 50, taxa: 0.5, semLigacao: 2 }, 'card do Caio (nome da planilha sem acento/caixa/espaço)');
  eq(cards[1], { nome: 'Luria', usuario: 'Apex.luria', leads: 0, convertidos: 0, perdidos: 0, andamento: 0, semContato: 0, receita: 0, ticket: 0, taxa: 0, semLigacao: 0 }, 'quem não tem lead fica com zeros (sem NaN)');

  // ==== TASK 3: sub-abas, carga e cards ====
  const equipeBanco = [
    { id: 1, nome_planilha: 'Caio', usuario_telefonia: 'apex.caiocosta', profile_id: null, monitorar: true },
    { id: 2, nome_planilha: 'Luria', usuario_telefonia: 'Apex.luria', profile_id: null, monitorar: true },
    { id: 3, nome_planilha: 'Zé', usuario_telefonia: null, profile_id: null, monitorar: false },
  ];
  const leadsOut = [
    L('o1', 'convertido', 2, { receita: 200, consultor: 'Caio' }), L('o2', 'perdido', 3, { consultor: 'Caio' }),
    L('o3', 'andamento', 0, { consultor: 'Luria' }), L('o4', 'sem_contato', 0, { consultor: 'Luria' }),
  ];
  window.__tabelas.leads_equipe = equipeBanco;
  window.__rpcRespostas.monitor_leads_leads = { data: leadsOut, error: null };
  window.__rpcRespostas.monitor_ligacoes_resumo = { data: [{ total: 10, primeira: '2026-10-01T12:00:00Z', ultima: '2026-10-03T12:00:00Z', ultima_importacao: '2026-10-03T13:00:00Z' }], error: null };
  conversaoLeadsCache = [{ aba: 'OUTUBRO' }, { aba: 'OUTUBRO' }, { aba: 'SETEMBRO' }];
  conversaoAbaAtual = 'OUTUBRO';

  // consultor: sem barra, e pedir "monitor" cai em "leads" sem chamar a RPC de admin
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  digitalSubPreparar();
  assert(document.getElementById('digitalSubTabs').style.display === 'none', 'consultor não vê a barra de sub-abas');
  digitalSubAtivar('monitor');
  await espera(30);
  assert(document.getElementById('digitalSubMonitor').style.display === 'none' && document.getElementById('digitalSubLeads').style.display !== 'none', 'consultor continua em "Leads"');
  assert(!window.__rpcCalls.some(c => c.nome === 'monitor_leads_leads'), 'consultor não dispara a RPC de admin');
  await mlCarregar();
  assert(!window.__rpcCalls.some(c => c.nome === 'monitor_leads_leads'), 'mlCarregar não faz nada para consultor');

  // admin: barra aparece, abrir o monitoramento carrega e desenha os cards
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  digitalSubPreparar();
  assert(document.getElementById('digitalSubTabs').style.display !== 'none', 'admin vê a barra de sub-abas');
  document.querySelector('#digitalSubTabs [data-digital-sub="monitor"]').click();
  await espera(60);
  assert(document.getElementById('digitalSubMonitor').style.display !== 'none' && document.getElementById('digitalSubLeads').style.display === 'none', 'monitor visível, leads escondido');
  const chamada = window.__rpcCalls.filter(c => c.nome === 'monitor_leads_leads').pop();
  assert(chamada && chamada.args.p_aba === 'OUTUBRO', 'busca os leads da aba escolhida (OUTUBRO)');
  const cs = [...document.querySelectorAll('#mlCards .mlCard')];
  eq(cs.map(c => c.dataset.mlCard), ['Caio', 'Luria'], 'um card por consultor monitorado (Zé não)');
  assert(cs[0].textContent.includes('50,0%') && cs[0].textContent.includes('1 venda') && cs[0].textContent.includes('R$'), 'card do Caio: 50,0%, 1 venda, receita');
  assert(cs[1].textContent.includes('0,0%') && cs[1].textContent.includes('Sem ligação 2'), 'card da Luria: 0,0% e 2 sem ligação');
  assert(!/NaN|undefined/.test(document.getElementById('digitalSubMonitor').textContent), 'nada de NaN/undefined na tela');
  assert(document.getElementById('mlResumoRelatorio').textContent.includes('10 ligações'), 'cabeçalho mostra quantas ligações estão guardadas');
  eq([...document.querySelectorAll('#mlAbaPills .filterPill')].map(b => b.textContent.replace(/\s+/g, ' ').trim()), ['Outubro 2', 'Setembro 1'], 'pílulas de mês no monitoramento');

  // trocar o mês no monitoramento recarrega com a aba nova
  document.querySelector('#mlAbaPills [data-ml-aba="SETEMBRO"]').click();
  await espera(60);
  assert(conversaoAbaAtual === 'SETEMBRO' && window.__rpcCalls.filter(c => c.nome === 'monitor_leads_leads').pop().args.p_aba === 'SETEMBRO', 'trocar a pílula recarrega com SETEMBRO');
  conversaoAbaAtual = 'OUTUBRO';
  await mlCarregar();

  // clicar num card filtra; clicar de novo limpa
  document.querySelector('#mlCards [data-ml-card="Caio"]').click();
  eq(mlLeadsFiltrados().map(l => l.lead_id), ['o1', 'o2'], 'filtro por consultor');
  assert(document.querySelector('#mlCards [data-ml-card="Caio"]').classList.contains('ativo'), 'card ativo marcado');
  document.querySelector('#mlCards [data-ml-card="Caio"]').click();
  eq(mlLeadsFiltrados().length, 4, 'segundo clique limpa o filtro');

  // vazio: sem equipe monitorada, sem leads, sem relatório
  window.__tabelas.leads_equipe = [];
  window.__rpcRespostas.monitor_leads_leads = { data: [], error: null };
  window.__rpcRespostas.monitor_ligacoes_resumo = { data: [], error: null };
  await mlCarregar();
  assert(document.getElementById('mlCards').textContent.includes('Nenhum consultor'), 'sem equipe: mensagem em vez de cards');
  assert(document.getElementById('mlResumoRelatorio').textContent.includes('Nenhum relatório'), 'sem relatório: mensagem');
  assert(!/NaN|undefined/.test(document.getElementById('digitalSubMonitor').textContent), 'vazio também sem NaN/undefined');

  // erro da RPC (migration ainda não aplicada): aviso, sem quebrar
  window.__rpcRespostas.monitor_leads_leads = { data: null, error: { message: 'function does not exist' } };
  await mlCarregar();
  assert(document.getElementById('mlErro').style.display !== 'none', 'erro mostra o aviso de que não foi possível carregar');

  // ==== TASK 4: upload ====
  // o mock "guarda" os ids enviados por upsert; o RPC de resumo devolve o total guardado (base 5 + ids únicos enviados)
  const idsGuardados = () => new Set(window.__escritas.filter(e => e.tabela === 'ligacoes_manuais' && e.op === 'upsert').flatMap(e => e.rows.map(r => r.id)));
  window.__rpcRespostas.monitor_ligacoes_resumo = () => ({ data: [{ total: 5 + idsGuardados().size, primeira: '2026-10-01T12:00:00Z', ultima: '2026-10-03T12:00:00Z' }], error: null });
  window.__rpcRespostas.monitor_leads_leads = { data: leadsOut, error: null };
  window.__tabelas.leads_equipe = equipeBanco;
  window.__escritas.length = 0;
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  digitalSubAtivar('monitor');
  await espera(60);

  // arquivo de verdade (SheetJS): cabeçalho na 1ª linha, 1ª planilha
  const wbT = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbT, XLSX.utils.aoa_to_sheet([
    ['ID', 'Usuario', 'Telefone', 'Status', 'DataHora_Geracao', 'Tempo_Chamada', 'Última Tabulação'],
    [9001, 'apex.caiocosta', 19900000001, 'ANSWERED', '02/10/2026 10:00:00', '00:02:00', 'RETORNO'],
    [9002, 'apex.caiocosta', 19900000002, 'FAILED', '02/10/2026 10:05:00', null, '-'],
  ]), 'Plan1');
  const linhasWb = mlLinhasDoWorkbook(wbT);
  eq(linhasWb.length, 2, 'workbook: 2 linhas de dados');
  eq(mlParseRelatorio(linhasWb).linhas.map(l => l.id), [9001, 9002], 'workbook -> relatório -> 2 ligações');

  // arquivo errado: recusa e não grava
  let r = await mlImportarLinhas([{ Nome: 'x', Valor: 1 }]);
  assert(r === null && window.__escritas.length === 0, 'arquivo errado não grava nada');
  assert(document.getElementById('mlUploadStatus').textContent.includes('recusado'), 'mostra que recusou');

  // arquivo bom: grava, conta novas
  r = await mlImportarLinhas(linhasWb);
  const up = window.__escritas.filter(e => e.tabela === 'ligacoes_manuais' && e.op === 'upsert');
  assert(up.length === 1 && up[0].rows.length === 2 && up[0].opts.onConflict === 'id', 'um lote, 2 linhas, upsert por id');
  assert(up[0].rows.every(l => l.importado_por === 'a1'), 'registra quem importou');
  assert(r.lidas === 2 && r.novas === 2 && r.existentes === 0 && r.invalidas === 0, 'resumo: 2 lidas, 2 novas');
  assert(document.getElementById('mlUploadResumo').textContent.includes('2'), 'resumo aparece na tela');
  assert(window.__rpcCalls.filter(c => c.nome === 'monitor_leads_leads').length >= 2, 'depois de importar, recarrega o monitoramento');

  // reenviar o mesmo arquivo: 0 novas
  r = await mlImportarLinhas(linhasWb);
  assert(r.novas === 0 && r.existentes === 2, 'mesmo arquivo de novo: 0 novas, 2 já existiam');

  // lotes de 500
  window.__escritas.length = 0;
  const grande = []; for(let i = 0; i < 1203; i++) grande.push({ ID: 20000 + i, Usuario: 'apex.x', Telefone: 19900000000 + i, Status: 'FAILED', DataHora_Geracao: '03/10/2026 09:00:00' });
  grande.push({ ID: 'ruim', Usuario: 'apex.x', Telefone: 1, Status: 'FAILED', DataHora_Geracao: '03/10/2026 09:00:00' });
  r = await mlImportarLinhas(grande);
  eq(window.__escritas.filter(e => e.tabela === 'ligacoes_manuais').map(e => e.rows.length), [500, 500, 203], 'três lotes: 500, 500, 203');
  assert(r.lidas === 1203 && r.invalidas === 1, 'linha inválida contada, não enviada');

  // equipe sem ligação no arquivo é avisada
  assert(document.getElementById('mlUploadStatus').textContent.includes('Caio') && document.getElementById('mlUploadStatus').textContent.includes('Luria'), 'avisa quem da equipe não aparece no arquivo');

  // erro de gravação: avisa e não derruba
  window.__erroEscrita = { message: 'permission denied' };
  r = await mlImportarLinhas(linhasWb);
  assert(r === null && document.getElementById('mlUploadStatus').textContent.includes('Não foi possível'), 'erro de gravação mostra mensagem');
  window.__erroEscrita = null;

  // ==== TASK 5: fila, cadência, inconsistências ====
  const agoraIso = new Date().toISOString();
  const leadsFila = [
    L('f1', 'sem_contato', 0, { nome: 'Fila Antigo', consultor: 'Caio', telefone: 'p:+5519900000011', criado_em_lead: '2020-01-01T00:00:00Z' }),
    L('f2', 'sem_contato', 0, { nome: 'Fila Novo', consultor: 'Luria', criado_em_lead: agoraIso }),
    L('f3', 'andamento', 1, { nome: 'Abaixo Um', consultor: 'Caio', status: 'EM NEGOCIAÇÃO' }),
    L('f4', 'andamento', 12, { nome: 'Acima Um', consultor: 'Luria', status: 'AGUARDANDO CLIENTE', ultima_ligacao: '2026-10-03T15:00:00Z' }),
    L('f5', 'sem_contato', 5, { nome: 'Desatualizado Um', consultor: 'Caio' }),
    L('f6', 'perdido', 1, { nome: 'Perdido Cedo', consultor: 'Luria', status: 'CLIENTE NÃO RESPONDE' }),
    L('f7', 'convertido', 0, { nome: 'Venda Sem Ligacao', consultor: 'Caio', receita: 100 }),
  ];
  window.__tabelas.leads_equipe = equipeBanco;
  window.__rpcRespostas.monitor_leads_leads = { data: leadsFila, error: null };
  window.__rpcRespostas.monitor_ligacoes_resumo = { data: [], error: null };
  mlEstado.filtro = '';
  await mlCarregar();
  const linhasFila = [...document.querySelectorAll('#mlFilaTbody tr')];
  eq(linhasFila.map(tr => tr.children[0].textContent.trim()), ['Fila Antigo', 'Fila Novo'], 'fila: dois leads, o mais antigo primeiro');
  assert(linhasFila[0].children[4].classList.contains('mlAtraso') && !linhasFila[1].children[4].classList.contains('mlAtraso'), 'só o lead antigo estoura o SLA (vermelho)');
  assert(linhasFila[0].querySelector('[data-ml-copiar="+5519900000011"]'), 'botão de copiar o telefone (sem o prefixo p:)');
  assert(document.getElementById('mlFilaInfo').textContent.includes('2 leads') && document.getElementById('mlFilaInfo').textContent.includes('1 acima do SLA'), 'resumo da fila');
  eq([...document.querySelectorAll('#mlAbaixoTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Abaixo Um'], 'abaixo do mínimo');
  eq([...document.querySelectorAll('#mlAcimaTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Acima Um'], 'acima do teto');
  const inc = document.getElementById('mlInconsLista').textContent;
  assert(inc.includes('Desatualizado Um') && inc.includes('Perdido Cedo') && inc.includes('Venda Sem Ligacao'), 'as três inconsistências aparecem');

  // filtro por consultor afeta os blocos
  mlEstado.filtro = 'Luria'; mlRenderTudo();
  eq([...document.querySelectorAll('#mlFilaTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Fila Novo'], 'filtro Luria: só a fila dela');
  mlEstado.filtro = '';

  // vazio: mensagens, sem NaN
  window.__rpcRespostas.monitor_leads_leads = { data: [], error: null };
  await mlCarregar();
  assert(document.getElementById('mlFilaTbody').textContent.includes('Nenhum lead') && document.getElementById('mlAbaixoTbody').textContent.includes('Nenhum') && document.getElementById('mlInconsLista').textContent.includes('Nenhuma'), 'listas vazias mostram mensagem');
  assert(!/NaN|undefined/.test(document.getElementById('digitalSubMonitor').textContent), 'listas vazias sem NaN/undefined');

  // inconsistências muito longas: mostra 10 e resume o resto
  window.__rpcRespostas.monitor_leads_leads = { data: Array.from({ length: 14 }, (_, i) => L('v' + i, 'convertido', 0, { nome: 'Venda ' + i })), error: null };
  await mlCarregar();
  assert(document.getElementById('mlInconsLista').textContent.includes('e mais 4'), 'inconsistência com 14 leads mostra 10 e "e mais 4"');

  // ==== TASK 6: ligações por consultor ====
  const U = (usuario, extra) => Object.assign({ usuario, total: 0, lig_leads: 0, atend_leads: 0, leads_distintos: 0, seg_leads: 0, boas_leads: 0, atend_sem_contato: 0,
    h_hoje: 0, h_ontem: 0, h_7: 0, h_30: 0, hoje_atend: 0, hoje_leads: 0, hoje_seg: 0, hoje_ultima: null }, extra || {});
  const porUsu = [
    U('apex.caiocosta', { total: 100, lig_leads: 40, atend_leads: 20, leads_distintos: 10, seg_leads: 1800, boas_leads: 5, atend_sem_contato: 3, h_hoje: 30, h_ontem: 25, h_7: 150, h_30: 300, hoje_atend: 12, hoje_leads: 9, hoje_seg: 600, hoje_ultima: '2026-10-03T15:00:00Z' }),
    U('apex.outro', { total: 50 }),
  ];
  const eqP = [{ nome_planilha: 'Caio', usuario_telefonia: 'apex.caiocosta', monitorar: true }, { nome_planilha: 'Luria', usuario_telefonia: 'Apex.luria', monitorar: true }, { nome_planilha: 'Zé', usuario_telefonia: 'apex.ze', monitorar: false }];
  const pl = mlPlacarLinhas(porUsu, eqP, ML_METAS_PADRAO);
  eq(pl.map(x => x.nome), ['Caio', 'Luria'], 'placar: só os monitorados');
  eq(pl[0], { nome: 'Caio', usuario: 'apex.caiocosta', ligHoje: 30, atendidasHoje: 12, leadsHoje: 9, minHoje: 10, pctMeta: 0.375, ultima: '2026-10-03T15:00:00Z' }, 'placar do Caio (30 de 80 = 37,5%)');
  eq(pl[1], { nome: 'Luria', usuario: 'Apex.luria', ligHoje: 0, atendidasHoje: 0, leadsHoje: 0, minHoje: 0, pctMeta: 0, ultima: null }, 'quem não aparece no relatório fica zerado');
  assert(mlPlacarLinhas(porUsu, eqP, { meta_ligacoes_dia: 0 })[0].pctMeta === null, 'meta 0 não divide por zero');
  const ql = mlQualidadeLinhas(porUsu, eqP);
  eq(ql[0], { nome: 'Caio', ligLeads: 40, taxaAtend: 0.5, mediaSeg: 90, boas: 5, atendSemContato: 3 }, 'qualidade do Caio: 50% atendidas, 90 s médios');
  eq(ql[1], { nome: 'Luria', ligLeads: 0, taxaAtend: 0, mediaSeg: 0, boas: 0, atendSemContato: 0 }, 'qualidade sem ligações: zeros, sem NaN');
  const tq = mlTabelaLinhas(porUsu, eqP, 'equipe');
  eq(tq.map(x => x.nome), ['Caio', 'Luria'], 'tabela "os 4": só os monitorados');
  eq(tq[0], { usuario: 'apex.caiocosta', nome: 'Caio', total: 100, ligLeads: 40, pctTotal: 0.4, atendidas: 20, leadsDistintos: 10, tentativasPorLead: 4, hoje: 30, ontem: 25, d7: 150, d30: 300 }, 'linha do Caio (40% do total, 4 tentativas por lead)');
  const tt = mlTabelaLinhas(porUsu, eqP, 'todos');
  eq(tt.map(x => x.nome), ['Caio', 'apex.outro'], 'tabela "todos": todo usuário do relatório, ordem por ligações para lead; sem perfil mostra o login');
  assert(tt[1].pctTotal === 0 && tt[1].tentativasPorLead === 0, 'usuário sem ligação para lead: 0% e 0 tentativas, sem NaN');

  // tela: carga, período padrão, abas, placar, qualidade
  window.__tabelas.leads_equipe = equipeBanco;
  window.__rpcRespostas.monitor_leads_leads = { data: leadsOut, error: null };
  window.__rpcRespostas.monitor_ligacoes_resumo = { data: [], error: null };
  window.__rpcRespostas.monitor_ligacoes_por_usuario = { data: porUsu, error: null };
  mlEstado.de = undefined; mlEstado.ate = undefined; mlEstado.tabela = 'equipe'; mlEstado.filtro = '';
  window.__rpcCalls.length = 0;
  await mlCarregar();
  const cu = window.__rpcCalls.filter(c => c.nome === 'monitor_ligacoes_por_usuario').pop();
  const hojeT = hojeSP();
  assert(cu && cu.args.p_ref === hojeT && cu.args.p_de === hojeT.slice(0, 8) + '01' && cu.args.p_ate === hojeT, 'padrão: 1º dia do mês até hoje, ref = hoje');
  assert(document.getElementById('mlPeriodoDe').value === hojeT.slice(0, 8) + '01', 'campos de data refletem o período');
  assert(document.querySelector('#mlPlacarTbody tr td').textContent.trim() === 'Caio' && document.getElementById('mlPlacarTbody').textContent.includes('37,5%'), 'placar na tela (37,5%)');
  assert(document.getElementById('mlQualidadeTbody').textContent.includes('1 min 30 s'), 'qualidade na tela (90 s médios = 1 min 30 s)');
  eq([...document.querySelectorAll('#mlTabelaTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Caio', 'Luria'], 'tabela: os consultores de leads');
  document.querySelector('#mlTabelaPills [data-ml-tabela="todos"]').click();
  eq([...document.querySelectorAll('#mlTabelaTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Caio', 'apex.outro'], 'tabela: todos os consultores');
  assert(document.querySelector('#mlTabelaPills [data-ml-tabela="todos"]').classList.contains('active'), 'pílula ativa');

  // mudar o período refaz a consulta
  const campoDe = document.getElementById('mlPeriodoDe'); campoDe.value = '2026-10-02';
  campoDe.dispatchEvent(new window.Event('change'));
  await espera(60);
  assert(window.__rpcCalls.filter(c => c.nome === 'monitor_ligacoes_por_usuario').pop().args.p_de === '2026-10-02', 'mudar "De" consulta de novo com a data nova');
  // limpar os dois campos = sem limite (null)
  campoDe.value = ''; document.getElementById('mlPeriodoAte').value = '';
  campoDe.dispatchEvent(new window.Event('change'));
  await espera(60);
  const semLimite = window.__rpcCalls.filter(c => c.nome === 'monitor_ligacoes_por_usuario').pop().args;
  assert(semLimite.p_de === null && semLimite.p_ate === null, 'campos vazios = sem limite de datas');

  // sem relatório: tudo zerado, sem NaN
  window.__rpcRespostas.monitor_ligacoes_por_usuario = { data: [], error: null };
  await mlCarregar();
  assert(!/NaN|undefined/.test(document.getElementById('digitalSubMonitor').textContent), 'sem ligações guardadas: sem NaN/undefined');

  // ==== TASK 7: editor da equipe e das metas ====
  window.__tabelas.profiles = [{ id: 'p1', nome: 'Caio Costa', username: 'caio', role: 'consultor' }, { id: 'p2', nome: 'Luria Teste', username: 'luria', role: 'consultor' }];
  window.__tabelas.leads_equipe = JSON.parse(JSON.stringify(equipeBanco));
  window.__tabelas.config = [];
  window.__rpcRespostas.monitor_leads_leads = { data: [], error: null };
  window.__rpcRespostas.monitor_ligacoes_por_usuario = { data: [], error: null };
  mlEstado.filtro = '';
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'supervisor' };
  await mlCarregar();
  assert(document.getElementById('mlEquipeCard').style.display === 'none', 'supervisor não vê o editor da equipe');
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  await mlCarregar();
  assert(document.getElementById('mlEquipeCard').style.display !== 'none', 'admin vê o editor');
  const trs = () => [...document.querySelectorAll('#mlEquipeTbody tr[data-ml-eq-id]')];
  eq(trs().length, 3, 'uma linha por pessoa da equipe');
  eq([...trs()[0].querySelectorAll('.mlEqPerfil option')].map(o => o.value), ['', 'p1', 'p2'], 'opções: sem perfil + perfis do painel');
  eq(trs()[0].querySelector('.mlEqNome').value, 'Caio', 'nome na planilha preenchido');
  assert(trs()[0].querySelector('.mlEqMonitorar').checked === true && trs()[2].querySelector('.mlEqMonitorar').checked === false, 'monitorar reflete o banco');

  // ligar perfis e salvar
  trs()[0].querySelector('.mlEqPerfil').value = 'p1';
  trs()[1].querySelector('.mlEqPerfil').value = 'p2';
  window.__escritas.length = 0;
  document.getElementById('btnMlEquipeSalvar').click();
  await espera(60);
  const upEq = window.__escritas.find(e => e.tabela === 'leads_equipe' && e.op === 'upsert');
  assert(upEq && upEq.opts.onConflict === 'id' && upEq.rows.length === 3, 'salva as 3 linhas existentes por id');
  assert(upEq.rows.find(r => r.id === 1).profile_id === 'p1' && upEq.rows.find(r => r.id === 2).profile_id === 'p2' && upEq.rows.find(r => r.id === 3).profile_id === null, 'perfis gravados (vazio = null)');
  assert(upEq.rows.find(r => r.id === 1).monitorar === true && upEq.rows.find(r => r.id === 3).monitorar === false, 'monitorar gravado');

  // o mesmo perfil em duas pessoas: recusa sem gravar
  await mlCarregar();
  trs()[0].querySelector('.mlEqPerfil').value = 'p1';
  trs()[1].querySelector('.mlEqPerfil').value = 'p1';
  window.__escritas.length = 0;
  document.getElementById('btnMlEquipeSalvar').click();
  await espera(60);
  assert(window.__escritas.length === 0, 'perfil repetido não grava nada');

  // adicionar pessoa nova (sem id) -> insert; nome vazio é ignorado
  await mlCarregar();
  document.getElementById('btnMlEquipeAdd').click();
  eq(trs().length, 4, 'adicionar cria uma linha em branco');
  document.getElementById('btnMlEquipeSalvar').click();
  await espera(60);
  assert(!window.__escritas.some(e => e.op === 'insert'), 'linha nova sem nome não é gravada');
  document.getElementById('btnMlEquipeAdd').click();   // o salvar acima recarregou a tela e tirou a linha em branco
  eq(trs().length, 4, 'linha em branco de novo');
  const nova = trs()[3];
  nova.querySelector('.mlEqNome').value = '  Novo Consultor ';
  nova.querySelector('.mlEqUsuario').value = 'apex.novo';
  window.__escritas.length = 0;
  document.getElementById('btnMlEquipeSalvar').click();
  await espera(60);
  const ins = window.__escritas.find(e => e.tabela === 'leads_equipe' && e.op === 'insert');
  assert(ins && ins.rows.length === 1 && ins.rows[0].nome_planilha === 'Novo Consultor' && ins.rows[0].usuario_telefonia === 'apex.novo' && ins.rows[0].id === undefined, 'insert da pessoa nova, nome sem espaços sobrando');

  // remover pessoa já gravada
  await mlCarregar();
  window.__escritas.length = 0;
  trs()[2].querySelector('[data-ml-eq-del]').click();
  await espera(60);
  assert(window.__escritas.some(e => e.tabela === 'leads_equipe' && e.op === 'delete' && e.filtro.id === 3), 'remover apaga a pessoa certa (id 3)');

  // metas
  const meta = k => document.querySelector('#mlMetasCampos [data-ml-meta="' + k + '"]');
  eq([meta('min_tentativas').value, meta('max_tentativas').value, meta('meta_ligacoes_dia').value, meta('conversa_boa_seg').value, meta('sla_primeira_ligacao_h').value], ['3', '10', '80', '60', '24'], 'metas padrão nos campos');
  meta('min_tentativas').value = '12';
  window.__escritas.length = 0;
  document.getElementById('btnMlMetasSalvar').click();
  await espera(60);
  assert(window.__escritas.length === 0, 'mínimo maior que o teto: recusa sem gravar');
  meta('min_tentativas').value = '4'; meta('max_tentativas').value = '12';
  document.getElementById('btnMlMetasSalvar').click();
  await espera(60);
  const upM = window.__escritas.find(e => e.tabela === 'config' && e.op === 'upsert');
  assert(upM && upM.opts.onConflict === 'chave' && upM.rows.chave === 'monitor_leads_metas', 'grava em config.monitor_leads_metas');
  const gravadas = JSON.parse(upM.rows.valor);
  assert(gravadas.min_tentativas === 4 && gravadas.max_tentativas === 12 && gravadas.meta_ligacoes_dia === 80, 'metas gravadas como JSON completo');
  meta('meta_ligacoes_dia').value = 'abc';
  window.__escritas.length = 0;
  document.getElementById('btnMlMetasSalvar').click();
  await espera(60);
  assert(window.__escritas.length === 0, 'valor que não é número não grava');

  // ==== TASK 8: exportar Excel ====
  window.__rpcRespostas.monitor_leads_leads = { data: leadsFila, error: null };
  window.__rpcRespostas.monitor_ligacoes_por_usuario = { data: porUsu, error: null };
  window.__tabelas.leads_equipe = JSON.parse(JSON.stringify(equipeBanco));
  mlEstado.de = undefined; mlEstado.ate = undefined; mlEstado.tabela = 'equipe';
  conversaoAbaAtual = 'OUTUBRO';
  await mlCarregar();
  window.__xlsx.length = 0;
  document.getElementById('btnMlExportFila').click();
  assert(window.__xlsx.length === 1 && /^LeadsSemLigacao_OUTUBRO_\\d{4}-\\d{2}-\\d{2}\\.xlsx$/.test(window.__xlsx[0].nome), 'exporta a fila com nome \da aba e \data');
  const wbF = window.__xlsx[0].wb;
  eq(wbF.SheetNames, ['Sem ligação', 'Abaixo do mínimo', 'Acima do teto', 'Inconsistências'], 'abas do arquivo da fila');
  const linhasF = XLSX.utils.sheet_to_json(wbF.Sheets['Sem ligação']);
  eq(linhasF.map(l => l.Lead), ['Fila Antigo', 'Fila Novo'], 'linhas da fila, mais antigo primeiro');
  assert(linhasF[0].Telefone === '+5519900000011' && linhasF[0]['Acima do SLA'] === 'Sim' && linhasF[1]['Acima do SLA'] === 'Não', 'telefone sem "p:" e SLA como Sim/Não');
  const incF = XLSX.utils.sheet_to_json(wbF.Sheets['Inconsistências']);
  assert(incF.some(l => l.Tipo === 'Planilha desatualizada' && l.Lead === 'Desatualizado Um'), 'inconsistências exportadas com o tipo');
  // lista vazia vira uma linha de aviso (planilha sem linhas confunde o Excel)
  window.__rpcRespostas.monitor_leads_leads = { data: [], error: null };
  await mlCarregar();
  window.__xlsx.length = 0;
  document.getElementById('btnMlExportFila').click();
  eq(XLSX.utils.sheet_to_json(window.__xlsx[0].wb.Sheets['Sem ligação']), [{ Aviso: 'Nada para exportar' }], 'sem linhas: aviso em vez de aba vazia');

  // tabela por consultor
  window.__xlsx.length = 0;
  document.getElementById('btnMlExportTabela').click();
  assert(window.__xlsx.length === 1 && /^LigacoesPorConsultor_\\d{4}-\\d{2}-\\d{2}_\\d{4}-\\d{2}-\\d{2}\\.xlsx$/.test(window.__xlsx[0].nome), 'exporta a tabela com o perío\do no nome');
  const linhasT = XLSX.utils.sheet_to_json(window.__xlsx[0].wb.Sheets['Ligações por consultor']);
  eq(linhasT.map(l => l.Consultor), ['Caio', 'Luria'], 'tabela exportada = a que está na tela (os consultores de leads)');
  assert(linhasT[0]['Ligações para leads'] === 40 && linhasT[0]['Tentativas por lead'] === 4 && linhasT[0]['% do total'] === '40,0%', 'colunas e valores do Caio');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
