const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// dados que loadMovResumoAtual()/loadMovimentacao() leem — cada teste que precisar pode reatribuir
// antes de chamar. `errors[table]` simula uma tabela retornando erro (ex: RLS, schema cache).
window.__mockData = { clientes: [], resumos: [], movimentacaoEventos: [], errors: {} };
function mockQueryBuilder(table){
  const resultFor = () => {
    if(window.__mockData.errors[table]) return { data: null, error: window.__mockData.errors[table] };
    if(table === 'clientes') return { data: window.__mockData.clientes, error: null };
    if(table === 'clientes_movimentacao_resumo') return { data: window.__mockData.resumos, error: null };
    if(table === 'clientes_movimentacao') return { data: window.__mockData.movimentacaoEventos, error: null };
    return { data: [], error: null };
  };
  const builder = {
    select: () => builder, order: () => builder, limit: () => builder, eq: () => builder, gte: () => builder,
    then: (resolve) => resolve(resultFor()),
  };
  return builder;
}
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => mockQueryBuilder(table),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;
window.jspdf = { jsPDF: function(){ return {}; } };
window.Chart = function(){ return { destroy(){}, }; };
window.HTMLElement.prototype.scrollIntoView = function(){}; // jsdom não implementa isso nativamente
window.__xlsxCalls = { sheets: [], writes: [] };
window.XLSX = {
  utils: {
    json_to_sheet: (rows) => { const ws = { __rows: rows }; window.__xlsxCalls.sheets.push(rows); return ws; },
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    book_append_sheet: (wb, ws, name) => { wb.Sheets[name] = ws; wb.SheetNames.push(name); },
  },
  writeFile: (wb, filename) => { window.__xlsxCalls.writes.push({ wb, filename }); },
};

