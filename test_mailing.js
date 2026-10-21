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

  // ==== TASK 5: aba ====
  const chamadas = window.__fnCalls;
  const sel = id => Array.from(document.getElementById(id).selectedOptions).map(o => o.value);
  const opts = id => Array.from(document.getElementById(id).options).map(o => o.value);
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor', operacao: 'apex' };
  mbAplicarPermissao();
  eq(document.getElementById('tabBtnMailing').style.display, 'none', 'consultor não vê a aba');
  chamadas.length = 0; await mbCarregar(); await espera(20);
  eq(chamadas.length, 0, 'consultor não chama a função');
  currentUser = { id: 's2', nome: 'Sup Campinas', username: 'supc', role: 'supervisor', operacao: 'campinas' };
  mbAplicarPermissao();
  eq(document.getElementById('tabBtnMailing').style.display, 'inline-block', 'supervisor de qualquer operação vê a aba');

  window.__fnRespostas.opcoes = { data: { opcoes: [
    { tipo: 'uf', valor: 'SP', rotulo: 'SP', uf: null }, { tipo: 'uf', valor: 'RJ', rotulo: 'RJ', uf: null },
    { tipo: 'municipio', valor: '7107', rotulo: 'SAO PAULO', uf: 'SP' }, { tipo: 'municipio', valor: '6001', rotulo: 'RIO DE JANEIRO', uf: 'RJ' },
    { tipo: 'ddd', valor: '11', rotulo: '11', uf: null },
    { tipo: 'situacao', valor: 'ATIVA', rotulo: 'ATIVA', uf: null }, { tipo: 'situacao', valor: 'BAIXADA', rotulo: 'BAIXADA', uf: null },
    { tipo: 'porte', valor: 'MEI', rotulo: 'MEI', uf: null }, { tipo: 'classe', valor: 'B', rotulo: 'B', uf: null },
    { tipo: 'cnae', valor: '9602501', rotulo: '9602501 — Cabeleireiros, manicure e pedicure', uf: null },
    { tipo: 'cnae', valor: '4781400', rotulo: '4781400 — Comércio varejista de vestuário', uf: null },
    { tipo: 'operadora', valor: 'VIVO', rotulo: 'Vivo', uf: null }, { tipo: 'operadora', valor: 'SEM', rotulo: 'Sem operadora', uf: null },
  ], carga: { receita_mes: '2026-09', neo_ate: '2026-10-19', carregado_em: '2026-10-21T12:00:00Z' } }, error: null };
  window.__fnRespostas.historico = { data: { extracoes: [ { criado_em: '2026-10-21T13:00:00Z', username: 'adm', role: 'admin', operacao: 'apex',
    nome_carga: 'TESTE-1', filtros: { situacao: ['ATIVA'] }, total_no_filtro: 5000, quantidade_pedida: 100, quantidade_entregue: 100 } ] }, error: null };
  chamadas.length = 0;
  await mbCarregar(); await espera(30);
  eq(chamadas.map(c => c.nome + ':' + c.body.acao).sort(), ['mailing-api:historico', 'mailing-api:opcoes'], 'abrir a aba busca opções e histórico');
  assert(document.getElementById('mbStatus').textContent.includes('Receita de 2026-09'), 'status mostra a data da carga');
  eq(opts('mbUf'), ['SP', 'RJ'], 'UFs preenchidas');
  eq(sel('mbSituacao'), ['ATIVA'], 'situação padrão ATIVA');
  assert(document.getElementById('mbHistorico').innerHTML.includes('TESTE-1'), 'histórico listado');
  chamadas.length = 0;
  await mbCarregar(); await espera(30);
  eq(chamadas.map(c => c.body.acao), ['historico'], 'reabrir a aba só atualiza o histórico');

  document.getElementById('mbUf').options[1].selected = true;
  document.getElementById('mbUf').dispatchEvent(new window.Event('change'));
  eq(opts('mbMunicipio'), ['6001'], 'cidades só da UF escolhida');
  const busca = document.getElementById('mbCnaeBusca');
  busca.value = 'cabel'; busca.dispatchEvent(new window.Event('input'));
  eq(opts('mbCnae'), ['9602501'], 'busca de CNAE pela descrição');
  document.getElementById('mbCnae').options[0].selected = true;
  document.getElementById('mbOperadora').options[0].selected = true;
  document.getElementById('mbUso').value = 'dias'; document.getElementById('mbUso').dispatchEvent(new window.Event('change'));
  eq(document.getElementById('mbUsoDias').style.display, '', 'escolher "não extraídos há…" mostra o campo de dias');
  document.getElementById('mbUsoDias').value = '45';
  eq(mbLerFiltros(), { uf: ['RJ'], situacao: ['ATIVA'], operadora: ['VIVO'], cnae: [9602501], excluir_obito: true, tipo: 'CELULAR', origem: 'MAILING', sem_extracao_dias: 45 }, 'filtros lidos da tela');

  window.__fnRespostas.contar = { data: { linhas: 1234567, empresas: 400000, telefones: 1200000,
    por_operadora: [{ operadora: 'VIVO', linhas: 700000 }, { operadora: 'SEM', linhas: 1000 }] }, error: null };
  chamadas.length = 0;
  document.getElementById('btnMbContar').click(); await espera(40);
  eq([chamadas[0] && chamadas[0].body.acao, chamadas[0] && chamadas[0].body.filtros.sem_extracao_dias], ['contar', 45], 'contar manda os filtros da tela');
  assert(document.getElementById('mbResultado').innerHTML.includes('1.234.567'), 'mostra o total de linhas');
  assert(document.getElementById('mbResultado').innerHTML.includes('Sem operadora'), 'operadora SEM com rótulo');

  const baixados = [];
  downloadBlob = (blob, nome) => baixados.push({ blob, nome });
  avisos.length = 0; chamadas.length = 0;
  document.getElementById('mbCarga').value = ''; document.getElementById('mbQtd').value = '100';
  document.getElementById('btnMbExportar').click(); await espera(20);
  eq([chamadas.length, avisos[0] && avisos[0][0]], [0, 'erro'], 'sem nome da carga: aviso e nada é chamado');
  avisos.length = 0;
  document.getElementById('mbCarga').value = 'TESTE'; document.getElementById('mbQtd').value = '100001';
  document.getElementById('btnMbExportar').click(); await espera(20);
  eq([chamadas.length, avisos[0] && avisos[0][0]], [0, 'erro'], 'quantidade acima de 100 mil: aviso');

  const colsExp = ['nome', 'descricao', 'documento1', 'documento2', 'fone1', 'campo1', 'campo2', 'campo3'];
  const linhasExp = [['FULANO DE TAL', 'EMPRESA; TESTE "LTDA"', '00000000191', '00000000000191', '11900000001', 'CLARO S.A.', 'MEI', 'SÃO PAULO']];
  window.__fnRespostas.extrair = { data: { colunas: colsExp, linhas: linhasExp, total_no_filtro: 5000, quantidade_entregue: 1, nome_arquivo: 'TESTE_2026-10-21.csv' }, error: null };
  avisos.length = 0; chamadas.length = 0;
  document.getElementById('mbQtd').value = '1';
  document.getElementById('btnMbExportar').click(); await espera(60);
  eq(chamadas[0] && chamadas[0].body, { acao: 'extrair', filtros: mbLerFiltros(), quantidade: 1, nome_carga: 'TESTE' }, 'extrair manda filtros, quantidade e carga');
  eq(baixados.map(b => b.nome), ['TESTE_2026-10-21.csv'], 'baixou um arquivo com o nome vindo da função');
  eq(baixados[0] && baixados[0].blob.size, mbParaCp1252(mbMontarCsv(colsExp, linhasExp)).length, 'arquivo em Windows-1252 com o tamanho certo');
  eq(avisos[0] && avisos[0][0], 'ok', 'aviso de sucesso');
  assert(chamadas.some(c => c.body.acao === 'historico'), 'recarrega o histórico depois de exportar');

  window.__fnRespostas.extrair = { data: { colunas: colsExp, linhas: [], total_no_filtro: 0, quantidade_entregue: 0, nome_arquivo: 'TESTE_2026-10-21.csv' }, error: null };
  baixados.length = 0; avisos.length = 0;
  document.getElementById('btnMbExportar').click(); await espera(40);
  eq([baixados.length, avisos[0] && avisos[0][0]], [0, 'info'], 'filtro vazio: aviso e nenhum arquivo');

  window.__fnRespostas.contar = { data: null, error: { context: { json: async () => ({ erro: 'A consulta demorou demais. Refine os filtros e tente de novo.' }) } } };
  avisos.length = 0;
  document.getElementById('btnMbContar').click(); await espera(40);
  eq(avisos[0], ['erro', 'A consulta demorou demais. Refine os filtros e tente de novo.'], 'erro da função vira aviso com a mensagem dela');
  window.__fnRespostas.contar = { data: null, error: { message: 'Failed to fetch' } };
  avisos.length = 0;
  document.getElementById('btnMbContar').click(); await espera(40);
  eq(avisos[0], ['erro', 'Não foi possível falar com a base de mailing.'], 'falha de rede: mensagem genérica');

  document.getElementById('btnMbLimpar').click();
  eq(mbLerFiltros(), mbFiltrosPadrao(), 'limpar volta ao padrão');
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin', operacao: 'apex' };
  mbAplicarPermissao();
  eq([document.getElementById('mbResultado').innerHTML, mbEstado.opcoes], ['', null], 'trocar de usuário limpa a tela e as opções');
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
