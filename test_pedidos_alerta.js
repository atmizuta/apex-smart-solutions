// Testa a aba "Pedidos em Alerta" do Dashboard de Produção (28/09/2026, REGRAS_NEGOCIO.md seção 48).
// Mesma técnica de test_visao_diaria.js: decodifica o template embutido de verdade
// (PRODUCAO_DASHBOARD_TPL_B64), preenche os placeholders com dados FICTÍCIOS e roda o script real num
// jsdom. Nenhum dado real de cliente aqui — o repositório é público.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const outerHtml = fs.readFileSync('_template.html', 'utf8');
const m = outerHtml.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/);
if(!m){ console.error('PRODUCAO_DASHBOARD_TPL_B64 nao encontrado'); process.exit(1); }
const tplRaw = Buffer.from(m[1], 'base64').toString('utf8');
const htmlNoScript = tplRaw.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = tplRaw.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script do template embutido nao encontrado'); process.exit(1); }
const jsOriginal = scriptMatch[1];

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// Monta o dashboard num jsdom novo. updatedAt imita o texto que o upload grava em config.
function montarDashboard({ adminMode = true, updatedAt = '28/09/2026, 20:12:03', data = [] } = {}){
  const html = htmlNoScript
    .replace('__ADMIN_BADGE__', '')
    .replace('__APEX_B64__', '')
    .replace('__CLARO_B64__', '')
    .replace('__UPDATED_AT__', updatedAt);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {};
  w.confirm = () => true;
  const js = jsOriginal
    .replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(data) + ';')
    .replace('__ADMIN_MODE__', adminMode ? 'true' : 'false');
  w.eval(js);
  return w;
}

// Registro no formato de producao_pedidos (dados fictícios). Referência dos testes: seg 28/09/2026.
function ped(over){ return Object.assign({
  numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'Caio', etapa: 'ENTREGA (NEOCRM)',
  cadastro: '2026-09-01T10:00:00-03:00', atualizacao: '2026-09-28T10:00:00-03:00',
  valor: 50, quantidade: 1, produto: 'Plano Teste', cliente: 'EMPRESA FICTICIA LTDA', cnpj: '11111111000100', tag: null,
}, over); }