const testScript = `
(async () => {
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'admin' };
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  function cliente(overrides){
    return Object.assign({
      cnpj: '11.222.333/0001-44', razao_social: 'CLIENTE TESTE LTDA', cidade: 'São Paulo',
      tempo_contrato_voz: 20, linhas_voz: 5, linhas_fixas: 1, valor_contrato: 900, arpu: 180,
      cep_cabeado: 'CEP CABEADO', ddd: '11',
    }, overrides || {});
  }

  // --- 1) calcularCamposAlterados ---
  assert(calcularCamposAlterados(cliente(), cliente()).length === 0, 'sem mudança nenhuma quando os dois são iguais');
  assert(calcularCamposAlterados(cliente(), cliente({tempo_contrato_voz: 2})).length === 0, 'tempo_contrato_voz sozinho não é campo rastreado pra "mudança" (senão gera ruído todo mês pra base inteira)');
  assert(calcularCamposAlterados(cliente(), cliente({linhas_voz:8})).includes('linhas_voz'), 'detecta mudança de linhas_voz');
  assert(calcularCamposAlterados(cliente(), cliente({linhas_fixas:2})).includes('linhas_fixas'), 'detecta mudança de linhas_fixas');
  assert(calcularCamposAlterados(cliente(), cliente({valor_contrato:1200})).includes('valor_contrato'), 'detecta mudança de valor_contrato');
  assert(calcularCamposAlterados(cliente(), cliente({cidade:'Campinas'})).includes('cidade'), 'detecta mudança de cidade');
  assert(calcularCamposAlterados(cliente(), cliente({cep_cabeado:''})).includes('cabeado'), 'detecta mudança de status cabeado (deixou de ser cabeado)');
  assert(!calcularCamposAlterados(cliente(), cliente({valor_contrato:900.001})).includes('valor_contrato'), 'diferença de fração de centavo não conta como mudança (arredondamento)');
  assert(calcularCamposAlterados(cliente(), cliente({razao_social:'OUTRO NOME LTDA'})).length === 0, 'razão social não é campo rastreado pra mudança');

  // --- 2) calcularMovimentacaoBase: saída ---
  let r = calcularMovimentacaoBase([cliente({cnpj:'11.111.111/0001-11'})], [], 'user1');
  assert(r.movimentacoes.length === 1 && r.movimentacoes[0].tipo === 'saida', 'cliente que sumiu vira saida');
  assert(r.movimentacoes[0].cnpj === '11111111000111', 'cnpj salvo normalizado (só dígitos)');
  assert(r.movimentacoes[0].dados_antes.razao_social === 'CLIENTE TESTE LTDA', 'dados_antes tem o registro completo');
  assert(r.movimentacoes[0].dados_depois === null, 'dados_depois é null na saída');

  // --- 3) calcularMovimentacaoBase: entrada ---
  r = calcularMovimentacaoBase([], [cliente({cnpj:'22.222.222/0001-22'})], 'user1');
  assert(r.movimentacoes.length === 1 && r.movimentacoes[0].tipo === 'entrada', 'cliente novo vira entrada');
  assert(r.movimentacoes[0].dados_antes === null, 'dados_antes é null na entrada');
  assert(r.movimentacoes[0].dados_depois.cidade === 'São Paulo', 'dados_depois tem o registro completo');

  // --- 4) calcularMovimentacaoBase: sem mudança nenhuma ---
  r = calcularMovimentacaoBase([cliente({cnpj:'33.333.333/0001-33'})], [cliente({cnpj:'33.333.333/0001-33'})], 'user1');
  assert(r.movimentacoes.length === 0, 'cliente idêntico nos dois uploads não gera movimentação nenhuma');

  // --- 5) calcularMovimentacaoBase: mudança ---
  r = calcularMovimentacaoBase(
    [cliente({cnpj:'44.444.444/0001-44', linhas_voz: 5})],
    [cliente({cnpj:'44.444.444/0001-44', linhas_voz: 8})],
    'user1'
  );
  assert(r.movimentacoes.length === 1 && r.movimentacoes[0].tipo === 'mudanca', 'cliente com campo alterado vira mudanca');
  assert(r.movimentacoes[0].campos_alterados.length === 1 && r.movimentacoes[0].campos_alterados.includes('linhas_voz'), 'lista só o campo que realmente mudou (' + r.movimentacoes[0].campos_alterados.join(',') + ')');

  // --- 6) calcularMovimentacaoBase: CNPJ com formatação diferente é a mesma chave ---
  r = calcularMovimentacaoBase(
    [cliente({cnpj:'55.555.555/0001-55'})],
    [cliente({cnpj:'55555555000155'})], // mesmo CNPJ, sem pontuação
    'user1'
  );
  assert(r.movimentacoes.length === 0, 'CNPJ com/sem pontuação é reconhecido como o mesmo cliente');

  // --- 7) registros sem CNPJ ficam de fora e são contados ---
  r = calcularMovimentacaoBase(
    [cliente({cnpj:''}), cliente({cnpj:'66.666.666/0001-66'})],
    [cliente({cnpj: null}), cliente({cnpj:'66.666.666/0001-66'})],
    'user1'
  );
  assert(r.movimentacoes.length === 0, 'cliente sem CNPJ não gera falso positivo de saída/entrada');
  assert(r.semCnpjAntigo === 1 && r.semCnpjNovo === 1, 'conta certinho quantos registros sem CNPJ de cada lado (' + r.semCnpjAntigo + ',' + r.semCnpjNovo + ')');

  // --- 8) CNPJ duplicado na mesma planilha: primeira ocorrência prevalece, não trava ---
  r = calcularMovimentacaoBase(
    [],
    [cliente({cnpj:'77.777.777/0001-77', razao_social:'PRIMEIRA'}), cliente({cnpj:'77.777.777/0001-77', razao_social:'SEGUNDA'})],
    'user1'
  );
  assert(r.movimentacoes.length === 1, 'CNPJ duplicado na planilha nova não gera duas entradas');
  assert(r.movimentacoes[0].razao_social === 'PRIMEIRA', 'fica com a primeira ocorrência em caso de duplicidade');

  // --- 9) cenário misto: várias movimentações no mesmo diff ---
  const baseAntiga = [
    cliente({cnpj:'10.000.000/0001-01', razao_social:'FICA IGUAL'}),
    cliente({cnpj:'10.000.000/0001-02', razao_social:'VAI SAIR'}),
    cliente({cnpj:'10.000.000/0001-03', razao_social:'VAI MUDAR', linhas_voz: 3}),
  ];
  const baseNova = [
    cliente({cnpj:'10.000.000/0001-01', razao_social:'FICA IGUAL'}),
    cliente({cnpj:'10.000.000/0001-03', razao_social:'VAI MUDAR', linhas_voz: 10}),
    cliente({cnpj:'10.000.000/0001-04', razao_social:'É NOVO'}),
  ];
  r = calcularMovimentacaoBase(baseAntiga, baseNova, 'user1');
  const tipos = r.movimentacoes.map(m => m.tipo).sort();
  assert(JSON.stringify(tipos) === JSON.stringify(['mudanca','saida','entrada'].sort()), 'diff misto: 1 saída, 1 entrada, 1 mudança, 1 sem alteração (' + tipos.join(',') + ')');

  // --- 10) clicar no card "saíram" abre o analítico com TODOS os registros do tipo (não só 1 dia) e deixa pronto pra exportar ---
  movTodosRegistros = [
    { id:1, tipo:'saida', cnpj:'1', razao_social:'A', cidade:'SP', dados_antes:{valor_contrato:100, linhas_voz:2, linhas_fixas:1, tempo_contrato_voz:18}, dados_depois:null, campos_alterados:null, detectado_em:'2026-08-01T10:00:00Z' },
    { id:2, tipo:'saida', cnpj:'2', razao_social:'B', cidade:'SP', dados_antes:{valor_contrato:200, linhas_voz:1, linhas_fixas:0, tempo_contrato_voz:6}, dados_depois:null, campos_alterados:null, detectado_em:'2026-08-05T10:00:00Z' },
    { id:3, tipo:'entrada', cnpj:'3', razao_social:'C', cidade:'RJ', dados_antes:null, dados_depois:{valor_contrato:300, linhas_voz:4, linhas_fixas:2, tempo_contrato_voz:3}, campos_alterados:null, detectado_em:'2026-08-05T10:00:00Z' },
  ];
  renderMovResumo();
  const cardSaida = document.querySelector('[data-tipo="saida"]');
  assert(!!cardSaida, 'card de "saíram" renderizado com data-tipo');
  cardSaida.click();
  assert(document.getElementById('movDetalheCard').style.display === 'block', 'clicar no card abre o card de detalhe');
  assert(movDiaSelecionado === null, 'modo "todos os dias" (sem restringir a 1 dia) ao abrir pelo card de resumo');
  assert(document.getElementById('movFiltroTipo').value === 'saida', 'filtro de tipo já vem pré-selecionado como saida');
  const linhasTbody = document.getElementById('movDetalheTbody').querySelectorAll('tr').length;
  assert(linhasTbody === 2, 'lista as 2 saídas dos dois dias diferentes, não só de um dia (' + linhasTbody + ')');

  // --- 11) exportar gera um arquivo .xlsx de verdade (via SheetJS), com linhas/valor/apto/meses
  // de contrato em colunas separadas (não mais só dentro do texto "Detalhe") ---
  window.__xlsxCalls.sheets.length = 0;
  window.__xlsxCalls.writes.length = 0;
  document.getElementById('btnMovExportar').click();
  assert(window.__xlsxCalls.writes.length === 1, 'exportar chama XLSX.writeFile uma vez');
  assert(window.__xlsxCalls.writes[0].filename.endsWith('.xlsx'), 'nome do arquivo termina em .xlsx (' + window.__xlsxCalls.writes[0].filename + ')');
  assert(window.__xlsxCalls.sheets[0].length === 2, 'planilha exportada tem as 2 linhas do filtro atual');
  const linhaExport1 = window.__xlsxCalls.sheets[0][0];
  assert(linhaExport1['CNPJ'] === '1', 'linha exportada tem o CNPJ certo');
  assert(linhaExport1['Linhas'] === 3, 'coluna "Linhas" separada soma voz+fixas (2+1=3, veio ' + linhaExport1['Linhas'] + ')');
  assert(linhaExport1['Valor Contrato'] === 100, 'coluna "Valor Contrato" separada (veio ' + linhaExport1['Valor Contrato'] + ')');
  assert(linhaExport1['Apto Renovação'] === 'Apto', 'coluna "Apto Renovação" calculada (18 meses > 15) (veio ' + linhaExport1['Apto Renovação'] + ')');
  assert(linhaExport1['Meses de Contrato'] === 18, 'coluna "Meses de Contrato" com o tempo de contrato do cliente (veio ' + linhaExport1['Meses de Contrato'] + ')');
  assert(typeof linhaExport1['Detalhe'] === 'string', 'coluna "Detalhe" com o resumo textual continua existindo');

  // --- 12) trocar o filtro de tipo já filtra o analítico aberto (sem precisar reabrir) ---
  document.getElementById('movFiltroTipo').value = 'entrada';
  document.getElementById('movFiltroTipo').dispatchEvent(new window.Event('change'));
  assert(document.getElementById('movDetalheTbody').querySelectorAll('tr').length === 1, 'trocar o filtro pra "entrada" atualiza a tabela na hora');

  // --- 13) calcularMovimentacaoBase conta quem permaneceu (não saiu, não é novo) ---
  r = calcularMovimentacaoBase(
    [cliente({cnpj:'20.000.000/0001-01'}), cliente({cnpj:'20.000.000/0001-02'}), cliente({cnpj:'20.000.000/0001-03'})],
    [cliente({cnpj:'20.000.000/0001-01'}), cliente({cnpj:'20.000.000/0001-02'}), cliente({cnpj:'20.000.000/0001-04'})],
    'user1'
  );
  assert(r.permaneceram === 2, 'conta 2 CNPJs que permaneceram na base (' + r.permaneceram + ')');

  // --- 14) calcularMovimentacaoBase: "renovaram" — regra de negócio atual é tempo_contrato_voz >
  // 15 meses = apto; quando o cliente permanece na base e esse tempo CAI de >15 pra <=15, é sinal
  // de que o contrato foi resetado por uma renovação (a coluna de texto "apto/não apto" não existe
  // mais na planilha, então isso não depende mais dela) ---
  r = calcularMovimentacaoBase(
    [cliente({cnpj:'21.000.000/0001-01', tempo_contrato_voz: 20})], // apto (>15)
    [cliente({cnpj:'21.000.000/0001-01', tempo_contrato_voz: 2})],  // renovou, contrato resetou
    'user1'
  );
  assert(r.renovaram === 1, 'conta renovação quando o tempo de contrato cai de >15 pra <=15 meses (' + r.renovaram + ')');

  r = calcularMovimentacaoBase(
    [cliente({cnpj:'21.000.000/0001-02', tempo_contrato_voz: 20})],
    [cliente({cnpj:'21.000.000/0001-02', tempo_contrato_voz: 21})], // continua apto, só passou mais 1 mês
    'user1'
  );
  assert(r.renovaram === 0, 'tempo aumentando normalmente (continua apto) não é confundido com renovação (' + r.renovaram + ')');

  r = calcularMovimentacaoBase(
    [cliente({cnpj:'21.000.000/0001-03', tempo_contrato_voz: 5})], // já não apto
    [cliente({cnpj:'21.000.000/0001-03', tempo_contrato_voz: 10})], // continua não apto
    'user1'
  );
  assert(r.renovaram === 0, 'quem nunca esteve apto não gera sinal de renovação (' + r.renovaram + ')');

  r = calcularMovimentacaoBase(
    [cliente({cnpj:'21.000.000/0001-04', tempo_contrato_voz: 20})],
    [], // saiu da base — não conta como renovação, mesmo estando apto antes
    'user1'
  );
  assert(r.renovaram === 0, 'cliente que saiu não conta como renovação, mesmo que estivesse apto antes (' + r.renovaram + ')');

  // --- 15) loadMovResumoAtual(): card "Última atualização da base" com dados em tempo real ---
  window.__mockData.clientes = [
    cliente({cnpj:'30.000.000/0001-01', apto_renovacao:'Apto', linhas_voz:5, linhas_fixas:1, valor_contrato:950, tempo_contrato_voz:18}),
    cliente({cnpj:'30.000.000/0001-02', apto_renovacao:'Não apto', linhas_voz:3, linhas_fixas:0, valor_contrato:400, tempo_contrato_voz:9}),
    cliente({cnpj:'30.000.000/0001-03', apto_renovacao:'Apto', linhas_voz:2, linhas_fixas:2, valor_contrato:600, tempo_contrato_voz:24}),
  ];
  window.__mockData.resumos = [{ total_antes: 45, total_depois: 47, saidas: 2, entradas: 4, mudancas: 1, permaneceram: 43, renovaram: 3, detectado_em: '2026-08-10T12:00:00Z' }];
  await loadMovResumoAtual();
  assert(movClientesAptos.length === 2, 'filtra corretamente os 2 clientes aptos da base atual (' + movClientesAptos.length + ')');
  const cardsAtual = document.getElementById('movAtualCards').textContent;
  assert(cardsAtual.includes('3'), 'mostra o total de clientes na base atual (3)');
  assert(cardsAtual.includes('13'), 'soma linhas_voz + linhas_fixas de todos os clientes (5+1+3+0+2+2=13)');
  assert(cardsAtual.includes('43'), 'mostra "permaneceram" do último resumo de upload');
  assert(cardsAtual.includes('renovações'), 'mostra o rótulo de possíveis renovações');

  // --- 16) clicar no card "aptos para renovação" abre o analítico certo, escondendo o filtro de tipo ---
  const cardAptos = document.querySelector('#movAtualCards [data-tipo="aptos"]');
  assert(!!cardAptos, 'card "aptos para renovação" renderizado com data-tipo');
  cardAptos.click();
  assert(document.getElementById('movDetalheCard').style.display === 'block', 'clicar no card de aptos abre o card de detalhe');
  assert(document.getElementById('movFiltroTipo').style.display === 'none', 'filtro de tipo (saída/entrada/mudança) some no modo aptos, não se aplica');
  const linhasAptos = document.getElementById('movDetalheTbody').querySelectorAll('tr').length;
  assert(linhasAptos === 2, 'lista os 2 clientes aptos (' + linhasAptos + ')');

  // --- 17) exportar no modo "aptos" gera um .xlsx com as colunas certas, diferente do modo movimentação ---
  window.__xlsxCalls.sheets.length = 0;
  window.__xlsxCalls.writes.length = 0;
  document.getElementById('btnMovExportar').click();
  assert(window.__xlsxCalls.writes.length === 1, 'exportar no modo aptos também chama XLSX.writeFile uma vez');
  assert(window.__xlsxCalls.writes[0].filename === 'clientes_aptos_renovacao.xlsx', 'nome de arquivo fixo pro export de aptos (' + window.__xlsxCalls.writes[0].filename + ')');
  assert(window.__xlsxCalls.sheets[0].length === 2, 'planilha de aptos exportada tem as 2 linhas certas');
  const linhaApto1 = window.__xlsxCalls.sheets[0][0];
  assert(linhaApto1['Linhas'] === 6, 'coluna "Linhas" soma voz+fixas do 1º cliente apto (5+1=6, veio ' + linhaApto1['Linhas'] + ')');
  assert(linhaApto1['Valor Contrato'] === 950, 'coluna "Valor Contrato" separada no export de aptos (veio ' + linhaApto1['Valor Contrato'] + ')');
  assert(linhaApto1['Apto Renovação'] === 'Apto', 'coluna "Apto Renovação" separada no export de aptos');
  assert(linhaApto1['Meses de Contrato'] === 18, 'coluna "Meses de Contrato" com o tempo de contrato do cliente (veio ' + linhaApto1['Meses de Contrato'] + ')');

  // --- 18) reabrir o card de um dia (fluxo antigo) volta pro modo "movimentacao" e reexibe o filtro ---
  abrirDetalheDia('2026-08-05');
  assert(document.getElementById('movFiltroTipo').style.display === 'inline-block', 'voltar pro fluxo de 30 dias reexibe o filtro de tipo');

  // --- 19) loadMovResumoAtual(): erro numa das consultas mostra "Erro:" em vez de travar em "carregando..." ---
  window.__mockData.errors['clientes'] = { message: 'relation "clientes" does not exist' };
  await loadMovResumoAtual();
  const textoErroAtual = document.getElementById('movAtualCards').textContent;
  assert(textoErroAtual.includes('Erro'), 'mostra mensagem de erro (não fica travado em "carregando...") quando a consulta falha (' + textoErroAtual + ')');
  assert(!textoErroAtual.includes('carregando'), 'não fica preso no texto "carregando..." depois que a consulta responde com erro');
  delete window.__mockData.errors['clientes'];

  // --- 20) loadMovimentacao(): falha na consulta de 30 dias não impede o card "Última atualização
  // da base" de carregar — são independentes, um não pode travar o outro ---
  window.__mockData.errors['clientes_movimentacao'] = { message: 'timeout' };
  window.__mockData.clientes = [ cliente({cnpj:'40.000.000/0001-01', apto_renovacao:'Apto'}) ];
  window.__mockData.resumos = [{ total_antes: 1, total_depois: 1, saidas: 0, entradas: 0, mudancas: 0, permaneceram: 1, renovaram: 0, detectado_em: '2026-08-11T09:00:00Z' }];
  await loadMovimentacao();
  const texto30dias = document.getElementById('movResumoCards').textContent;
  const textoAtualizacao = document.getElementById('movAtualCards').textContent;
  assert(texto30dias.includes('Erro'), 'card de 30 dias mostra o erro da consulta que falhou');
  assert(!textoAtualizacao.includes('carregando') && !textoAtualizacao.includes('Erro'), 'card "Última atualização da base" carrega normalmente mesmo com a outra consulta falhando (' + textoAtualizacao + ')');
  delete window.__mockData.errors['clientes_movimentacao'];

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
})();
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 2000);
