// Testa a matriz "Vendas Diárias por Vendedor" (aba Cadastro Diário do Dashboard de Produção) com TODOS os
// consultores da Apex, inclusive quem não vendeu no mês (01/10/2026, REGRAS_NEGOCIO.md seção 66).
// Mesma técnica de test_dashboard_ajustes.js: decodifica o template embutido, preenche com dados FICTÍCIOS e roda num jsdom.
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

assert(jsOriginal.includes('__EQUIPE__'), 'o template recebe a lista da equipe (__EQUIPE__)');

function montar(data, equipe){
  const html = htmlNoScript.replace('__ADMIN_BADGE__', '').replace('__APEX_B64__', '').replace('__CLARO_B64__', '').replace('__UPDATED_AT__', '01/10/2026, 20:00:00');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true;
  w.eval(jsOriginal.replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(data) + ';')
    .replace('__ADMIN_MODE__', 'true').replace('__EQUIPE__', JSON.stringify(equipe)));
  return w;
}
const ped = o => Object.assign({ numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'CAIO TESTE', etapa: 'ENTREGA (NEOCRM)',
  cadastro: '2026-10-01T10:00:00-03:00', atualizacao: '2026-10-01T10:00:00-03:00', valor: 100, quantidade: 1, produto: 'X', tag: null }, o);
const DADOS = [ped({ numero_pedido: 'A1' }), ped({ numero_pedido: 'A2' }), ped({ numero_pedido: 'B1', usuario: 'MARIA TESTE' }),
  ped({ numero_pedido: 'S1', usuario: 'ZE SETEMBRO', cadastro: '2026-09-10T10:00:00-03:00', atualizacao: '2026-09-10T10:00:00-03:00' })];
const EQUIPE = ['CAIO TESTE', 'MARIA TESTE', 'ANA ZERADA', 'BRUNO ZERADO'];
const linhas = w => [...w.document.querySelectorAll('#vendorMatrixWrap tbody tr')].map(tr => tr.children[0].textContent.trim());

let w = montar(DADOS, EQUIPE);
w.renderVendorDailyMatrix();
const l1 = linhas(w);
assert(l1.includes('ANA ZERADA') && l1.includes('BRUNO ZERADO'), 'consultores da equipe sem venda no mês aparecem (com zero) — ' + JSON.stringify(l1));
assert(l1.indexOf('CAIO TESTE') < l1.indexOf('MARIA TESTE') && l1.indexOf('MARIA TESTE') < l1.indexOf('ANA ZERADA'), 'ordem: mais vendas primeiro, zerados por último');
assert(l1.indexOf('ANA ZERADA') < l1.indexOf('BRUNO ZERADO'), 'zerados em ordem alfabética');
const totalAna = [...w.document.querySelectorAll('#vendorMatrixWrap tbody tr')].find(tr => tr.children[0].textContent.trim() === 'ANA ZERADA');
assert(totalAna && totalAna.lastElementChild.textContent.trim() === '0', 'linha do zerado tem total 0');
assert(!l1.includes('ZE SETEMBRO'), 'quem só vendeu em outro mês e não é da equipe não entra no mês');
const linhaTotal = [...w.document.querySelectorAll('#vendorMatrixWrap tr')].find(tr => /^TOTAL$/i.test(tr.children[0].textContent.trim()));
assert(linhaTotal && linhaTotal.lastElementChild.textContent.trim() === '3', 'total geral continua 3 (zerados não somam)');

// vendedor fora da equipe com venda no mês continua aparecendo
w = montar(DADOS.concat([ped({ numero_pedido: 'X1', usuario: 'FORA DA LISTA' })]), EQUIPE);
w.renderVendorDailyMatrix();
assert(linhas(w).includes('FORA DA LISTA'), 'quem vendeu no mês aparece mesmo fora da lista da equipe');

// filtro de vendedor ativo: só os marcados (a equipe não "fura" o filtro)
w = montar(DADOS, EQUIPE);
const boxes = [...w.document.querySelectorAll('.filter-usuario')];
assert(boxes.length >= 2, 'filtro de vendedor existe');
boxes.forEach(b => { b.checked = b.value === 'CAIO TESTE'; });
w.applyFilters();
w.renderVendorDailyMatrix();
assert(JSON.stringify(linhas(w)) === JSON.stringify(['CAIO TESTE']), 'com filtro de vendedor, só aparece quem está marcado — ' + JSON.stringify(linhas(w)));

// sem lista da equipe (painel antigo / erro ao buscar): comportamento antigo
w = montar(DADOS, []);
w.renderVendorDailyMatrix();
assert(JSON.stringify(linhas(w)) === JSON.stringify(['CAIO TESTE', 'MARIA TESTE']), 'lista vazia: só quem vendeu no mês, como antes');

// o painel busca a lista no banco e preenche o template
const fnLoad = outerHtml.slice(outerHtml.indexOf('async function loadProducaoDashboard'), outerHtml.indexOf('async function loadProducaoDashboard') + 4000);
assert(fnLoad.includes("sb.rpc('equipe_vendedores')"), 'o painel busca a equipe (rpc equipe_vendedores)');
assert(/tpl\.replace\('__EQUIPE__'/.test(fnLoad), 'o painel preenche __EQUIPE__ no template');

console.log('--- test_cadastro_diario_equipe RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
process.exit(fail > 0 ? 1 : 0);
