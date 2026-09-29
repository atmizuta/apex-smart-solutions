// Testa a aba "Pedidos em Alerta" do Dashboard de Produção (28/09/2026, REGRAS_NEGOCIO.md seção 46).
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

console.log('--- test_pedidos_alerta RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
if(fail > 0) process.exitCode = 1;
