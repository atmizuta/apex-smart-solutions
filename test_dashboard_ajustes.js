// Testa os ajustes do Dashboard de Produção de 30/09/2026 (REGRAS_NEGOCIO.md seção 55): seções recolhíveis
// (fechadas ao abrir), etapa TERRITÓRIO em todas as listas de etapas, barras que não passam por cima do texto
// e fonte arredondada nos números. Mesma técnica de test_pedidos_alerta.js: decodifica o template embutido
// (PRODUCAO_DASHBOARD_TPL_B64), preenche com dados FICTÍCIOS e roda o script real num jsdom.
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

function montarDashboard({ data = [] } = {}){
  const html = htmlNoScript.replace('__ADMIN_BADGE__', '').replace('__APEX_B64__', '').replace('__CLARO_B64__', '').replace('__UPDATED_AT__', '30/09/2026, 20:00:00');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true;
  w.eval(jsOriginal.replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(data) + ';').replace('__ADMIN_MODE__', 'true'));
  return w;
}
function ped(over){ return Object.assign({
  numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'Caio', etapa: 'ENTREGA (NEOCRM)',
  cadastro: '2026-09-01T10:00:00-03:00', atualizacao: '2026-09-28T10:00:00-03:00',
  valor: 100, quantidade: 1, produto: 'Plano Teste', cliente: 'EMPRESA FICTICIA LTDA', cnpj: '11111111000100', tag: null,
}, over); }

const BASE = [
  ped({ numero_pedido: 'A1', usuario: 'Caio', etapa: 'CONCLUIDO (NEOCRM)', valor: 300 }),
  ped({ numero_pedido: 'A2', usuario: 'Caio', etapa: 'BIOMETRIA (NEOCRM)', valor: 120 }),
  ped({ numero_pedido: 'A3', usuario: 'Giovanna', etapa: 'ENTREGA (NEOCRM)', valor: 80 }),
  ped({ numero_pedido: 'A4', usuario: 'Giovanna', etapa: 'VENDA PERDIDA (NEOCRM)', valor: 50, tag: '#SEMINTERESSE' }),
];

// ---------------------------------------------------------------- 1) seções recolhíveis
let w = montarDashboard({ data: BASE });
let d = w.document;
const secoes = [...d.querySelectorAll('details.collapse-sec')];
assert(secoes.length === 3, 'são 3 seções recolhíveis (total geral, motivos de perda, diagnóstico) — achou ' + secoes.length);
assert(secoes.every(s => !s.hasAttribute('open')), 'todas as seções abrem FECHADAS');
const titulos = secoes.map(s => s.querySelector('summary').textContent.trim());
assert(titulos[0].startsWith('Valor por Etapa (Total Geral)') && titulos[1].startsWith('Motivos de Perda') && titulos[2].startsWith('Diagnóstico e Plano de Ação'), 'títulos certos, na ordem: ' + JSON.stringify(titulos));
assert(d.querySelector('#secEtapaTotal #etapaTotalBody') && d.querySelector('#secMotivosPerda #lossReasonBody') && d.querySelector('#secDiagnostico #diagCardsWrap'), 'cada tabela/cartões está dentro da sua seção');
assert(d.getElementById('etapaTotalBody').querySelectorAll('tr').length > 0, 'o conteúdo é preenchido mesmo com a seção fechada (abrir só mostra)');
assert(d.getElementById('lossReasonBody').textContent.length > 0 && d.getElementById('diagCardsWrap').children.length > 0, 'motivos de perda e diagnóstico também são preenchidos fechados');
// as seções que NÃO devem recolher continuam como estavam
assert(!d.querySelector('details #userCardsWrap') && !d.querySelector('details #grupoTable'), 'valor por etapa por vendedor e valor por grupo continuam sempre visíveis');
const resumo = d.querySelector('#secEtapaTotal > summary');
resumo.click();
assert(d.getElementById('secEtapaTotal').hasAttribute('open'), 'clicar no título abre a seção');
resumo.click();
assert(!d.getElementById('secEtapaTotal').hasAttribute('open'), 'clicar de novo fecha');

