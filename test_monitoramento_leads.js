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

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
