const fs = require('fs');
const { JSDOM } = require('jsdom');
const XLSX = require('xlsx');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// stub minimo do Supabase — os testes abaixo exercitam só as funções puras (extractProducaoRecords,
// parseDataProducao, producaoEtapaCategoria) e o parse real da planilha via SheetJS (Node), sem
// precisar de rede.
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;
// XLSX real (SheetJS via npm), pro trecho do template que faz `typeof XLSX !== 'undefined' && XLSX.SSF...`
window.XLSX = XLSX;

const testScript = `
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // --- 1) categorização de etapas (igual à constante ETAPA_CATEGORY do template embutido) ---
  assert(producaoEtapaCategoria('CONCLUIDO (NEOCRM)') === 'ganho', 'CONCLUIDO categoriza como ganho');
  assert(producaoEtapaCategoria('ENTREGA (NEOCRM)') === 'ganho', 'ENTREGA categoriza como ganho');
  assert(producaoEtapaCategoria('VENDA PERDIDA (NEOCRM)') === 'perdido', 'VENDA PERDIDA categoriza como perdido');
  assert(producaoEtapaCategoria('DEVOLVIDO (NEOCRM)') === 'devolvido', 'DEVOLVIDO categoriza como devolvido (não conta mais como perdido)');
  assert(producaoEtapaCategoria('NEGOCIACAO (NEOCRM)') === 'andamento', 'etapa desconhecida cai em andamento (ex.: NEGOCIACAO)');
  assert(producaoEtapaCategoria('CHAMADOS (NEOCRM)') === 'andamento', 'CHAMADOS categoriza como andamento');
  // Portabilidade em Andamento e Validação eSIM viraram ganho em 24/08/2026 — são etapas
  // pós-aprovação na esteira da Claro, não "em andamento" de verdade.
  assert(producaoEtapaCategoria('PORTABILIDADE EM ANDAMENTO (NEOCRM)') === 'ganho', 'PORTABILIDADE EM ANDAMENTO categoriza como ganho (pós-aprovação na esteira Claro)');
  assert(producaoEtapaCategoria('VALIDAÇÃO ESIM (NEOCRM)') === 'ganho', 'VALIDAÇÃO ESIM categoriza como ganho (pós-aprovação na esteira Claro)');
  assert(producaoEtapaCategoria('PORTABILIDADE EM TRATATIVA (NEOCRM)') === 'andamento', 'PORTABILIDADE EM TRATATIVA continua andamento (diferente de "em andamento" — ainda não é pós-aprovação)');

  // --- 2) parseDataProducao: string "dd/mm/aaaa HH:MM:SS" e "dd/mm/aaaa" -> ISO com offset -03:00 ---
  // Fix de fuso (27/08/2026): sem o offset explícito, a sessão do Supabase (UTC) tratava a hora de
  // São Paulo como se já fosse UTC, adiantando todo horário salvo em 3h — ver REGRAS_NEGOCIO.md
  // seção 16.10. O offset precisa vir sempre, senão o bug volta.
  assert(parseDataProducao('04/08/2026 19:27:39') === '2026-08-04T19:27:39-03:00', 'parseDataProducao converte data+hora pt-BR pra ISO com offset -03:00 (' + parseDataProducao('04/08/2026 19:27:39') + ')');
  assert(parseDataProducao('04/08/2026') === '2026-08-04T00:00:00-03:00', 'parseDataProducao converte data pt-BR (sem hora) pra ISO com offset -03:00, meia-noite em SP');
  assert(parseDataProducao('') === null, 'parseDataProducao trata string vazia como null');
  assert(parseDataProducao(null) === null, 'parseDataProducao trata null como null');
  assert(parseDataProducao('lixo') === null, 'parseDataProducao trata texto não reconhecido como null');

  // --- 2.1) mesmo offset -03:00 nos outros dois formatos de entrada (data nativa do Excel e serial numérico) ---
  const dataExcelNativa = new Date(2026, 7, 4, 19, 27, 39); // mês 0-indexado: 7 = agosto
  assert(parseDataProducao(dataExcelNativa) === '2026-08-04T19:27:39-03:00', 'parseDataProducao (Date nativa do Excel) também grava offset -03:00 (' + parseDataProducao(dataExcelNativa) + ')');
  // serial numérico do Excel equivalente a 04/08/2026 19:27:39 (dias desde 30/12/1899 + fração do dia)
  const serialExcel = XLSX.SSF.parse_date_code && (46238 + (19*3600+27*60+39)/86400);
  if(serialExcel){
    assert(parseDataProducao(serialExcel) === '2026-08-04T19:27:39-03:00', 'parseDataProducao (serial numérico do Excel) também grava offset -03:00 (' + parseDataProducao(serialExcel) + ')');
  }
  // e o resultado precisa virar o instante UTC certo: 19:27:39 em São Paulo (UTC-3) = 22:27:39 UTC
  const instanteUtc = new Date(parseDataProducao('04/08/2026 19:27:39'));
  assert(instanteUtc.getUTCHours() === 22 && instanteUtc.getUTCMinutes() === 27, 'o ISO com offset -03:00 corresponde ao instante UTC correto (22:27 UTC = 19:27 em São Paulo), UTC calculado: ' + instanteUtc.getUTCHours() + ':' + instanteUtc.getUTCMinutes());

  // --- 3) validação das colunas obrigatórias ---
  assert(PRODUCAO_COLUNAS_OBRIGATORIAS.includes('GRUPO'), 'colunas obrigatórias incluem GRUPO');
  assert(PRODUCAO_COLUNAS_OBRIGATORIAS.includes('PROPRIETÁRIO DO PEDIDO'), 'colunas obrigatórias incluem PROPRIETÁRIO DO PEDIDO');
  assert(PRODUCAO_COLUNAS_OBRIGATORIAS.includes('ETAPA PEDIDO'), 'colunas obrigatórias incluem ETAPA PEDIDO');
  assert(PRODUCAO_COLUNAS_OBRIGATORIAS.includes('VALOR UNIT'), 'colunas obrigatórias incluem VALOR UNIT');
  // colunas da planilha de Base de Clientes (bem diferentes) não devem ser confundidas com as da produção
  assert(!PRODUCAO_COLUNAS_OBRIGATORIAS.includes('CNPJ'), 'colunas obrigatórias NÃO incluem CNPJ (planilha de clientes usa outro layout)');

  // --- 4) extractProducaoRecords contra a planilha REAL enviada pelo usuário (SheetJS via Node) ---
  const wb = window.__testWorkbook;
  const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'exportacao' || n.trim().toLowerCase() === 'exportação');
  assert(sheetName === 'Exportacao', 'planilha real tem a aba "Exportacao" (' + sheetName + ')');
  const ws = wb.Sheets[sheetName];
  // Mesma correção aplicada em _template.html: a planilha real do NeoCRM tem "!ref" começando na
  // linha 2 (sem o cabeçalho) — força incluir a linha 0 antes de converter.
  let range = ws['!ref'] ? window.__testXLSXUtils.decode_range(ws['!ref']) : null;
  assert(range && range.s.r > 0, 'planilha real confirma o bug conhecido: "!ref" começa depois da linha 0 (' + ws['!ref'] + ')');
  if(range && range.s.r > 0) range.s.r = 0;
  const rows = window.__testXLSXUtils.sheet_to_json(ws, { header: 1, raw: true, defval: null, range: range || undefined });
  assert(rows.length > 1, 'planilha real tem linhas de dados além do cabeçalho (' + rows.length + ')');

  const headerRow = (rows[0] || []).map(h => h == null ? '' : String(h).trim());
  const faltando = PRODUCAO_COLUNAS_OBRIGATORIAS.filter(c => !headerRow.includes(c));
  assert(faltando.length === 0, 'todas as colunas obrigatórias existem no cabeçalho real (faltando: ' + faltando.join(', ') + ')');

  const records = window.extractProducaoRecords(rows);
  assert(records.length === 557, 'extração da planilha real produz 557 registros (558 linhas - 1 ARQUIVADO) — obtido: ' + records.length);
  assert(!records.some(r => r.etapa === 'ARQUIVADO (NEOCRM)'), 'nenhum registro extraído tem etapa ARQUIVADO (excluído por ser duplicata)');
  assert(records.every(r => r.grupo), 'todo registro extraído tem GRUPO preenchido');
  assert(records.every(r => r.usuario === r.usuario.toUpperCase()), 'usuário sempre vem em maiúsculas');

  // --- 5) contagem por categoria bate com a distribuição real de etapas da planilha ---
  let ganho = 0, perdido = 0, andamento = 0, devolvido = 0;
  records.forEach(r => {
    const cat = producaoEtapaCategoria(r.etapa);
    if(cat === 'ganho') ganho++; else if(cat === 'perdido') perdido++; else if(cat === 'devolvido') devolvido++; else andamento++;
  });
  assert(ganho === 167, 'ganho = CONCLUIDO(114) + ENTREGA(30) + PORTABILIDADE EM ANDAMENTO(17) + VALIDAÇÃO ESIM(6) = 167 (obtido ' + ganho + ')');
  assert(perdido === 262, 'perdido = VENDA PERDIDA = 262 (obtido ' + perdido + ')');
  assert(devolvido === 39, 'devolvido = DEVOLVIDO = 39, não soma em perdido (obtido ' + devolvido + ')');
  assert(andamento === 89, 'andamento = soma das demais etapas (inclui PORTABILIDADE EM TRATATIVA) = 89 (obtido ' + andamento + ')');
  assert(ganho + perdido + devolvido + andamento === records.length, 'toda categoria soma o total de registros extraídos');

  // --- 6) datas de cadastro/atualizacao foram convertidas pra ISO com offset -03:00 (fix de fuso de
  // 27/08/2026 — sem o offset, a sessão UTC do Supabase gravava a hora errada, ver seção 9.1 acima) ---
  const comData = records.find(r => r.cadastro);
  assert(comData && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}-03:00$/.test(comData.cadastro), 'cadastro vira ISO "aaaa-mm-ddThh:mm:ss-03:00" (' + (comData && comData.cadastro) + ')');

  // --- 7) gating de upload/visibilidade por perfil ---
  currentUser.role = 'consultor';
  assert(canUploadProducao() === false, 'consultor não pode subir a planilha de produção');
  assert(producaoAdminMode() === false, 'consultor não entra em ADMIN_MODE (não vê Cliente/CNPJ)');
  currentUser.role = 'supervisor';
  assert(canUploadProducao() === false, 'supervisor não pode subir a planilha de produção');
  assert(producaoAdminMode() === true, 'supervisor entra em ADMIN_MODE (vê Cliente/CNPJ, mas não sobe planilha)');
  currentUser.role = 'admin';
  assert(canUploadProducao() === true, 'admin pode subir a planilha de produção');
  assert(producaoAdminMode() === true, 'admin entra em ADMIN_MODE (vê Cliente/CNPJ)');

  // --- 8) template embutido: decodifica certo e tem todos os placeholders, sem sobrar nenhum depois de substituir ---
  // Mesmo decode UTF-8-safe usado em loadProducaoDashboard() (atob() sozinho corrompe acentos —
  // ver bug corrigido em 24/08/2026).
  const tplBytes = Uint8Array.from(atob(PRODUCAO_DASHBOARD_TPL_B64), c => c.charCodeAt(0));
  let tpl = new TextDecoder('utf-8').decode(tplBytes);
  assert(tpl.startsWith('<!DOCTYPE html>'), 'template decodificado começa com <!DOCTYPE html>');
  assert(tpl.includes('VALIDAÇÃO ESIM'), 'decode UTF-8-safe reconstrói acentos corretamente (ex.: VALIDAÇÃO, não "VALIDAÃÃO")');
  ['__DATA__','__ADMIN_MODE__','__ADMIN_BADGE__','__APEX_B64__','__CLARO_B64__','__UPDATED_AT__'].forEach(ph => {
    assert(tpl.includes(ph), 'template decodificado contém o placeholder ' + ph);
  });
  const filled = tpl
    .replace('__DATA__', JSON.stringify(records.slice(0,2)))
    .replace('__ADMIN_MODE__', 'true')
    .replace('__ADMIN_BADGE__', '<span class="admin-badge">ADMIN</span>')
    .replace('__APEX_B64__', 'AAAA')
    .replace('__CLARO_B64__', 'BBBB')
    .replace('__UPDATED_AT__', '24/08/2026 10:00');
  // checa só os 6 placeholders de build conhecidos — o app tem seus próprios sentinelas internos
  // (ex.: usr === '__TOTAL__' na composição por vendedor) que também batem no padrão __X__ mas não
  // são placeholders de build, então não dá pra usar uma regex genérica aqui.
  const sobrou = ['__DATA__','__ADMIN_MODE__','__ADMIN_BADGE__','__APEX_B64__','__CLARO_B64__','__UPDATED_AT__'].filter(ph => filled.includes(ph));
  assert(sobrou.length === 0, 'depois de substituir, nenhum dos 6 placeholders de build sobra no HTML preenchido (sobrou: ' + sobrou.join(', ') + ')');

  // --- 9) template embutido categoriza Portabilidade em Andamento / Validação eSIM como ganho ---
  assert(tpl.includes("'PORTABILIDADE EM ANDAMENTO (NEOCRM)':'ganho'"), 'template embutido: PORTABILIDADE EM ANDAMENTO também é ganho lá dentro (não só na extração)');
  assert(tpl.includes("'VALIDAÇÃO ESIM (NEOCRM)':'ganho'"), 'template embutido: VALIDAÇÃO ESIM também é ganho lá dentro (não só na extração)');

  // --- 9.1) fix de fuso horário (27/08/2026): fmtDate() do template embutido fixa o fuso em São
  // Paulo na exibição, em vez de depender do fuso do navegador de quem está vendo o painel.
  assert(tpl.includes("timeZone:'America/Sao_Paulo'"), 'fmtDate() do template embutido fixa timeZone America/Sao_Paulo (defesa extra além do fix na gravação)');
  const trechoFmtDate = tpl.slice(tpl.indexOf('function fmtDate('), tpl.indexOf('let CURRENT_FILTERED'));
  assert((trechoFmtDate.match(/timeZone:'America\\/Sao_Paulo'/g) || []).length === 2, 'fmtDate() fixa o fuso tanto na data quanto na hora (2 ocorrências)');

  // --- 10) tabela "Valor por Etapa" tem coluna de quantidade de pedidos, além de valor e % ---
  assert(tpl.includes('<table id="etapaTotalTable">'), 'template contém a tabela etapaTotalTable');
  assert(/<thead><tr><th>Etapa<\\/th><th>Qtd<\\/th><th>Valor<\\/th><th>% Total<\\/th><\\/tr><\\/thead>/.test(tpl), 'cabeçalho da tabela "Valor por Etapa" tem as colunas Etapa, Qtd, Valor e % Total, nessa ordem');
  assert(tpl.includes('const countEtapa'), 'função renderEtapaTotals conta quantos pedidos existem por etapa (countEtapa)');
  assert(tpl.includes('grandCount'), 'linha de total da tabela soma a quantidade de pedidos de todas as etapas (grandCount)');

  // --- 11) analítico (drilldown): abre respeitando a área visível da tela, não o iframe inteiro ---
  assert(tpl.includes('function estaEmbutidoEmIframe'), 'template embutido detecta se está rodando dentro de um iframe');
  assert(tpl.includes('function ajustarPosicaoDrilldown'), 'template embutido tem a função que reposiciona o modal do analítico');
  assert(/openDrilldown\\([^)]*\\)\\{[\\s\\S]*?ajustarPosicaoDrilldown\\(\\);[\\s\\S]*?\\}/.test(tpl), 'openDrilldown() chama ajustarPosicaoDrilldown() ao abrir o modal');
  assert(tpl.includes("window.parent.addEventListener('scroll', ajustarPosicaoDrilldown"), 'reposiciona o modal automaticamente quando a página externa rola (não só na abertura)');
  assert(tpl.includes('.modal-body{padding:14px 20px 20px 20px;overflow:auto;flex:1 1 auto;min-height:0;}'), '.modal-body vira de fato a área que rola dentro do card (flex:1 + min-height:0 — sem isso o card cresce pro tamanho do conteúdo em vez de rolar por dentro)');

  // --- 13) analítico: menos rolagem horizontal (card mais largo + colunas de texto longo quebram linha) ---
  assert(tpl.includes('max-width:1400px'), 'card do analítico mais largo (1150px → 1400px), aproveitando que a aba agora tem mais espaço de tela');
  assert(tpl.includes('#drilldownTable td.col-wrap{white-space:normal;max-width:200px;}'), 'colunas de texto mais longo têm uma regra pra quebrar linha em vez de esticar a tabela');
  assert(/<td class="col-wrap">\\$\\{shortEtapa\\(r\\.etapa\\)\\}<\\/td>/.test(tpl), 'coluna Etapa quebra linha em vez de forçar rolagem horizontal');
  assert(/<td class="col-wrap">\\$\\{r\\.usuario \\|\\| '-'\\}<\\/td>/.test(tpl), 'coluna Vendedor quebra linha em vez de forçar rolagem horizontal');
  assert(/<td class="col-wrap">\\$\\{tagLabel\\(r\\.tag\\)\\}<\\/td>/.test(tpl), 'coluna Motivo (a mais sujeita a texto longo) quebra linha em vez de forçar rolagem horizontal');
  assert(/<td class="col-wrap">\\$\\{r\\.cliente \\|\\| '-'\\}<\\/td>/.test(tpl), 'coluna Cliente (admin) quebra linha em vez de forçar rolagem horizontal');
  // Pedido, Grupo, datas, Valor e CNPJ são compactos por natureza — continuam numa linha só.
  assert(/<td>\\$\\{r\\.numero_pedido \\|\\| '-'\\}<\\/td>/.test(tpl), 'coluna Pedido continua compacta (sem quebrar linha)');
  assert(/<td>\\$\\{r\\.cnpj \\|\\| '-'\\}<\\/td>/.test(tpl), 'coluna CNPJ/CPF continua compacta (sem quebrar linha)');

  // --- 12) lógica de reposicionamento do drilldown: roda de verdade contra geometria simulada ---
  // Extrai só as duas funções puras (sem depender do resto do dashboard) e roda com um
  // window/document falsos, simulando um iframe de 5000px onde o usuário rolou a página externa
  // até só sobrar visível o trecho entre y=1500 e y=2300 dentro do iframe.
  const inicioFns = tpl.indexOf('function estaEmbutidoEmIframe');
  const fimFns = tpl.indexOf('function openDrilldown(');
  assert(inicioFns > -1 && fimFns > inicioFns, 'consegue isolar o trecho das funções de reposicionamento no template');
  const trechoFns = tpl.slice(inicioFns, fimFns);

  function overlayFalso(aberto){ return { classList: { contains: c => c === 'open' && aberto }, style: {} }; }
  function boxFalso(){ return { style: {} }; }

  // Cenário A: rodando standalone (fora de iframe) — mantém o comportamento padrão do CSS (fixed).
  {
    const overlay = overlayFalso(true);
    const box = boxFalso();
    const docFalso = {
      getElementById: id => id === 'drilldownOverlay' ? overlay : null,
      querySelector: sel => sel === '#drilldownOverlay .modal-box' ? box : null,
      documentElement: { scrollHeight: 3000 },
    };
    const winFalso = { frameElement: null, parent: null };
    const construir = new Function('window', 'document', trechoFns + '\\nreturn { estaEmbutidoEmIframe, ajustarPosicaoDrilldown };');
    const { estaEmbutidoEmIframe, ajustarPosicaoDrilldown } = construir(winFalso, docFalso);
    assert(estaEmbutidoEmIframe() === false, 'fora de iframe, estaEmbutidoEmIframe() retorna false');
    overlay.style.top = '999px';
    box.style.maxHeight = '999px';
    ajustarPosicaoDrilldown();
    assert(overlay.style.top === '', 'fora de iframe, ajustarPosicaoDrilldown() não mexe na posição (deixa o CSS padrão centralizar)');
    assert(box.style.maxHeight === '', 'fora de iframe, não mexe no max-height do card (deixa os 85vh do CSS, que ali é a tela de verdade)');
  }

  // Cenário B: embutido em iframe de 5000px, página externa rolada de forma que só o trecho
  // iframe-local [1500, 2300] está visível — o overlay deve cobrir exatamente essa faixa, e o
  // card do analítico não pode passar de ~85% dos 800px de tela real (senão fica gigante e sem
  // rolagem própria pra navegar entre os pedidos, que era a reclamação original).
  {
    const overlay = overlayFalso(true);
    const box = boxFalso();
    const docFalso = {
      getElementById: id => id === 'drilldownOverlay' ? overlay : null,
      querySelector: sel => sel === '#drilldownOverlay .modal-box' ? box : null,
      documentElement: { scrollHeight: 5000 },
    };
    const winFalso = {
      frameElement: { getBoundingClientRect: () => ({ top: -1500 }) },
      parent: { innerHeight: 800, addEventListener: () => {} },
    };
    const construir = new Function('window', 'document', trechoFns + '\\nreturn { estaEmbutidoEmIframe, ajustarPosicaoDrilldown };');
    const { estaEmbutidoEmIframe, ajustarPosicaoDrilldown } = construir(winFalso, docFalso);
    assert(estaEmbutidoEmIframe() === true, 'dentro de iframe (mesma origem), estaEmbutidoEmIframe() retorna true');
    ajustarPosicaoDrilldown();
    assert(overlay.style.position === 'absolute', 'dentro de iframe, o overlay vira position:absolute (não confia no fixed do CSS)');
    assert(overlay.style.top === '1500px', 'overlay começa exatamente onde a área visível da tela começa dentro do iframe (' + overlay.style.top + ')');
    assert(overlay.style.height === '800px', 'overlay cobre exatamente a altura visível da tela externa (' + overlay.style.height + ')');
    assert(box.style.maxHeight === '640px', 'card do analítico limitado a 85% dos 800px de tela real = 640px, não a altura do iframe inteiro (' + box.style.maxHeight + ')');
  }

  // Cenário C: modal fechado — não deve mexer em nada (evita trabalho à toa em todo scroll/resize).
  {
    const overlay = overlayFalso(false);
    overlay.style.top = 'valor-nao-deveria-mudar';
    const box = boxFalso();
    const docFalso = {
      getElementById: id => id === 'drilldownOverlay' ? overlay : null,
      querySelector: sel => sel === '#drilldownOverlay .modal-box' ? box : null,
      documentElement: { scrollHeight: 5000 },
    };
    const winFalso = { frameElement: { getBoundingClientRect: () => ({ top: -1500 }) }, parent: { innerHeight: 800, addEventListener: () => {} } };
    const construir = new Function('window', 'document', trechoFns + '\\nreturn { ajustarPosicaoDrilldown };');
    const { ajustarPosicaoDrilldown } = construir(winFalso, docFalso);
    ajustarPosicaoDrilldown();
    assert(overlay.style.top === 'valor-nao-deveria-mudar', 'com o modal fechado, ajustarPosicaoDrilldown() não mexe em nada');
  }

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
`;