// ---------------------------------------------------------------- 2) etapa TERRITÓRIO mesmo sem nenhum pedido nela
const linhasTotal = [...d.querySelectorAll('#etapaTotalBody tr.etapa-total-row')];
const terr = linhasTotal.find(tr => /TERRIT/i.test(tr.textContent));
assert(!!terr, 'Território aparece no Valor por Etapa (total geral) mesmo sem pedidos');
assert(terr && /R\$\s?0,00/.test(terr.textContent) && terr.cells[1].textContent.trim() === '0', 'Território sem pedidos aparece com 0 pedidos e R$ 0,00 — ' + (terr && terr.textContent.replace(/\s+/g, ' ')));
assert(terr && terr.textContent.includes('Andamento'), 'Território é categoria "Andamento" (decisão do usuário)');
assert(terr && terr.querySelector('.cell-bar-fill').style.width === '0%', 'a barra do Território sem valor fica vazia (não um risquinho de 4%)');
assert(d.querySelector('#etapaTotalBody tr.total-row td:nth-child(2)').textContent.trim() === '4', 'o total de linhas não é afetado pela linha zerada do Território');
const cartoes = [...d.querySelectorAll('#userCardsWrap .user-card')];
assert(cartoes.length === 3, 'cartão APEX SMART + 2 vendedores — achou ' + cartoes.length);
assert(cartoes.every(c => /TERRIT/i.test(c.textContent)), 'Território aparece em TODOS os cartões por vendedor (inclusive o total)');
const barraTerr = cartoes[0].querySelector('.uc-row[data-etapa*="TERRIT"] .uc-bar-fill');
assert(barraTerr && barraTerr.style.width === '0%', 'barra do Território sem valor no cartão está vazia');
assert([...d.querySelectorAll('#etapa-list input')].some(i => /TERRIT/i.test(i.value)), 'Território aparece no filtro de Etapa');
assert(/TERRIT/i.test(d.getElementById('alertaMatriz').textContent), 'Território é uma linha/coluna da matriz de Pedidos em Alerta (etapa monitorada)');
assert(w.eval("etapaCategory('TERRITORIO (NEOCRM)')") === 'andamento', 'etapaCategory(Território) = andamento');
assert(w.eval("ehTerritorio('TERRITORIO (NEOCRM)') && ehTerritorio('Território (NEOCRM)') && !ehTerritorio('ENTREGA (NEOCRM)')"), 'reconhece o Território em qualquer grafia e não confunde outras etapas');

// clicar na linha do Território (sem pedidos) não quebra nada
let erro = null; try{ terr.click(); }catch(e){ erro = e; }
assert(!erro, 'clicar na linha do Território sem pedidos não gera erro' + (erro ? ': ' + erro.message : ''));

// vendedor sem nenhum valor continua mostrando o estado vazio (o Território não "enche" o cartão)
w = montarDashboard({ data: [] }); d = w.document;
assert(d.getElementById('etapaTotalBody').textContent.includes('Sem dados'), 'sem dados nenhum: a tabela continua dizendo "Sem dados" (não mostra só o Território zerado)');
assert(d.getElementById('userCardsWrap').textContent.includes('Sem dados'), 'sem dados nenhum: os cartões continuam dizendo "Sem dados"');

// ---------------------------------------------------------------- 3) Território COM pedidos, em qualquer grafia
const DADOS_TERR = BASE.concat([
  ped({ numero_pedido: 'T1', usuario: 'Caio', etapa: 'TERRITORIO (NEOCRM)', valor: 200, atualizacao: '2026-09-18T10:00:00-03:00' }),
  ped({ numero_pedido: 'T2', usuario: 'Giovanna', etapa: 'Território (NEOCRM)', valor: 40, atualizacao: '2026-09-18T10:00:00-03:00' }),
]);
w = montarDashboard({ data: JSON.parse(JSON.stringify(DADOS_TERR)) });
d = w.document;
const terrCom = [...d.querySelectorAll('#etapaTotalBody tr.etapa-total-row')].filter(tr => /TERRIT/i.test(tr.textContent));
assert(terrCom.length === 1, 'as duas grafias viram UMA só linha de Território — achou ' + terrCom.length);
assert(terrCom[0] && /R\$\s?240,00/.test(terrCom[0].textContent) && terrCom[0].cells[1].textContent.trim() === '2', 'Território soma as duas grafias: 2 linhas, R$ 240,00 — ' + (terrCom[0] && terrCom[0].textContent.replace(/\s+/g, ' ')));
const barraCom = d.querySelector('#userCardsWrap .user-card .uc-row[data-etapa*="TERRIT"] .uc-bar-fill');
assert(barraCom && parseFloat(barraCom.style.width) > 0, 'com valor, a barra do Território aparece no cartão');
const dadosAlerta = JSON.parse(JSON.stringify(DADOS_TERR)); w.canonizarEtapas(dadosAlerta);
const alertas = w.montarPedidosEmAlerta(dadosAlerta, '2026-09-28').filter(p => /TERRIT/i.test(p.etapa)).map(p => p.numero_pedido + ':' + p.nivel);
assert(alertas.length === 2, 'pedidos parados em Território entram em Pedidos em Alerta — ' + JSON.stringify(alertas));
assert(alertas.every(a => a.endsWith(':medio')), 'Território parado há 6 dias úteis = nível médio (mesmas faixas das outras etapas) — ' + JSON.stringify(alertas));

// ---------------------------------------------------------------- 4) atualização automática (a cada 1h) também reconhece o Território
w.atualizarDadosDashboard(BASE.concat([ped({ numero_pedido: 'T9', etapa: 'TERRITORIO (NEOCRM)', valor: 10 })]), '30/09/2026, 21:00:00');
assert([...w.document.querySelectorAll('#etapaTotalBody tr.etapa-total-row')].filter(tr => /TERRIT/i.test(tr.textContent)).length === 1, 'depois da atualização automática continua uma só linha de Território');
assert(/R\$\s?10,00/.test([...w.document.querySelectorAll('#etapaTotalBody tr.etapa-total-row')].find(tr => /TERRIT/i.test(tr.textContent)).textContent), 'a atualização automática traz o valor novo do Território');

