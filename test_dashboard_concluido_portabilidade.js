// Dashboard de Produção — regra do CONCLUÍDO igual à do Fechamento (REGRAS_NEGOCIO.md seção 113, 26/10/2026):
// qualquer grupo, mas só conta com data de ativação dentro do período (Portabilidade; Banda Larga cai na Data de instalação).
// As demais etapas continuam pelo campo Cadastro/Atualização. Mesma técnica de test_dashboard_ajustes.js (dados fictícios).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const outerHtml = fs.readFileSync('_template.html', 'utf8');
const m = outerHtml.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/);
if(!m){ console.error('PRODUCAO_DASHBOARD_TPL_B64 nao encontrado'); process.exit(1); }
const tplRaw = Buffer.from(m[1], 'base64').toString('utf8');
const htmlNoScript = tplRaw.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsOriginal = tplRaw.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

function montar(data){
  const html = htmlNoScript.replace('__ADMIN_BADGE__', '').replace('__APEX_B64__', '').replace('__CLARO_B64__', '').replace('__UPDATED_AT__', '26/10/2026');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true;
  w.eval(jsOriginal.replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(data) + ';').replace('__ADMIN_MODE__', 'true')
    + '\n;window.__t = { set(a, b){ dateRangeStart = a; dateRangeEnd = b; }, apply: applyFilters, cur: () => CURRENT_FILTERED.map(r => r.numero_pedido).sort() };');
  return w;
}
const C = 'CONCLUIDO (NEOCRM)';
function ped(over){ return Object.assign({
  numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'Caio', etapa: C,
  cadastro: '2026-08-28T03:00:00+00:00', atualizacao: '2026-10-22T18:43:21+00:00', data_portabilidade: '2026-10-15T03:00:00+00:00',
  valor: 100, quantidade: 1, produto: 'Plano Teste', cliente: 'EMPRESA FICTICIA LTDA', cnpj: '11111111000100', tag: null,
}, over); }

const DATA = [
  ped({ numero_pedido: 'OK1' }),                                                                  // novo, portabilidade em outubro
  ped({ numero_pedido: 'OK2', grupo: 'VOZ - Portabilidade', data_portabilidade: '2026-10-26T03:00:00+00:00' }),
  ped({ numero_pedido: 'OK3', grupo: 'VOZ - Tranf. Titularidade', data_portabilidade: '2026-10-01T03:00:00+00:00' }),
  ped({ numero_pedido: 'SEMDATA', data_portabilidade: null }),                                    // concluído sem data de portabilidade
  ped({ numero_pedido: 'SETEMBRO', data_portabilidade: '2026-09-30T03:00:00+00:00' }),            // ativado em setembro (atualizado em outubro)
  ped({ numero_pedido: 'RENOV', grupo: 'VOZ - Renovação' }),                                      // qualquer grupo vale, desde que tenha a data
  ped({ numero_pedido: 'SVA', grupo: 'SVA MÓVEL', data_portabilidade: null }),                    // SVA sem data de portabilidade: fora
  ped({ numero_pedido: 'BL', grupo: 'BANDA LARGA - Novo', data_portabilidade: null, data_instalacao: '2026-10-20T03:00:00+00:00' }), // fibra: usa a instalação
  ped({ numero_pedido: 'BLSEM', grupo: 'BANDA LARGA - Novo', data_portabilidade: null, data_instalacao: null }), // fibra sem nenhuma data: fora
  ped({ numero_pedido: 'ENTREGA', etapa: 'ENTREGA (NEOCRM)', data_portabilidade: null }),         // outra etapa: segue Atualização
  ped({ numero_pedido: 'ANDAMENTO', etapa: 'BIOMETRIA (NEOCRM)', data_portabilidade: null, atualizacao: '2026-09-10T12:00:00+00:00' }), // fora do período
];

function filtrar(w, de, ate, campo){
  w.eval('document.querySelector("input[name=dateField][value=' + campo + ']").checked = true;');
  w.__t.set(de, ate); w.__t.apply();
  return w.__t.cur();
}

const w = montar(DATA);
// por padrão o Dashboard abre com Aparelho, Renovação e Banda Larga desmarcados no filtro de grupo; ao marcar, o Concluído deles entra pela data de ativação
let ids = filtrar(w, '2026-10-01', '2026-10-26', 'atualizacao');
assert(!ids.includes('RENOV') && !ids.includes('BL'), 'com o filtro de grupo padrão, Renovação e Banda Larga seguem desmarcados — achou ' + ids);
w.document.querySelectorAll('.filter-grupo').forEach(c => { c.checked = true; });
ids = filtrar(w, '2026-10-01', '2026-10-26', 'atualizacao');
assert(['OK1', 'OK2', 'OK3', 'RENOV'].every(i => ids.includes(i)), 'Concluídos de qualquer grupo com portabilidade em outubro entram — achou ' + ids);
assert(!ids.includes('SEMDATA'), 'Concluído sem data de portabilidade NÃO entra');
assert(!ids.includes('SETEMBRO'), 'Concluído ativado em setembro NÃO entra no período de outubro, mesmo atualizado em outubro');
assert(!ids.includes('SVA') && !ids.includes('BLSEM'), 'Concluído sem nenhuma data de ativação (SVA, fibra) NÃO entra');
assert(ids.includes('BL'), 'banda larga sem portabilidade usa a data de instalação (igual ao Fechamento)');
assert(ids.includes('ENTREGA'), 'Entrega continua pelo campo Atualização (outra visão)');
assert(!ids.includes('ANDAMENTO'), 'outras etapas fora do período seguem excluídas');

// o campo escolhido (Cadastro) não muda o critério do Concluído: continua a data de portabilidade
ids = filtrar(w, '2026-10-01', '2026-10-26', 'cadastro');
assert(ids.includes('OK1') && ids.includes('OK2') && ids.includes('OK3'), 'com Cadastro marcado, Concluído continua pela data de portabilidade — achou ' + ids);
assert(!ids.includes('SETEMBRO') && !ids.includes('SEMDATA'), 'com Cadastro marcado, setembro/sem data seguem fora');

// período só de setembro: o ativado em 30/09 aparece, os de outubro não
ids = filtrar(w, '2026-09-01', '2026-09-30', 'atualizacao');
assert(ids.includes('SETEMBRO') && !ids.includes('OK1'), 'período de setembro pega só a portabilidade de setembro — achou ' + ids);

console.log('--- RESULTADO: ' + ok + ' passaram, ' + fail + ' falharam ---');
process.exit(fail ? 1 : 0);
