// Conferência da aba "Pedidos em Alerta" contra a planilha REAL do NeoCRM (28/09/2026). A planilha
// fica fora do git (dados de clientes; ExportacaoProducao*.xlsx está no .gitignore) — sem ela o
// teste imprime PULADO. Os números esperados foram calculados de forma independente (Python) durante
// o design, com referência 28/09/2026: 61 pedidos em alerta (21 mínimo, 6 médio, 34 máximo).
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const XLSX = require('xlsx');
const { exigirArquivo } = require('./test_helper_mock.js');

const ARQ = process.env.PEDIDOS_ALERTA_XLSX || 'ExportacaoProducao_alerta.xlsx';
if(!exigirArquivo(ARQ, 'test_pedidos_alerta_planilha.js')) process.exit(0);

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// 1) extração com o MESMO código do upload do painel (lido do _template.html, não reimplementado)
const outer = fs.readFileSync('_template.html', 'utf8');
function extrairFuncao(src, nome){
  const i = src.indexOf('function ' + nome + '(');
  if(i < 0) throw new Error('função não encontrada no _template.html: ' + nome);
  let nivel = 0;
  for(let k = src.indexOf('{', i); k < src.length; k++){
    if(src[k] === '{') nivel++;
    else if(src[k] === '}'){ nivel--; if(nivel === 0) return src.slice(i, k + 1); }
  }
  throw new Error('fim da função não encontrado: ' + nome);
}
const ctx = { XLSX };
vm.createContext(ctx);
vm.runInContext("const FUSO_SAO_PAULO = '-03:00';\n"
  + ['parseDataProducao', 'normalizarHeaderProducao', 'extractProducaoRecords'].map(n => extrairFuncao(outer, n)).join('\n')
  + '\nthis.extractProducaoRecords = extractProducaoRecords;', ctx);

const wb = XLSX.readFile(ARQ);
const aba = wb.SheetNames.find(n => ['exportacao', 'exportação'].includes(n.trim().toLowerCase()));
assert(!!aba, 'planilha tem a aba Exportacao');
const ws = wb.Sheets[aba];
const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
if(range && range.s.r > 0) range.s.r = 0; // mesmo contorno do upload (REGRAS_NEGOCIO.md 16.1)
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, range: range || undefined });
const records = JSON.parse(JSON.stringify(ctx.extractProducaoRecords(rows)));
assert(records.length > 0, 'extração produziu registros (' + records.length + ')');

// 2) dashboard embutido real com esses registros, referência = base de 28/09/2026
const m = outer.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/);
const tpl = Buffer.from(m[1], 'base64').toString('utf8');
const js = tpl.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]
  .replace('let DATA = __DATA__;', 'let DATA = [];')
  .replace('__ADMIN_MODE__', 'true');
const dom = new JSDOM(tpl.replace(/<script>[\s\S]*?<\/script>/g, '').replace('__UPDATED_AT__', '28/09/2026, 20:12:03')
  .replace('__ADMIN_BADGE__', '').replace('__APEX_B64__', '').replace('__CLARO_B64__', ''), { runScripts: 'outside-only', url: 'http://localhost/' });
dom.window.alert = () => {};
dom.window.eval(js);

const lista = dom.window.montarPedidosEmAlerta(records, '2026-09-28');
const res = dom.window.resumirAlertas(lista);
const t = res.total;
assert(t.total === 61 && t.minimo === 21 && t.medio === 6 && t.maximo === 34, 'total 61 (21/6/34) — obtido ' + JSON.stringify(t));
const esperado = {
  'ENTREGA (NEOCRM)': [15, 3, 14],
  'ANTIFRAUDE (NEOCRM)': [5, 1, 2],
  'PORTABILIDADE EM ANDAMENTO (NEOCRM)': [0, 0, 10],
  'PORTABILIDADE EM TRATATIVA (NEOCRM)': [1, 2, 8],
};
Object.keys(esperado).forEach(e => {
  const r = res.porEtapa[e];
  const obtido = [r.minimo, r.medio, r.maximo];
  assert(JSON.stringify(obtido) === JSON.stringify(esperado[e]), e + ' mín/méd/máx ' + JSON.stringify(esperado[e]) + ' — obtido ' + JSON.stringify(obtido));
});

console.log('--- test_pedidos_alerta_planilha RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
if(fail > 0) process.exitCode = 1;