// ---------------------------------------------------------------- 5) layout: a barra não passa mais por cima do nome e do valor
d = montarDashboard({ data: BASE }).document;
const css = [...d.querySelectorAll('style')].map(s => s.textContent).join('\n');
const finalCss = css.slice(css.indexOf('Ajustes de layout (30/09/2026)'));
assert(finalCss.length > 100, 'bloco de ajustes de layout presente no fim do CSS (vence as regras antigas)');
assert(/\.uc-bar-track\{grid-column:1 \/ -1;margin:0;/.test(finalCss), 'a barra fica em linha própria, sem margem negativa');
assert(/\.uc-row\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;/.test(finalCss) && /row-gap:6px/.test(finalCss), 'a linha tem espaço entre o texto e a barra');
assert(!/margin:-\d/.test(finalCss), 'nenhuma margem negativa nos ajustes novos');
const linhaUc = d.querySelector('.uc-row');
const filhos = [...linhaUc.children].map(c => c.className.split(' ')[0]);
assert(filhos.join(',') === 'uc-label,uc-value,uc-bar-track', 'ordem dos elementos da linha: nome, valor, barra (a barra ocupa a 2ª linha da grade) — ' + filhos.join(','));
const estilo = d.defaultView.getComputedStyle(d.querySelector('.uc-bar-track'));
assert(estilo.marginTop === '0px', 'margem superior da barra = 0 (antes era -3px e cobria o texto) — veio ' + estilo.marginTop);
assert(/\.comp-row\{grid-template-columns:minmax\(120px,190px\) minmax\(0,1fr\) minmax\(112px,auto\)/.test(finalCss), 'composição por vendedor: colunas que acomodam nome e valor');

// ---------------------------------------------------------------- 6) fonte arredondada nos números + cards centralizados
assert(tplRaw.includes('family=Nunito:wght@600;700;800'), 'a fonte Nunito (arredondada) é carregada');
assert(/:root\{--font-num:'Nunito'/.test(finalCss), 'variável --font-num com a fonte arredondada');
assert(/\.card \.value,\.uc-total,\.uc-value/.test(finalCss) && /font-family:var\(--font-num\)/.test(finalCss), 'valores dos cartões, totais e barras usam a fonte arredondada');
assert(/#etapaTotalTable td:not\(:first-child\)/.test(finalCss) && /#lossReasonTable td:not\(:first-child\)/.test(finalCss), 'colunas numéricas das tabelas usam a fonte arredondada');
assert(/#tabOverview \.user-cards\{grid-template-columns:repeat\(auto-fit,minmax\(310px,390px\)\);justify-content:center;\}/.test(finalCss), 'cartões por vendedor centralizados');
assert(/#tabOverview \.cards\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);\}/.test(finalCss), 'os 4 cartões de resumo ficam SEMPRE numa linha (4 colunas iguais)');
assert(/#tabOverview \.cards \.value\{font-size:clamp\(15px,2vw,24px\);\}/.test(finalCss), 'a fonte dos cartões de resumo diminui em tela estreita para caberem os 4 numa linha');
assert(/@media \(max-width:560px\)\{ #tabOverview \.cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\} \}/.test(finalCss), 'só em celular bem estreito os cartões passam a 2 por linha');
assert(/\.layout\{grid-template-columns:1fr;\}/.test(finalCss), 'a página tem coluna única (some a coluna vazia da esquerda)');
assert(/\.layout > \.panel\{display:flex;flex-wrap:wrap;/.test(finalCss) && /\.layout > \.panel \.filter-group\{margin:0;flex:1 1 150px;/.test(finalCss), 'os filtros viram uma faixa horizontal no topo');
assert(/body:not\(\.tab-diaria\):not\(\.tab-alertas\):not\(\.tv-mode\) \.layout\{max-width:1240px;margin-left:auto;margin-right:auto;\}/.test(finalCss), 'o conteúdo (filtros e cartões) fica num bloco central; Visão Diária, Alertas e Modo TV não mudam');
assert(/#tabOverview \.diag-cards\{[^}]*justify-content:center;/.test(finalCss) && /#tabOverview \.insights\{[^}]*margin-left:auto;margin-right:auto;/.test(finalCss), 'diagnóstico e insights centralizados');
assert(/#tabOverview\{max-width:1240px;margin-left:auto;margin-right:auto;\}/.test(finalCss), 'o conteúdo da Visão Geral fica num bloco central com margens iguais');
assert(!/body\.tab-diaria/.test(finalCss), 'os ajustes de centralização não mexem na Visão Diária (só #tabOverview)');

console.log('--- test_dashboard_ajustes RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
process.exit(fail > 0 ? 1 : 0);
