// Testa a aba Vendas Perdidas (05/10/2026) — REGRAS_NEGOCIO.md §70.
// Spec: docs/superpowers/specs/2026-10-05-vendas-perdidas-categorias-design.md
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público (nada de telefone, nome ou CNPJ real).
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

window.__rpcCalls = [];
window.__rpcRespostas = {};
window.__tabelas = {};
window.__escritas = [];
window.__lidas = [];
window.__alertas = [];
function builder(tabela){
  const linhasFiltradas = () => { const f = b.__eq || {}; return (window.__tabelas[tabela] || []).filter(l => Object.keys(f).every(c => l[c] === undefined || l[c] === f[c])); };
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b,
    eq: (c, v) => { b.__eq = Object.assign(b.__eq || {}, { [c]: v }); return b; },
    upsert: (rows, opts) => { window.__escritas.push({ tabela, op: 'upsert', rows, opts }); return Promise.resolve({ error: null }); },
    insert: (rows) => { window.__escritas.push({ tabela, op: 'insert', rows }); return Promise.resolve({ error: null }); },
    update: (patch) => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'update', patch, filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    delete: () => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'delete', filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    maybeSingle: async () => ({ data: linhasFiltradas()[0] || null, error: null }),
    then: (resolve) => resolve({ data: linhasFiltradas(), error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => { window.__lidas.push(t); return builder(t); },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.alert = (m) => window.__alertas.push(String(m));
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
  const V = (np, extra) => Object.assign({ numero_pedido: np, usuario: 'CONSULTOR A', profile_id: 'p-a', cliente: 'Cliente Teste', produtos: 'Produto Teste', valor: 100, perdido_em: '2026-10-03T15:00:00Z', categoria: 'Não responde', subcategoria: null, tags: [], tag_pedido: null }, extra || {});

  // ==== TASK 4: funções puras ====
  eq(vpPeriodo('mes', '2026-10-05'), { de: '2026-10-01', ate: '2026-10-05' }, 'este mês');
  eq(vpPeriodo('mespassado', '2026-10-05'), { de: '2026-09-01', ate: '2026-09-30' }, 'mês passado (30 dias)');
  eq(vpPeriodo('mespassado', '2026-01-15'), { de: '2025-12-01', ate: '2025-12-31' }, 'mês passado em janeiro');
  eq(vpPeriodo('mespassado', '2026-03-10'), { de: '2026-02-01', ate: '2026-02-28' }, 'mês passado fevereiro');
  eq(vpPeriodo('90d', '2026-10-05'), { de: '2026-07-08', ate: '2026-10-05' }, 'últimos 90 dias (contando hoje)');
  eq(vpPeriodo('custom', '2026-10-05', '2026-09-10', '2026-09-20'), { de: '2026-09-10', ate: '2026-09-20' }, 'personalizado');
  eq(vpPeriodo('custom', '2026-10-05', '', ''), { de: '2026-10-05', ate: '2026-10-05' }, 'personalizado vazio = hoje');

  eq(vpCategoria(V('1', { categoria: null })), 'Sem categoria', 'categoria null');
  eq(vpCategoria(V('1', { categoria: '  ' })), 'Sem categoria', 'categoria em branco');
  eq(vpCategoria(V('1')), 'Não responde', 'categoria preenchida');

  const linhas = [
    V('1'), V('2', { valor: 50 }), V('3', { categoria: 'Restrição de Crédito', valor: 300 }),
    V('4', { categoria: null, usuario: 'CONSULTOR B', profile_id: 'p-b' }), V('5', { categoria: null, usuario: 'CONSULTOR B', profile_id: 'p-b', valor: '20' }),
    V('6', { categoria: 'Desconfiança', usuario: 'CONSULTOR B', profile_id: 'p-b' }),
  ];
  const mot = vpMotivos(linhas);
  eq(mot.map(m => m.motivo), ['Não responde', 'Desconfiança', 'Restrição de Crédito', 'Sem categoria'], 'motivos: mais pedidos primeiro, empate alfabético, Sem categoria por último');
  eq([mot[0].pedidos, mot[0].valor], [2, 150], 'Não responde: 2 pedidos, R$ 150');
  eq(mot[3].valor, 120, 'valor em texto somado');
  assert(Math.abs(mot.reduce((s, m) => s + m.pct, 0) - 1) < 1e-9, 'percentuais somam 100%');

  const k = vpKpis(linhas);
  eq([k.total, k.valor], [6, 670], 'KPIs: 6 pedidos, R$ 670');
  eq(k.pctComCategoria, 4 / 6, '% com categoria');
  eq([k.maiorMotivo, k.maiorMotivoPct], ['Não responde', 2 / 4], 'maior motivo entre os com categoria');
  eq(vpKpis([]), { total: 0, valor: 0, pctComCategoria: null, maiorMotivo: null, maiorMotivoPct: null }, 'KPIs vazios');

  const cons = vpConsultores(linhas);
  eq(cons.map(c => [c.usuario, c.perdas, c.comCategoria]), [['CONSULTOR B', 3, 1], ['CONSULTOR A', 3, 3]], 'preenchimento: pior primeiro');
  eq(cons[0].maiorMotivo, 'Desconfiança', 'maior motivo do consultor');
  eq([vpNivelPreenchimento(0.9), vpNivelPreenchimento(0.89), vpNivelPreenchimento(0.5), vpNivelPreenchimento(0.49)], ['ok', 'medio', 'medio', 'maximo'], 'selos de preenchimento');

  eq(vpFiltrar(linhas, 'CONSULTOR B', '').length, 3, 'filtro consultor');
  eq(vpFiltrar(linhas, '', 'Sem categoria').map(l => l.numero_pedido), ['4', '5'], 'filtro Sem categoria');
  eq(vpFiltrar(linhas, 'CONSULTOR B', 'Desconfiança').map(l => l.numero_pedido), ['6'], 'filtros combinados');
  const linhasSemConsultor = linhas.concat([V('7', { usuario: null })]);
  eq(vpFiltrar(linhasSemConsultor, '(sem consultor)', '').map(l => l.numero_pedido), ['7'], 'filtro "(sem consultor)" pega usuario null');

  const agoraT = Date.parse('2026-10-05T15:00:00Z');
  assert(vpSyncAtrasada(null, agoraT), 'nunca sincronizou = atrasada');
  assert(!vpSyncAtrasada({ ok_em: '2026-10-05T13:00:00Z' }, agoraT), '2 h atrás = em dia');
  assert(vpSyncAtrasada({ ok_em: '2026-10-05T11:30:00Z' }, agoraT), '3h30 atrás = atrasada');

  // ==== TASK 5: aba ====
  const nowReal = Date.now;
  Date.now = () => Date.parse('2026-10-05T15:00:00Z');
  window.__rpcRespostas.vendas_perdidas = { data: linhas, error: null };
  window.__tabelas.exportacao_sync_log = [{ ok: true, terminou_em: '2026-10-05T14:41:30Z' }];
  window.__xlsx = [];
  window.XLSX.writeFile = (wb, nome) => window.__xlsx.push({ wb, nome });

  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  vpAplicarPermissao();
  assert(document.getElementById('tabBtnVendasPerdidas').style.display === 'none', 'consultor não vê o botão');
  window.__rpcCalls.length = 0;
  await loadVendasPerdidas();
  assert(!window.__rpcCalls.some(c => c.nome === 'vendas_perdidas'), 'consultor não chama a RPC');

  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  vpAplicarPermissao();
  assert(document.getElementById('tabBtnVendasPerdidas').style.display !== 'none', 'supervisor vê o botão');
  document.querySelector('#tabsNav button[data-tab="vendasperdidas"]').click();
  await espera(60);
  assert(document.getElementById('panel-vendasperdidas').classList.contains('active'), 'clique abre a aba');
  eq((window.__rpcCalls.filter(c => c.nome === 'vendas_perdidas').pop() || {}).args, { p_de: '2026-10-01', p_ate: '2026-10-05' }, 'período padrão: este mês (SP)');
  const kt = document.getElementById('vpKpis').textContent;
  assert(kt.includes('6') && kt.includes('R$') && kt.includes('66,7%') && kt.includes('Não responde'), 'KPIs na tela: ' + kt);
  eq([...document.querySelectorAll('#vpMotivosTbody tr[data-vp-motivo]')].map(t => t.dataset.vpMotivo), ['Não responde', 'Desconfiança', 'Restrição de Crédito', 'Sem categoria'], 'tabela de motivos na ordem');
  eq([...document.querySelectorAll('#vpConsultoresTbody tr[data-vp-consultor]')].map(t => t.dataset.vpConsultor), ['CONSULTOR B', 'CONSULTOR A'], 'preenchimento: pior primeiro');
  assert(document.querySelector('#vpConsultoresTbody tr[data-vp-consultor="CONSULTOR B"] .ppNivel.maximo'), 'selo vermelho para 33%');
  assert(document.querySelector('#vpConsultoresTbody tr[data-vp-consultor="CONSULTOR A"] .ppNivel.ok'), 'selo verde para 100%');
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 6, '6 pedidos na lista');
  assert(document.getElementById('vpAvisoSync').style.display === 'none', 'sync em dia: sem aviso');
  assert(!/NaN|undefined/.test(document.getElementById('panel-vendasperdidas').textContent), 'nada de NaN/undefined');

  // clique no motivo filtra a lista; clicar de novo limpa
  document.querySelector('#vpMotivosTbody tr[data-vp-motivo="Sem categoria"]').click();
  await espera(20);
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 2, 'filtro por motivo (Sem categoria)');
  assert(document.getElementById('vpFiltroCategoria').value === 'Sem categoria', 'select acompanha o clique');
  document.querySelector('#vpMotivosTbody tr[data-vp-motivo="Sem categoria"]').click();
  await espera(20);
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 6, 'clicar de novo limpa');
  // clique no consultor filtra
  document.querySelector('#vpConsultoresTbody tr[data-vp-consultor="CONSULTOR B"]').click();
  await espera(20);
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 3, 'filtro por consultor');
  assert(document.getElementById('vpKpis').textContent.includes('3'), 'KPIs acompanham o filtro');
  document.getElementById('vpFiltroConsultor').value = '';
  document.getElementById('vpFiltroConsultor').dispatchEvent(new window.Event('change'));
  await espera(20);
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 6, 'select limpa o filtro');

  // período mês passado recarrega com as datas certas
  document.querySelector('#vpPeriodoPills [data-vp-periodo="mespassado"]').click();
  await espera(40);
  eq(window.__rpcCalls.filter(c => c.nome === 'vendas_perdidas').pop().args, { p_de: '2026-09-01', p_ate: '2026-09-30' }, 'mês passado');
  document.querySelector('#vpPeriodoPills [data-vp-periodo="mes"]').click();
  await espera(40);

  // Excel
  document.getElementById('btnVpExportar').click();
  await espera(20);
  const x = window.__xlsx.pop();
  assert(x && x.nome === 'VendasPerdidas_2026-10-01_2026-10-05.xlsx', 'nome do Excel');
  eq(x.wb.SheetNames, ['Motivos', 'Preenchimento', 'Pedidos'], 'abas do Excel');

  // aviso de sync atrasada e erro de carga
  window.__tabelas.exportacao_sync_log = [{ ok: true, terminou_em: '2026-10-05T10:00:00Z' }];
  await loadVendasPerdidas();
  assert(document.getElementById('vpAvisoSync').style.display !== 'none' && document.getElementById('vpAvisoSync').textContent.includes('05/10'), 'aviso de sync atrasada com a data');
  window.__tabelas.exportacao_sync_log = [];
  await loadVendasPerdidas();
  assert(document.getElementById('vpAvisoSync').textContent.includes('ainda não sincronizaram'), 'aviso de nunca sincronizou');
  window.__rpcRespostas.vendas_perdidas = { data: null, error: { message: 'x' } };
  await loadVendasPerdidas();
  assert(document.getElementById('vpMotivosTbody').textContent.includes('Não foi possível carregar'), 'erro de carga');
  window.__rpcRespostas.vendas_perdidas = { data: linhas, error: null };

  // troca para consultor limpa
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  vpAplicarPermissao();
  assert(document.getElementById('vpPedidosTbody').innerHTML === '' && document.getElementById('vpKpis').innerHTML === '', 'troca para consultor limpa a aba');
  Date.now = nowReal;

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