// Le a planilha REAL com SheetJS (Node) antes de rodar o script — mais fiel que simular linhas à mão.
window.__testWorkbook = XLSX.readFile('ExportacaoProducao18080917.xlsx');
window.__testXLSXUtils = XLSX.utils;

window.eval(jsCode + testScript);

// --- 13) loadProducaoDashboard() ajusta a altura do iframe pro tamanho real do conteúdo, em vez
// de deixar um scroll interno separado do scroll da página (checagem no código-fonte, fora do
// sandbox, já que frame.onload/ResizeObserver não têm layout real pra testar via jsdom) ---
{
  let ok2 = 0, fail2 = 0;
  const assert2 = (cond, msg) => { if(cond){ ok2++; } else { fail2++; console.log('FALHOU:', msg); } };
  assert2(jsCode.includes('frame.onload = function()'), 'loadProducaoDashboard() define frame.onload pra ajustar a altura depois de carregar');
  assert2(jsCode.includes('doc.documentElement.scrollHeight'), 'altura do iframe é calculada a partir do scrollHeight real do conteúdo');
  assert2(jsCode.includes('new frame.contentWindow.ResizeObserver'), 'usa ResizeObserver pra reajustar a altura quando o conteúdo interno muda (troca de aba, filtros, etc.)');
  console.log('--- (altura do iframe) RESULTADO:', ok2, 'passaram,', fail2, 'falharam ---');
  if(fail2 > 0) process.exitCode = 1;
}