const FIXTURE = [
  ped({ numero_pedido: 'A1', atualizacao: '2026-09-25T10:00:00-03:00' }),                                        // sex → 1 d.u. (fora)
  ped({ numero_pedido: 'A7', atualizacao: '2026-09-24T10:00:00-03:00' }),                                        // qui → 2 d.u. (fora)
  ped({ numero_pedido: 'A2', atualizacao: '2026-09-23T10:00:00-03:00', usuario: 'Caio' }),                       // qua → 3 (mínimo)
  ped({ numero_pedido: 'A8', etapa: 'ANTIFRAUDE (NEOCRM)', atualizacao: '2026-09-21T10:00:00-03:00', usuario: 'Giovanna' }), // 5 (mínimo)
  ped({ numero_pedido: 'A3', etapa: 'ANTIFRAUDE (NEOCRM)', atualizacao: '2026-09-18T10:00:00-03:00', usuario: 'Giovanna' }), // 6 (médio)
  ped({ numero_pedido: 'A5', etapa: 'PORTABILIDADE EM TRATATIVA (NEOCRM)', atualizacao: '2026-09-15T10:00:00-03:00', usuario: 'Vitor' }), // 9 (médio)
  ped({ numero_pedido: 'A4', etapa: 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', atualizacao: '2026-09-14T10:00:00-03:00', usuario: 'Caio' }), // 10 (máximo)
  // pedido com 3 linhas: vale a atualização MAIS RECENTE (02/09, qua; 07/09 é feriado) → 17 d.u. (máximo)
  ped({ numero_pedido: 'M1', atualizacao: '2026-09-01T09:00:00-03:00', cadastro: '2026-08-20T08:00:00-03:00', valor: 10, quantidade: 1, produto: 'Plano B', cnpj: '00123456000190' }),
  ped({ numero_pedido: 'M1', atualizacao: '2026-09-02T15:45:00-03:00', cadastro: '2026-08-21T08:00:00-03:00', valor: 20, quantidade: 2, produto: 'Plano A', cnpj: '00123456000190' }),
  ped({ numero_pedido: 'M1', atualizacao: '2026-09-01T09:00:00-03:00', cadastro: '2026-08-22T08:00:00-03:00', valor: 30, quantidade: 3, produto: 'Plano A', cnpj: '00123456000190' }),
  // UTC: 22/09 01:30Z = 21/09 22:30 em São Paulo → conta a partir de 21/09 → 5 d.u. (mínimo). Pelo dia UTC daria 4.
  ped({ numero_pedido: 'U1', atualizacao: '2026-09-22T01:30:00+00:00', usuario: 'Vitor' }),
  // ignorados:
  ped({ numero_pedido: 'X1', etapa: 'CONCLUIDO (NEOCRM)', atualizacao: '2026-08-01T10:00:00-03:00' }),        // etapa fora da lista
  ped({ numero_pedido: null, atualizacao: '2026-08-01T10:00:00-03:00' }),                                       // sem nº de pedido
  ped({ numero_pedido: 'N1', atualizacao: null }),                                                             // sem atualização
];

// ---------------- Task 2: regra ----------------
{
  const w = montarDashboard({ data: FIXTURE });

  // parseDataReferencia
  const r1 = w.parseDataReferencia('28/09/2026, 20:12:03');
  assert(r1 && r1.date === '2026-09-28' && r1.hora === '20:12', 'parseDataReferencia lê "dd/mm/aaaa, hh:mm:ss" → ' + JSON.stringify(r1));
  const r2 = w.parseDataReferencia('Atualizado em: 28/09/2026 20:12:03');
  assert(r2 && r2.date === '2026-09-28' && r2.hora === '20:12', 'parseDataReferencia aceita prefixo e ausência de vírgula');
  assert(w.parseDataReferencia('—') === null, 'parseDataReferencia("—") → null');
  assert(w.parseDataReferencia('') === null, 'parseDataReferencia("") → null');

  // diasUteisDesde
  assert(w.diasUteisDesde('2026-09-25', '2026-09-28') === 1, 'sexta → segunda = 1 dia útil');
  assert(w.diasUteisDesde('2026-09-26', '2026-09-28') === 1, 'sábado → segunda = 1 (fim de semana não conta)');
  assert(w.diasUteisDesde('2026-09-04', '2026-09-09') === 2, '04/09 → 09/09 = 2 (07/09 é feriado)');
  assert(w.diasUteisDesde('2026-09-28', '2026-09-28') === 0, 'mesmo dia = 0');
  assert(w.diasUteisDesde('2026-09-29', '2026-09-28') === 0, 'referência anterior à atualização = 0');
  assert(w.diasUteisDesde('2026-12-30', '2027-01-04') === 2, '30/12 → 04/01 = 2 (01/01 feriado, fim de semana no meio)');
  const t0 = Date.now();
  const antigo = w.diasUteisDesde('2024-01-02', '2026-09-28');
  assert(antigo > 600 && Date.now() - t0 < 500, 'pedido de 2024 dá muitos dias úteis e calcula rápido (' + antigo + ', ' + (Date.now() - t0) + 'ms)');

  // nivelAlerta nas fronteiras
  [[0, null], [2, null], [3, 'minimo'], [5, 'minimo'], [6, 'medio'], [9, 'medio'], [10, 'maximo'], [40, 'maximo']].forEach(([d, esperado]) => {
    assert(w.nivelAlerta(d) === esperado, 'nivelAlerta(' + d + ') === ' + esperado + ' (veio ' + w.nivelAlerta(d) + ')');
  });

  // montarPedidosEmAlerta
  const lista = w.montarPedidosEmAlerta(FIXTURE, '2026-09-28');
  const ids = lista.map(p => p.numero_pedido);
  assert(JSON.stringify(ids) === JSON.stringify(['M1', 'A4', 'A5', 'A3', 'U1', 'A8', 'A2']),
    'lista na ordem dias desc → etapa (Entrega antes de Antifraude no empate) → nº: ' + JSON.stringify(ids));
  const m1 = lista.find(p => p.numero_pedido === 'M1');
  assert(m1.dias === 17 && m1.nivel === 'maximo', 'M1 usa a atualização mais recente (02/09) → 17 d.u. máximo (veio ' + m1.dias + ')');
  assert(m1.qtd === 6 && m1.valor === 60, 'M1 soma quantidade (6) e valor (60)');
  assert(m1.produtos === 'Plano A + Plano B', 'M1 lista produtos distintos em ordem: ' + m1.produtos);
  assert(m1.cadastro === '2026-08-20T08:00:00-03:00', 'M1 usa o cadastro mais antigo');
  assert(m1.atualizacao === '2026-09-02T15:45:00-03:00', 'M1 guarda a atualização mais recente');
  assert(m1.cnpj === '00123456000190', 'CNPJ preserva zeros à esquerda');
  const u1 = lista.find(p => p.numero_pedido === 'U1');
  assert(u1 && u1.dias === 5, 'U1 (UTC 22/09 01:30 = 21/09 em SP) conta 5 d.u. pelo dia de São Paulo (veio ' + (u1 && u1.dias) + ')');
  assert(!ids.includes('A1') && !ids.includes('A7'), 'pedidos com 1 e 2 dias úteis ficam de fora');
  assert(!ids.includes('X1') && !ids.includes('N1') && !ids.includes(null), 'etapa fora da lista, sem nº e sem atualização são ignorados');

  // numero_pedido numérico e texto viram 1 pedido só
  const misto = w.montarPedidosEmAlerta([
    ped({ numero_pedido: 123, atualizacao: '2026-09-01T10:00:00-03:00', quantidade: 1 }),
    ped({ numero_pedido: '123', atualizacao: '2026-09-01T10:00:00-03:00', quantidade: 2 }),
  ], '2026-09-28');
  assert(misto.length === 1 && misto[0].qtd === 3 && misto[0].numero_pedido === '123', 'nº 123 (número) e "123" (texto) são o mesmo pedido');

  // resumirAlertas
  const res = w.resumirAlertas(lista);
  const ent = res.porEtapa['ENTREGA (NEOCRM)'];
  assert(ent.minimo === 2 && ent.medio === 0 && ent.maximo === 1 && ent.total === 3, 'Entrega: 2 mín, 0 méd, 1 máx: ' + JSON.stringify(ent));
  const anti = res.porEtapa['ANTIFRAUDE (NEOCRM)'];
  assert(anti.minimo === 1 && anti.medio === 1 && anti.maximo === 0 && anti.total === 2, 'Antifraude: 1 mín, 1 méd: ' + JSON.stringify(anti));
  assert(res.porEtapa['PORTABILIDADE EM ANDAMENTO (NEOCRM)'].maximo === 1, 'Port. andamento: 1 máx');
  assert(res.porEtapa['PORTABILIDADE EM TRATATIVA (NEOCRM)'].medio === 1, 'Port. tratativa: 1 méd');
  assert(JSON.stringify(res.total) === JSON.stringify({ minimo: 3, medio: 2, maximo: 2, total: 7 }), 'total geral 3/2/2 = 7: ' + JSON.stringify(res.total));

  // filtrarAlertas
  assert(w.filtrarAlertas(lista, { etapa: '', nivel: '', consultor: '' }).length === 7, 'sem filtro = 7');
  assert(w.filtrarAlertas(lista, { etapa: 'ENTREGA (NEOCRM)', nivel: 'minimo', consultor: '' }).length === 2, 'Entrega + mínimo = 2');
  assert(w.filtrarAlertas(lista, { etapa: '', nivel: 'maximo', consultor: 'Caio' }).length === 2, 'máximo + Caio = 2 (M1, A4)');
}

// ---------------- Task 3: tela ----------------
{
  // consultor (ADMIN_MODE=false): a aba não existe
  const wc = montarDashboard({ adminMode: false, data: FIXTURE });
  assert(!wc.document.querySelector('.tab-btn[data-tab="alertas"]'), 'consultor: botão da aba não existe');
  assert(!wc.document.getElementById('tabAlertas'), 'consultor: painel #tabAlertas não existe no DOM');

  const w = montarDashboard({ data: FIXTURE });
  const d = w.document;
  const btn = d.querySelector('.tab-btn[data-tab="alertas"]');
  assert(btn && btn.textContent.trim() === 'Pedidos em Alerta', 'admin: botão "Pedidos em Alerta" existe');
  w.switchTab('alertas');
  assert(d.getElementById('tabAlertas').classList.contains('active'), 'switchTab("alertas") ativa o painel');
  assert(d.body.classList.contains('tab-alertas'), 'switchTab("alertas") põe a classe tab-alertas no body (esconde a barra de filtros)');
  w.switchTab('overview');
  assert(!d.body.classList.contains('tab-alertas'), 'voltar pra Visão Geral tira a classe tab-alertas');
  w.switchTab('alertas');

  const valorCard = (k) => (d.querySelector('.alerta-card-' + k + ' .value') || {}).textContent;
  assert(valorCard('total') === '7' && valorCard('maximo') === '2' && valorCard('medio') === '2' && valorCard('minimo') === '3',
    'placar 7 / 2 máx / 2 méd / 3 mín: ' + [valorCard('total'), valorCard('maximo'), valorCard('medio'), valorCard('minimo')].join('/'));
  assert(d.getElementById('alertaSub').textContent.includes('base de 28/09/2026 20:12'), 'subtítulo mostra a data da base: ' + d.getElementById('alertaSub').textContent);

  const linhas = () => [...d.querySelectorAll('#alertaBody tr')];
  const pedidos = () => linhas().map(tr => tr.dataset.pedido);
  assert(JSON.stringify(pedidos()) === JSON.stringify(['M1', 'A4', 'A5', 'A3', 'U1', 'A8', 'A2']), 'tabela na ordem certa: ' + JSON.stringify(pedidos()));
  assert(linhas()[0].classList.contains('alerta-maximo') && linhas()[2].classList.contains('alerta-medio') && linhas()[6].classList.contains('alerta-minimo'),
    'linhas com a classe de cor do nível');
  assert(linhas()[0].textContent.includes('MÁXIMO') && linhas()[0].textContent.includes('00123456000190') && linhas()[0].textContent.includes('Plano A + Plano B'),
    'linha mostra selo, CNPJ (admin) e produtos');

  // clique na matriz: Entrega × Mínimo
  const link = d.querySelector('#alertaMatriz a[data-etapa="ENTREGA (NEOCRM)"][data-nivel="minimo"]');
  assert(link && link.textContent === '2', 'matriz: Entrega × Mínimo = 2');
  link.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(JSON.stringify(pedidos()) === JSON.stringify(['U1', 'A2']), 'clique na matriz filtra a tabela: ' + JSON.stringify(pedidos()));
  assert(d.getElementById('alertaFiltroEtapa').value === 'ENTREGA (NEOCRM)' && d.getElementById('alertaFiltroNivel').value === 'minimo', 'clique na matriz atualiza os selects');

  // selects combinados
  w.limparFiltrosAlerta();
  assert(pedidos().length === 7, 'limpar filtros volta a 7');
  d.getElementById('alertaFiltroNivel').value = 'maximo';
  d.getElementById('alertaFiltroConsultor').value = 'Caio';
  w.onFiltroAlerta();
  assert(JSON.stringify(pedidos()) === JSON.stringify(['M1', 'A4']), 'máximo + Caio = M1, A4: ' + JSON.stringify(pedidos()));
  assert(valorCard('total') === '7', 'placar continua mostrando o total geral com filtro ativo');

  // atualização de hora em hora: nova referência 02/10 (sex), filtros preservados
  w.limparFiltrosAlerta();
  d.getElementById('alertaFiltroNivel').value = 'medio';
  w.onFiltroAlerta();
  w.atualizarDadosDashboard(FIXTURE, '02/10/2026, 09:00:00');
  assert(d.querySelector('.topbar .updated').textContent === 'Atualizado em: 02/10/2026, 09:00:00', 'topo mostra o novo "Atualizado em"');
  assert(d.getElementById('alertaFiltroNivel').value === 'medio', 'filtro de nível preservado após a atualização');
  assert(pedidos().includes('A7') && pedidos().includes('A2'), 'com referência 02/10, A7 (6 d.u.) e A2 (7 d.u.) viram médio: ' + JSON.stringify(pedidos()));

  // consultor filtrado que some na atualização → filtro volta pra "Todos"
  w.limparFiltrosAlerta();
  d.getElementById('alertaFiltroConsultor').value = 'Vitor';
  w.onFiltroAlerta();
  w.atualizarDadosDashboard(FIXTURE.filter(r => r.usuario !== 'Vitor'), '28/09/2026, 20:12:03');
  assert(d.getElementById('alertaFiltroConsultor').value === '' && pedidos().length === 5, 'consultor que sumiu volta pra "Todos" (5 pedidos sem os do Vitor): ' + pedidos().length);

  // estado vazio
  const wv = montarDashboard({ data: [ped({ numero_pedido: 'A1', atualizacao: '2026-09-25T10:00:00-03:00' })] });
  wv.switchTab('alertas');
  assert(wv.document.getElementById('alertaMsg').textContent.includes('Nenhum pedido parado há 3 dias úteis'), 'estado vazio com mensagem');
  assert(wv.document.getElementById('alertaExportBtn').disabled === true, 'Exportar desabilitado sem pedidos');

  // referência ilegível → usa hoje e avisa
  const wd = montarDashboard({ updatedAt: '—', data: FIXTURE });
  assert(wd.document.getElementById('alertaSub').textContent.includes('data da base desconhecida'), 'sem data da base: aviso na tela');

  // HTML em nome de cliente/produto aparece como texto
  const wx = montarDashboard({ data: [ped({ numero_pedido: 'H1', atualizacao: '2026-09-01T10:00:00-03:00', cliente: '<b>ACME & "FILHOS"</b>', produto: '<img src=x>' })] });
  const tr = wx.document.querySelector('#alertaBody tr');
  // células 3 (Cliente) e 8 (Produtos) — o <b> dos dias úteis (célula 1) é intencional
  const celCliente = tr && tr.children[3], celProdutos = tr && tr.children[8];
  assert(celCliente && celCliente.children.length === 0 && celCliente.textContent === '<b>ACME & "FILHOS"</b>'
    && celProdutos.children.length === 0 && celProdutos.textContent === '<img src=x>', 'cliente/produto com HTML são escapados');
}

// celular: com o 4º botão ("Pedidos em Alerta") a linha de abas passava da tela (293px numa área de
// 271px) — em tela estreita os botões quebram linha (jsdom não calcula layout; checagem no CSS)
assert(/@media \(max-width:480px\)\{ \.tabs\{flex-wrap:wrap;/.test(tplRaw), 'abas quebram linha no celular (4 botões não cabem em 375px)');

// _template.html usa LF como o main oficial: a junção com a versão de 28/09 (copiada do repositório
// antigo) tinha trocado tudo pra CRLF — o diff contra o main mostraria ~15 mil linhas e qualquer outro
// ramo que mexesse no arquivo daria conflito
assert(!outerHtml.includes('\r\n'), '_template.html sem CRLF (LF, igual ao main oficial)');

// o painel externo passa o "Atualizado em" na atualização de 1h
assert(/win\.atualizarDadosDashboard\(novos, \(cfgAuto && cfgAuto\.valor\) \|\| null\)/.test(outerHtml), 'painel externo chama atualizarDadosDashboard(novos, atualizadoEm)');

// ---------------- Task 4: Excel ----------------
async function testarExcel(){
  // ExcelJS do Node só pra RELER o arquivo gerado. Quem GERA é o mesmo bundle de navegador que o
  // cdnjs serve (exceljs/dist/exceljs.min.js 4.4.0), carregado dentro do jsdom — assim Date/Array
  // são do mesmo "realm" da página, como no navegador de verdade.
  const ExcelJS = require('exceljs');
  const w = montarDashboard({ data: FIXTURE });
  const d = w.document;
  w.eval(fs.readFileSync(require.resolve('exceljs/dist/exceljs.min.js'), 'utf8'));
  assert(w.ExcelJS && typeof w.ExcelJS.Workbook === 'function', 'bundle de navegador da ExcelJS carregou no jsdom');
  assert((await w.carregarExcelJS()) === w.ExcelJS, 'carregarExcelJS reaproveita window.ExcelJS quando já existe');

  let baixado = null;
  w.baixarArquivo = (buffer, nome) => { baixado = { buffer, nome }; };
  w.switchTab('alertas');
  await w.exportarAlertasExcel();
  assert(baixado && baixado.nome === 'PedidosEmAlerta_2026-09-28.xlsx', 'nome do arquivo com a data da base: ' + (baixado && baixado.nome));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(baixado.buffer));
  assert(JSON.stringify(wb.worksheets.map(s => s.name)) === JSON.stringify(['Pedidos em Alerta', 'Resumo']), 'abas "Pedidos em Alerta" e "Resumo"');
  const ws = wb.getWorksheet('Pedidos em Alerta');
  assert(String(ws.getCell('A1').value).includes('Pedidos em Alerta'), 'linha 1 = título');
  const l2 = String(ws.getCell('A2').value);
  assert(l2.includes('Base de 28/09/2026 20:12') && l2.includes('Filtros: todos') && l2.includes('Máximo 10+'), 'linha 2 = base, legenda e filtros: ' + l2);
  const cab = [];
  for(let c = 1; c <= 13; c++) cab.push(ws.getRow(3).getCell(c).value);
  assert(JSON.stringify(cab) === JSON.stringify(['Nível', 'Dias úteis parado', 'Nº Pedido', 'Cliente', 'CPF/CNPJ', 'Consultor', 'Grupo', 'Etapa', 'Produtos', 'Qtd.', 'Valor total', 'Cadastro', 'Última atualização']),
    'cabeçalho na linha 3: ' + JSON.stringify(cab));
  assert(ws.getCell('A3').fill.fgColor.argb === 'FF1D1F20' && ws.getCell('A3').font.color.argb === 'FFFFFFFF', 'cabeçalho grafite com texto branco');
  const af = ws.autoFilter;
  assert(af === 'A3:M3' || (af && af.from && (af.from.row === 3 || af.from === 'A3')), 'filtro automático na linha 3: ' + JSON.stringify(af));
  assert(ws.views[0] && ws.views[0].state === 'frozen' && ws.views[0].ySplit === 3, 'painel congelado abaixo do cabeçalho: ' + JSON.stringify(ws.views[0]));
  assert(ws.actualRowCount === 3 + 7, '7 pedidos a partir da linha 4 (' + ws.actualRowCount + ' linhas)');

  // linha 4 = M1 (máximo)
  const r4 = ws.getRow(4);
  assert(r4.getCell(1).value === 'MÁXIMO' && r4.getCell(1).fill.fgColor.argb === 'FFC1050F' && r4.getCell(1).font.color.argb === 'FFFFFFFF', 'selo MÁXIMO vermelho com texto branco');
  assert(r4.getCell(2).fill.fgColor.argb === 'FFFFC7CE' && r4.getCell(13).fill.fgColor.argb === 'FFFFC7CE', 'linha inteira com fundo vermelho claro');
  assert(r4.getCell(2).value === 17, 'dias úteis como número');
  assert(r4.getCell(3).value === 'M1' && r4.getCell(5).value === '00123456000190', 'nº do pedido e CNPJ como texto (zeros preservados)');
  assert(r4.getCell(11).value === 60 && String(r4.getCell(11).numFmt).includes('R$'), 'valor numérico com formato R$');
  const atu = r4.getCell(13).value;
  assert(atu instanceof Date && atu.getUTCDate() === 2 && atu.getUTCHours() === 15 && atu.getUTCMinutes() === 45 && r4.getCell(13).numFmt === 'dd/mm/yyyy hh:mm',
    'última atualização como data do Excel no horário de São Paulo (02/09 15:45)');
  assert(r4.getCell(12).value instanceof Date && r4.getCell(12).numFmt === 'dd/mm/yyyy', 'cadastro como data');
  // linha 6 = A5 (médio) · linha 10 = A2 (mínimo)
  assert(ws.getRow(6).getCell(1).value === 'MÉDIO' && ws.getRow(6).getCell(1).fill.fgColor.argb === 'FFF97316' && ws.getRow(6).getCell(4).fill.fgColor.argb === 'FFFFD8B0', 'médio laranja');
  assert(ws.getRow(10).getCell(1).value === 'MÍNIMO' && ws.getRow(10).getCell(1).fill.fgColor.argb === 'FFEAB308'
    && ws.getRow(10).getCell(1).font.color.argb === 'FF000000' && ws.getRow(10).getCell(4).fill.fgColor.argb === 'FFFFF2A8', 'mínimo amarelo com texto preto');

  const rs = wb.getWorksheet('Resumo');
  const linhaResumo = n => [1, 2, 3, 4, 5].map(c => rs.getRow(n).getCell(c).value);
  assert(JSON.stringify(linhaResumo(1)) === JSON.stringify(['Etapa', 'Mínimo', 'Médio', 'Máximo', 'Total']), 'cabeçalho do resumo');
  assert(JSON.stringify(linhaResumo(2)) === JSON.stringify(['ENTREGA', 2, 0, 1, 3]), 'resumo Entrega: ' + JSON.stringify(linhaResumo(2)));
  assert(JSON.stringify(linhaResumo(6)) === JSON.stringify(['TOTAL', 3, 2, 2, 7]), 'resumo TOTAL: ' + JSON.stringify(linhaResumo(6)));

  // exporta só o filtrado
  d.getElementById('alertaFiltroNivel').value = 'maximo';
  w.onFiltroAlerta();
  await w.exportarAlertasExcel();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(Buffer.from(baixado.buffer));
  const ws2 = wb2.getWorksheet('Pedidos em Alerta');
  assert(ws2.actualRowCount === 3 + 2 && String(ws2.getCell('A2').value).includes('Filtros: Nível: MÁXIMO'), 'Excel só com os 2 pedidos filtrados e o filtro descrito');
  assert(wb2.getWorksheet('Resumo').getRow(6).getCell(5).value === 2, 'resumo do Excel filtrado soma 2');

  // falha ao carregar a biblioteca: mensagem e botão reabilitado
  w.carregarExcelJS = () => Promise.reject(new Error('sem internet'));
  const errOrig = w.console.error; w.console.error = () => {};
  await w.exportarAlertasExcel();
  w.console.error = errOrig;
  assert(d.getElementById('alertaMsg').textContent.includes('Não foi possível gerar o Excel'), 'falha ao carregar ExcelJS mostra aviso');
  assert(d.getElementById('alertaExportBtn').disabled === false, 'botão volta a ficar habilitado depois da falha');
}

testarExcel().catch(err => { fail++; console.log('FALHOU (exceção no teste do Excel):', err && err.stack || err); }).finally(() => {
  console.log('--- test_pedidos_alerta RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  if(fail > 0) process.exitCode = 1;
});
