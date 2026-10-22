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
window.__html = html;
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
  eq(mbFiltrosPadrao(), { situacao: ['ATIVA'], excluir_obito: true }, 'filtros padrão (a base só tem celular do mailing: tipo e origem não entram)');
  eq(MB_MAX_QTD, 100000, 'cada arquivo tem até 100 mil');
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
  eq(mbValidarQuantidade('100000'), 100000, 'cem mil');
  eq([mbValidarQuantidade('100001'), mbValidarQuantidade('700.000'), mbValidarQuantidade('12000000')], [100001, 700000, 12000000], 'acima de 100 mil vale (sai em vários arquivos)');
  for(const v of ['0', '12,5', 'abc', '', null]) eq(mbValidarQuantidade(v), null, 'quantidade inválida: ' + v);
  eq([mbNomeParte('LOTE_2026-10-21.csv', 3, 7), mbNomeParte('LOTE_2026-10-21.csv', 1, 1)], ['LOTE_2026-10-21_parte3de7.csv', 'LOTE_2026-10-21.csv'], 'nome do arquivo de cada parte');
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
    { tipo: 'ddd_cidade', valor: '11', rotulo: '11', uf: null }, { tipo: 'ddd_cidade', valor: '19', rotulo: '19', uf: null },
    { tipo: 'posicao', valor: '1', rotulo: 'Telefone 1', uf: null }, { tipo: 'posicao', valor: '2', rotulo: 'Telefone 2', uf: null },
    { tipo: 'situacao', valor: 'ATIVA', rotulo: 'ATIVA', uf: null }, { tipo: 'situacao', valor: 'BAIXADA', rotulo: 'BAIXADA', uf: null },
    { tipo: 'porte', valor: 'MEI', rotulo: 'MEI', uf: null }, { tipo: 'classe', valor: 'B', rotulo: 'B', uf: null },
    { tipo: 'cnae', valor: '9602501', rotulo: '9602501 — Cabeleireiros, manicure e pedicure', uf: null },
    { tipo: 'cnae', valor: '4781400', rotulo: '4781400 — Comércio varejista de vestuário', uf: null },
    { tipo: 'operadora', valor: 'VIVO', rotulo: 'Vivo', uf: null }, { tipo: 'operadora', valor: 'SEM', rotulo: 'Sem operadora', uf: null },
    { tipo: 'sexo', valor: 'F', rotulo: 'Feminino', uf: null }, { tipo: 'sexo', valor: 'M', rotulo: 'Masculino', uf: null },
    { tipo: 'geracao', valor: 'Y', rotulo: 'Geração Y', uf: null }, { tipo: 'geracao', valor: 'Z', rotulo: 'Geração Z', uf: null },
    { tipo: 'risco', valor: 'BAIXO', rotulo: 'Baixo', uf: null }, { tipo: 'risco', valor: 'ALTO', rotulo: 'Alto', uf: null },
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

  // 21/10 (pedido do Rafael): cada filtro de várias opções é um botão que abre uma caixa com opções para marcar
  const multi = id => document.querySelector('.mbMulti[data-alvo="' + id + '"]');
  const caixa = id => multi(id).querySelector('.mbMultiCaixa');
  const texto = id => multi(id).querySelector('.mbMultiTexto').textContent;
  const itens = id => Array.from(multi(id).querySelectorAll('.mbMultiItem input')).map(i => i.value);
  const marcar = (id, valor) => { const cb = Array.from(multi(id).querySelectorAll('.mbMultiItem input')).find(i => i.value === valor);
    cb.checked = !cb.checked; cb.dispatchEvent(new window.Event('change', { bubbles: true })); };
  for (const id of ['mbUf', 'mbMunicipio', 'mbDdd', 'mbPosicao', 'mbSituacao', 'mbPorte', 'mbClasse', 'mbOperadora', 'mbCnae', 'mbSexo', 'mbGeracao', 'mbRisco']) {
    assert(multi(id) && document.getElementById(id).hidden && caixa(id).hidden, 'filtro ' + id + ': botão com caixa fechada e lista nativa escondida');
  }
  eq([texto('mbUf'), texto('mbSituacao')], ['Todas', 'ATIVA'], 'botão mostra "Todas" sem escolha e o nome com uma escolha');
  multi('mbUf').querySelector('.mbMultiBotao').click();
  eq([caixa('mbUf').hidden, multi('mbUf').querySelector('.mbMultiBotao').getAttribute('aria-expanded')], [false, 'true'], 'clicar no botão abre a caixa');
  eq(itens('mbUf'), ['SP', 'RJ'], 'caixa lista as opções para marcar');
  marcar('mbUf', 'RJ');
  eq(sel('mbUf'), ['RJ'], 'marcar na caixa escolhe a opção');
  eq(opts('mbMunicipio'), ['6001'], 'cidades só da UF escolhida');
  eq(caixa('mbUf').hidden, false, 'a caixa continua aberta para marcar mais de uma');
  multi('mbCnae').querySelector('.mbMultiBotao').click();
  eq([caixa('mbUf').hidden, caixa('mbCnae').hidden], [true, false], 'abrir outro filtro fecha o anterior');
  const busca = document.getElementById('mbCnaeBusca');
  assert(caixa('mbCnae').contains(busca), 'a busca do CNAE fica dentro da caixa');
  busca.value = 'cabel'; busca.dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(itens('mbCnae'), ['9602501'], 'busca de CNAE pela descrição');
  marcar('mbCnae', '9602501');
  eq(texto('mbCnae'), '9602501 — Cabeleireiros, manicure e pedicure', 'botão mostra a opção escolhida');
  document.body.click();
  eq(caixa('mbCnae').hidden, true, 'clicar fora fecha a caixa');
  multi('mbOperadora').querySelector('.mbMultiBotao').click();
  marcar('mbOperadora', 'VIVO'); marcar('mbOperadora', 'SEM');
  eq(texto('mbOperadora'), '2 selecionadas', 'várias escolhas viram contagem');
  marcar('mbOperadora', 'SEM');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  eq(caixa('mbOperadora').hidden, true, 'Esc fecha a caixa');
  // 21/10: filtros do sócio
  multi('mbSexo').querySelector('.mbMultiBotao').click(); marcar('mbSexo', 'F');
  multi('mbGeracao').querySelector('.mbMultiBotao').click(); marcar('mbGeracao', 'Y'); marcar('mbGeracao', 'Z');
  multi('mbRisco').querySelector('.mbMultiBotao').click(); marcar('mbRisco', 'BAIXO');
  document.body.click();
  eq([texto('mbSexo'), texto('mbGeracao'), texto('mbRisco')], ['Feminino', '2 selecionadas', 'Baixo'], 'filtros de sexo, geração e risco');
  // 21/10: DDD da cidade (não do telefone) e posição do telefone na planilha
  eq(document.getElementById('mbDddRotulo').textContent, 'DDD da cidade', 'o filtro de DDD é o da cidade da empresa');
  eq(itens('mbDdd').length ? itens('mbDdd') : (multi('mbDdd').querySelector('.mbMultiBotao').click(), itens('mbDdd')), ['11', '19'], 'DDDs das cidades');
  marcar('mbDdd', '11');
  multi('mbPosicao').querySelector('.mbMultiBotao').click(); marcar('mbPosicao', '1');
  document.body.click();
  eq([document.getElementById('mbPosicaoRotulo').textContent, texto('mbPosicao')], ['Telefone da planilha', 'Telefone 1'], 'filtro da posição do telefone');
  document.getElementById('mbUso').value = 'dias'; document.getElementById('mbUso').dispatchEvent(new window.Event('change'));
  eq(document.getElementById('mbUsoDias').style.display, '', 'escolher "não extraídos há…" mostra o campo de dias');
  document.getElementById('mbUsoDias').value = '45';
  eq(mbLerFiltros(), { uf: ['RJ'], situacao: ['ATIVA'], operadora: ['VIVO'], sexo: ['F'], geracao: ['Y', 'Z'], risco: ['BAIXO'], ddd_cidade: [11], posicao: [1], cnae: [9602501], excluir_obito: true, sem_extracao_dias: 45 }, 'filtros lidos da tela');
  eq(mbResumoFiltros({ sexo: ['F'], geracao: ['Y', 'Z'], risco: ['BAIXO'] }), 'sexo F · geração Y, Z · risco BAIXO', 'resumo com os filtros do sócio');
  eq(mbResumoFiltros({ ddd_cidade: [11, 19], posicao: [1] }), 'DDD da cidade 11, 19 · telefone 1', 'resumo com DDD da cidade e posição');
  assert(!document.getElementById('mbTipo') && !document.getElementById('mbOrigem'), 'sem filtros de tipo e origem (sempre dariam zero)');
  const btnFiltros = document.getElementById('btnMbFiltros');
  btnFiltros.click();
  eq([document.getElementById('mbFiltrosCorpo').hidden, btnFiltros.textContent.trim(), btnFiltros.getAttribute('aria-expanded')], [true, 'Mostrar filtros', 'false'], 'esconder os filtros');
  assert(!document.getElementById('mbFiltrosResumo').hidden && document.getElementById('mbFiltrosResumo').textContent.includes('UF RJ'), 'filtros escondidos mostram o resumo do que está escolhido');
  assert(document.getElementById('btnMbContar').offsetParent !== undefined && !document.getElementById('btnMbContar').closest('[hidden]'), 'Contar continua à vista com os filtros escondidos');
  btnFiltros.click();
  eq([document.getElementById('mbFiltrosCorpo').hidden, document.getElementById('mbFiltrosResumo').hidden, btnFiltros.textContent.trim()], [false, true, 'Esconder filtros'], 'mostrar os filtros de novo');

  window.__fnRespostas.contar = { data: { linhas: 1234567, empresas: 400000, telefones: 1200000,
    por_operadora: [{ operadora: 'VIVO', linhas: 700000 }, { operadora: 'SEM', linhas: 1000 }] }, error: null };
  chamadas.length = 0;
  document.getElementById('btnMbContar').click(); await espera(40);
  eq([chamadas[0] && chamadas[0].body.acao, chamadas[0] && chamadas[0].body.filtros.sem_extracao_dias], ['contar', 45], 'contar manda os filtros da tela');
  assert(document.getElementById('mbResultado').innerHTML.includes('≈ 1.234.567'), 'mostra o total de linhas como estimativa');
  assert(document.getElementById('mbResultado').innerHTML.includes('amostra de 2%'), 'explica que a contagem é por amostra');
  assert(document.getElementById('mbResultado').innerHTML.includes('Sem operadora'), 'operadora SEM com rótulo');

  const baixados = [];
  downloadBlob = (blob, nome) => baixados.push({ blob, nome });
  avisos.length = 0; chamadas.length = 0;
  document.getElementById('mbCarga').value = ''; document.getElementById('mbQtd').value = '100';
  document.getElementById('btnMbExportar').click(); await espera(20);
  eq([chamadas.length, avisos[0] && avisos[0][0]], [0, 'erro'], 'sem nome da carga: aviso e nada é chamado');
  avisos.length = 0;
  document.getElementById('mbCarga').value = 'TESTE'; document.getElementById('mbQtd').value = '0';
  document.getElementById('btnMbExportar').click(); await espera(20);
  eq([chamadas.length, avisos[0] && avisos[0][0]], [0, 'erro'], 'quantidade inválida: aviso');

  const colsExp = ['nome', 'descricao', 'documento1', 'documento2', 'fone1', 'campo1', 'campo2', 'campo3'];
  const linhasExp = [['FULANO DE TAL', 'EMPRESA; TESTE "LTDA"', '00000000191', '00000000000191', '11900000001', 'CLARO S.A.', 'MEI', 'SÃO PAULO']];
  const ateTerminar = async () => { await espera(10); for(let i = 0; i < 3000 && mbEstado.exportando; i++) await espera(10); await espera(30); };
  // 22/10 (seção 102.10): base falsa que responde por trechos — 'porTrecho' linhas por chamada, 'total' no filtro
  function baseFalsa(total, porTrecho, nomeArq){
    let resta = total;
    return (body) => {
      const t = body.trecho;
      const n = Math.min(body.quantidade, porTrecho, resta); resta -= n;
      const proxima = resta <= 0 ? null : (n === body.quantidade ? { fase: 1, pagina: t.pagina } : { fase: 1, pagina: t.pagina + t.paginas });
      return { data: { colunas: colsExp, linhas: Array.from({ length: n }, () => linhasExp[0]), quantidade_entregue: n,
        nome_arquivo: nomeArq || 'LOTE_2026-10-22.csv', proxima, paginas_total: 380000, paginas_lidas: t.paginas }, error: null };
    };
  }
  const extrairChamadas = () => chamadas.filter(c => c.body.acao === 'extrair').map(c => c.body);

  eq(mbPaginasTrecho(100000, 0, 0), MB_TRECHO_INICIAL, 'primeiro trecho: tamanho inicial');
  eq(mbPaginasTrecho(99500, 2048, 500), MB_TRECHO_MAX, 'filtro fino (0,25 linha por página): trecho máximo');
  eq(mbPaginasTrecho(1000, 2048, 50000), MB_TRECHO_MIN, 'filtro largo: trecho mínimo');
  eq(mbPaginasTrecho(50000, 2048, 0), MB_TRECHO_MAX, 'nada achado ainda: trecho máximo');
  eq(mbPaginasTrecho(10000, 4096, 2048), 25000, 'meio-termo: o que falta dividido pelas linhas por página, com folga de 25%');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(mbNovoPedido()), 'pedido é um uuid');
  assert(window.__html.includes('.mbProgresso[hidden]{display:none;}'), 'barra de progresso (com o Parar) escondida de verdade fora da exportação');

  window.__fnRespostas.extrair = baseFalsa(5000, 5000, 'TESTE_2026-10-21.csv');
  avisos.length = 0; chamadas.length = 0; baixados.length = 0;
  document.getElementById('mbQtd').value = '1';
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  const c1 = extrairChamadas()[0] || {};
  eq(Object.keys(c1).sort(), ['acao', 'filtros', 'nome_carga', 'parte', 'pedido', 'quantidade', 'trecho'], 'extrair manda filtros, quantidade, carga, pedido, parte e trecho');
  eq([c1.quantidade, c1.nome_carga, c1.parte, c1.trecho], [1, 'TESTE', 1, { fase: 1, pagina: 0, paginas: MB_TRECHO_INICIAL }], 'primeiro trecho do começo da base');
  eq(Object.assign({}, c1.filtros, { extraida_antes_de: 0 }), Object.assign({}, mbLerFiltros(), { extraida_antes_de: 0 }), 'filtros da tela');
  assert(!isNaN(Date.parse(c1.filtros && c1.filtros.extraida_antes_de)), 'leva a hora do início do pedido');
  eq(extrairChamadas().length, 1, 'completou a quantidade: não pede outro trecho');
  eq(baixados.map(b => b.nome), ['TESTE_2026-10-21.csv'], 'baixou um arquivo com o nome vindo da função');
  eq(baixados[0] && baixados[0].blob.size, mbParaCp1252(mbMontarCsv(colsExp, linhasExp)).length, 'arquivo em Windows-1252 com o tamanho certo');
  eq(avisos[0], ['ok', '1 linhas em 1 arquivo.'], 'aviso de sucesso');
  assert(chamadas.some(c => c.body.acao === 'historico'), 'recarrega o histórico depois de exportar');

  window.__fnRespostas.extrair = baseFalsa(0, 0, 'TESTE_2026-10-21.csv');
  baixados.length = 0; avisos.length = 0;
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  eq([baixados.length, avisos[0] && avisos[0][0]], [0, 'info'], 'filtro vazio: aviso e nenhum arquivo');

  // o caso do Guilherme: filtro fino — poucas linhas por trecho, junta tudo num arquivo e avisa que é o número exato
  window.__fnRespostas.extrair = baseFalsa(2500, 800);
  baixados.length = 0; avisos.length = 0; chamadas.length = 0;
  document.getElementById('mbCarga').value = 'ICP-1'; document.getElementById('mbQtd').value = '100000';
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  const fino = extrairChamadas();
  const pags = fino.map(b => b.trecho.paginas);
  eq(fino.map(b => b.trecho.pagina), [0, pags[0], pags[0] + pags[1], pags[0] + pags[1] + pags[2]], 'cada trecho continua de onde o anterior parou');
  eq(fino.map(b => b.quantidade), [100000, 99200, 98400, 97600], 'pede só o que falta');
  assert(pags[1] > pags[0], 'filtro fino: o trecho cresce');
  assert(fino.every(b => b.pedido === fino[0].pedido && b.parte === 1 && b.filtros.extraida_antes_de === fino[0].filtros.extraida_antes_de), 'mesmo pedido, mesma parte, mesmo início');
  eq(baixados.map(b => b.nome), ['LOTE_2026-10-22.csv'], 'um arquivo só');
  eq(baixados[0] && baixados[0].blob.size, mbParaCp1252(mbMontarCsv(colsExp, Array.from({ length: 2500 }, () => linhasExp[0]))).length, 'arquivo com as 2.500 linhas');
  assert(avisos[0] && avisos[0][0] === 'ok' && avisos[0][1].includes('2.500') && avisos[0][1].includes('todas as linhas do filtro') && avisos[0][1].includes('número exato'), 'avisa que saiu tudo e que esse é o número exato');
  eq(document.getElementById('mbProgresso').hidden, true, 'barra de progresso some no fim');

  // passa para os já usados quando acabam os nunca extraídos
  let fase = 0;
  window.__fnRespostas.extrair = (body) => {
    fase++;
    const linhas = fase === 1 ? [linhasExp[0]] : [linhasExp[0], linhasExp[0]];
    return { data: { colunas: colsExp, linhas, quantidade_entregue: linhas.length, nome_arquivo: 'X_2026-10-22.csv',
      proxima: fase === 1 ? { fase: 2, apos: null } : null, paginas_total: 380000, paginas_lidas: 2048 }, error: null };
  };
  chamadas.length = 0; baixados.length = 0;
  document.getElementById('mbQtd').value = '10';
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  eq(extrairChamadas().map(b => b.trecho), [{ fase: 1, pagina: 0, paginas: MB_TRECHO_INICIAL }, { fase: 2, apos: null }], 'fase 2 vai com o cursor que a função devolveu');
  eq(baixados.length, 1, 'fase 1 e fase 2 no mesmo arquivo');

  // 21/10: pedido acima de 100 mil sai em vários arquivos de até 100 mil
  window.__fnRespostas.extrair = baseFalsa(230000, 100000);
  baixados.length = 0; avisos.length = 0; chamadas.length = 0;
  document.getElementById('mbCarga').value = 'LOTE'; document.getElementById('mbQtd').value = '300.000';
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  const partes = extrairChamadas();
  eq(partes.map(b => [b.quantidade, b.parte]), [[100000, 1], [100000, 2], [100000, 3]], 'pede em partes de 100 mil, uma parte por arquivo');
  assert(partes.every(b => b.filtros.extraida_antes_de && b.filtros.extraida_antes_de === partes[0].filtros.extraida_antes_de), 'todas as partes excluem o que saiu desde o início do pedido');
  eq(baixados.map(b => b.nome), ['LOTE_2026-10-22_parte1de3.csv', 'LOTE_2026-10-22_parte2de3.csv', 'LOTE_2026-10-22_parte3de3.csv'], 'um arquivo por parte');
  assert(avisos[0] && avisos[0][0] === 'ok' && avisos[0][1].includes('230.000') && avisos[0][1].includes('3 arquivos'), 'aviso com o total entregue e o número de arquivos');

  let pedidos = 0;
  const base = baseFalsa(9000000, 1000);
  window.__fnRespostas.extrair = (body) => { if (pedidos++ === 0) document.getElementById('btnMbParar').click(); return base(body); };
  baixados.length = 0; avisos.length = 0; chamadas.length = 0;
  document.getElementById('mbQtd').value = '700000';
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  eq([extrairChamadas().length, baixados.map(b => b.nome)], [1, ['LOTE_2026-10-22_parte1de7.csv']], 'Parar: termina o trecho em andamento, baixa o que saiu e não pede o próximo');
  assert(avisos[0] && avisos[0][1].includes('1.000') && avisos[0][1].includes('parou'), 'aviso diz quanto saiu e que parou a pedido');

  // erro no meio: o que já saiu está marcado no banco — baixa mesmo assim e avisa
  pedidos = 0;
  const base2 = baseFalsa(9000, 500);
  window.__fnRespostas.extrair = (body) => pedidos++ === 0 ? base2(body)
    : { data: null, error: { context: { json: async () => ({ erro: 'Falha ao consultar a base de mailing.' }) } } };
  baixados.length = 0; avisos.length = 0;
  document.getElementById('mbQtd').value = '5000';
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  eq(baixados.length, 1, 'erro no meio: baixa as linhas que já saíram');
  assert(avisos[0] && avisos[0][0] === 'erro' && avisos[0][1].includes('Falha ao consultar') && avisos[0][1].includes('500 linhas'), 'aviso de erro com o que já foi baixado');

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
  eq([texto('mbUf'), texto('mbOperadora'), texto('mbCnae'), texto('mbSituacao')], ['Todas', 'Todas', 'Todos', 'ATIVA'], 'limpar volta os botões');
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