// --- 14) fix de fuso horário (27/08/2026): o "Atualizado em" do topo do dashboard (gerado no
// upload) também fixa São Paulo, em vez de depender do fuso do computador de quem faz o upload
// (checagem no código-fonte, mesmo motivo do bloco anterior) ---
{
  let ok3 = 0, fail3 = 0;
  const assert3 = (cond, msg) => { if(cond){ ok3++; } else { fail3++; console.log('FALHOU:', msg); } };
  assert3(jsCode.includes("new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })"), '"Atualizado em" do Dashboard de Produção fixa timeZone America/Sao_Paulo na geração');
  console.log('--- (fuso horário: Atualizado em) RESULTADO:', ok3, 'passaram,', fail3, 'falharam ---');
  if(fail3 > 0) process.exitCode = 1;
}

// --- 15) NÃO deduplicar linhas (revertido em 10/09/2026): chegamos a testar um dedup de linhas
// 100% idênticas (motivado por um print com o pedido 49541316 3x igual), mas o usuário confirmou
// que isso apagou linhas REAIS (dia 09/09 tinha 21 linhas de verdade, o dashboard com o dedup
// mostrou só 14). extractProducaoRecords() volta a manter 1 registro por linha da planilha, sem
// nenhuma deduplicação — cada linha pode representar uma venda distinta mesmo com todos os campos
// iguais, o NeoCRM não garante unicidade nenhuma nesse sentido. Ver REGRAS_NEGOCIO.md seção 16.12. ---
{
  let ok4 = 0, fail4 = 0;
  const assert4 = (cond, msg) => { if(cond){ ok4++; } else { fail4++; console.log('FALHOU:', msg); } };
  const header = ['GRUPO','PROPRIETÁRIO DO PEDIDO','ETAPA PEDIDO','CADASTRO','ATUALIZACAO','VALOR UNIT','NUMERO PEDIDO','PRODUTO','NOME CLIENTE','CPF/CNPJ','TAGS ATIVIDADE','QUANTIDADE'];
  function linha(vals){
    const row = new Array(header.length).fill(null);
    Object.keys(vals).forEach(k => { row[header.indexOf(k)] = vals[k]; });
    return row;
  }
  const rowsSintetico = [header,
    // pedido 111: 3 linhas 100% idênticas — cada uma continua contando como 1 registro
    linha({'GRUPO':'VOZ - Portabilidade','PROPRIETÁRIO DO PEDIDO':'CONSULTOR X','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'01/09/2026','ATUALIZACAO':'01/09/2026','VALOR UNIT':39.99,'NUMERO PEDIDO':'111','PRODUTO':'CLARO PÓS 10GB','NOME CLIENTE':'FULANO','CPF/CNPJ':'12345678900','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
    linha({'GRUPO':'VOZ - Portabilidade','PROPRIETÁRIO DO PEDIDO':'CONSULTOR X','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'01/09/2026','ATUALIZACAO':'01/09/2026','VALOR UNIT':39.99,'NUMERO PEDIDO':'111','PRODUTO':'CLARO PÓS 10GB','NOME CLIENTE':'FULANO','CPF/CNPJ':'12345678900','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
    linha({'GRUPO':'VOZ - Portabilidade','PROPRIETÁRIO DO PEDIDO':'CONSULTOR X','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'01/09/2026','ATUALIZACAO':'01/09/2026','VALOR UNIT':39.99,'NUMERO PEDIDO':'111','PRODUTO':'CLARO PÓS 10GB','NOME CLIENTE':'FULANO','CPF/CNPJ':'12345678900','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
    // pedido 222: 2 linhas com produtos diferentes
    linha({'GRUPO':'APARELHO','PROPRIETÁRIO DO PEDIDO':'CONSULTOR Y','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'02/09/2026','ATUALIZACAO':'02/09/2026','VALOR UNIT':999,'NUMERO PEDIDO':'222','PRODUTO':'IPHONE 13','NOME CLIENTE':'CICLANO','CPF/CNPJ':'98765432100','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
    linha({'GRUPO':'VOZ - Novo','PROPRIETÁRIO DO PEDIDO':'CONSULTOR Y','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'02/09/2026','ATUALIZACAO':'02/09/2026','VALOR UNIT':39.99,'NUMERO PEDIDO':'222','PRODUTO':'CLARO PÓS 10GB','NOME CLIENTE':'CICLANO','CPF/CNPJ':'98765432100','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
    // pedido 333: linha única
    linha({'GRUPO':'VOZ - Renovação','PROPRIETÁRIO DO PEDIDO':'CONSULTOR Z','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'03/09/2026','ATUALIZACAO':'03/09/2026','VALOR UNIT':29.99,'NUMERO PEDIDO':'333','PRODUTO':'CLARO PÓS 6GB','NOME CLIENTE':'BELTRANO','CPF/CNPJ':'11122233344','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
  ];
  const recs = window.extractProducaoRecords(rowsSintetico);
  assert4(recs.length === 6, 'nenhuma linha é descartada por parecer duplicata: 3 (pedido 111) + 2 (pedido 222) + 1 (pedido 333) = 6 no total (obtido ' + recs.length + ')');
  assert4(recs.filter(r => r.numero_pedido === '111').length === 3, 'pedido 111 (3 linhas idênticas na planilha) mantém as 3 — cada linha pode ser uma venda real distinta');
  assert4(recs.filter(r => r.numero_pedido === '222').length === 2, 'pedido 222 (aparelho + plano, produtos diferentes) mantém as 2 linhas');
  assert4(recs.filter(r => r.numero_pedido === '333').length === 1, 'pedido 333 (linha única) continua normal');
  console.log('--- (sem dedup de linhas) RESULTADO:', ok4, 'passaram,', fail4, 'falharam ---');
  if(fail4 > 0) process.exitCode = 1;
}

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 2000);
