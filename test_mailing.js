// Testa a aba Mailing (seção 102). Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público (nada de telefone, nome, CPF ou CNPJ real).
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
window.__fnCalls = [];
window.__fnRespostas = {};
function builder(){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b, eq: () => b, not: () => b,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: () => builder(),
  rpc: () => { const p = Promise.resolve({ data: [], error: null }); return { range: () => p, then: (ok, ko) => p.then(ok, ko) }; },
  functions: { invoke: async (nome, opts) => {
    const body = (opts && opts.body) || {};
    window.__fnCalls.push({ nome, body });
    const r = window.__fnRespostas[body.acao];
    return typeof r === 'function' ? r(body) : (r || { data: {}, error: null });
  } },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
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
  const avisos = [];
  mostrarAviso = (msg, tipo) => avisos.push([tipo, String(msg)]);

  // ==== TASK 4: funções puras ====
  eq(mbFiltrosPadrao(), { situacao: ['ATIVA'], excluir_obito: true, tipo: 'CELULAR', origem: 'MAILING' }, 'filtros padrão');
  eq(MB_MAX_QTD, 100000, 'limite de 100 mil');
  const cab = 'nome;descricao;documento1;documento2;fone1;fone2;fone3;fone4;fone5;fone6;fone7;fone8;fone9;fone10;campo1;campo2;campo3;obs;integra1;integra2';
  const cols = ['nome','descricao','documento1','documento2','fone1','campo1','campo2','campo3'];
  eq(mbMontarCsv(cols, []), cab + '\\r\\n', 'só o cabeçalho, terminando em CRLF');
  eq(mbMontarCsv(cols, [['FULANO DE TAL', 'EMPRESA TESTE LTDA', '00000000191', '00000000000191', '11900000001', 'CLARO S.A.', 'MEI', 'SAO PAULO']]),
     cab + '\\r\\nFULANO DE TAL;EMPRESA TESTE LTDA;00000000191;00000000000191;11900000001;;;;;;;;;;CLARO S.A.;MEI;SAO PAULO;;;\\r\\n',
     'linha nas 20 colunas, fone2..fone10 e finais vazios');
  eq(mbMontarCsv(['fone1', 'nome'], [['11900000001', 'FULANO']]).split('\\r\\n')[1].split(';').slice(0, 5),
     ['FULANO', '', '', '', '11900000001'], 'posiciona pelo nome da coluna, não pela ordem recebida');
  eq(mbCampoCsv('A;B'), '"A;B"', 'ponto e vírgula entre aspas');
  eq(mbCampoCsv('DIZ "OI"'), '"DIZ ""OI"""', 'aspas duplicadas');
  eq(mbCampoCsv('L1\\nL2'), '"L1\\nL2"', 'quebra de linha entre aspas');
  eq(mbCampoCsv(null), '', 'nulo vira vazio');
  eq(Array.from(mbParaCp1252('Ação')), [0x41, 0xE7, 0xE3, 0x6F], 'acentos em Windows-1252');
  eq(Array.from(mbParaCp1252('€–')), [0x80, 0x96], 'caracteres próprios do Windows-1252');
  eq(Array.from(mbParaCp1252('漢\\uFFFD😀')), [0x3F, 0x3F, 0x3F], 'fora da tabela vira ?');
  eq(Array.from(mbParaCp1252('\\r\\n')), [0x0D, 0x0A], 'CRLF preservado');
  eq(mbValidarQuantidade('20000'), 20000, 'quantidade simples');
  eq(mbValidarQuantidade('50.000'), 50000, 'aceita milhar com ponto');
  eq(mbValidarQuantidade('100000'), 100000, 'limite exato');
  for(const v of ['100001', '0', '12,5', 'abc', '', null]) eq(mbValidarQuantidade(v), null, 'quantidade inválida: ' + v);
  eq(mbResumoFiltros({ situacao: ['ATIVA'], tipo: 'CELULAR', operadora: ['VIVO', 'TIM'], ddd: [11], excluir_obito: true, origem: 'MAILING' }),
     'DDD 11 · ATIVA · sem óbito · celular · VIVO, TIM · só mailing', 'resumo dos filtros');
  eq(mbResumoFiltros({}), 'sem filtros', 'resumo vazio');
  eq(mbResumoFiltros({ nunca_extraida: true, sem_extracao_dias: 30 }), 'nunca extraídos', 'nunca extraídos vence dias');
  eq(mbTextoCarga({ receita_mes: '2026-09', neo_ate: '2026-10-19', carregado_em: '2026-10-21T12:00:00Z' }),
     'Receita de 2026-09 · operadora do NEO até 19/10/2026 · carregado em 21/10/2026', 'texto da carga');
  eq(mbTextoCarga(null), 'Base ainda não carregada.', 'sem carga');
  eq(mbFmtNum(1234567), '1.234.567', 'milhar pt-BR');

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
