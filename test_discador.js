// Testa a aba Discador (15/10/2026) — REGRAS_NEGOCIO.md §87.
// Spec: docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md
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
window.__rpcAtraso = {};
window.__tabelas = {};
window.__avisos = [];
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b, eq: () => b, not: () => b,
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    const atraso = window.__rpcAtraso[nome] || 0;
    const p = new Promise(ok => setTimeout(() => ok(res), atraso));
    return { range: () => p, then: (ok, ko) => p.then(ok, ko) };
  },
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

  // ==== TASK 1: funções puras ====
  eq(dcPeriodo('hoje', '2026-10-15'), { de: '2026-10-15', ate: '2026-10-15' }, 'hoje');
  eq(dcPeriodo('ontem', '2026-10-01'), { de: '2026-09-30', ate: '2026-09-30' }, 'ontem atravessa o mês');
  eq(dcPeriodo('7dias', '2026-10-15'), { de: '2026-10-09', ate: '2026-10-15' }, '7 dias inclui hoje');
  eq(dcPeriodo('mes', '2026-10-15'), { de: '2026-10-01', ate: '2026-10-15' }, 'mês até hoje');
  eq(dcPeriodo('custom', '2026-10-15', '2026-09-01', '2026-10-10'), { de: '2026-09-01', ate: '2026-10-10' }, 'personalizado válido');
  eq(dcPeriodo('custom', '2026-10-15', '2026-10-10', '2026-10-01'), null, 'personalizado invertido');
  eq(dcPeriodo('custom', '2026-10-15', '2026-01-01', '2026-10-01'), null, 'personalizado acima de 120 dias');
  eq(dcPeriodo('custom', '2026-10-15', '2026-06-04', '2026-10-01'), { de: '2026-06-04', ate: '2026-10-01' }, '120 dias contando os dois extremos valem');
  eq(dcPeriodo('custom', '2026-10-15', '2026-06-03', '2026-10-01'), null, '121 dias contando os dois extremos: recusado');
  eq(dcPeriodo('custom', '2026-10-15', '', '2026-10-01'), null, 'personalizado vazio');
  eq(dcPeriodo('xyz', '2026-10-15'), { de: '2026-10-15', ate: '2026-10-15' }, 'chave desconhecida = hoje');

  eq(dcTaxa(1, 4), 0.25, 'taxa');
  eq(dcTaxa(3, 0), null, 'taxa com divisor 0');
  eq(dcFmtPct(0.30627), '30,6%', 'pct com 1 casa');
  eq(dcFmtPct(null), '—', 'pct nulo');
  eq(dcFmtNum(139925), '139.925', 'milhar pt-BR');
  eq(dcFmtNum(null), '0', 'número nulo');
  eq(dcFmtSeg(48), '48 s', 'segundos');
  eq(dcFmtSeg(125), '2 min 05 s', 'minutos');
  eq(dcFmtSeg(null), '—', 'segundos nulos');
  eq(dcDdMm('2026-10-05'), '05/10', 'dd/mm');

  const ph = [
    { hora: 13, contato: 40, abandonadas: 4 },
    { hora: 14, contato: 50, abandonadas: 10 },
    { hora: 15, contato: 8, abandonadas: 6 },
  ];
  eq(dcAlertaAbandono(ph, 15, 0.15), { hora: 14, taxa: 0.2, abandonadas: 10, contato: 50 }, 'às 15h olha 14h: 20% > 15%');
  eq(dcAlertaAbandono(ph, 14, 0.15), null, 'às 14h olha 13h: 10% não alerta');
  eq(dcAlertaAbandono(ph, 16, 0.15), null, 'às 16h olha 15h: só 8 contatos, sem alerta');
  eq(dcAlertaAbandono(ph, 9, 0.15), null, 'hora sem linha');
  eq(dcAlertaAbandono(null, 15, 0.15), null, 'sem dados');

  const cons = [
    { atendidas: 100, sem_avanco: 50, sem_tabulacao: 2, vendas: 4 },
    { atendidas: 100, sem_avanco: 30, sem_tabulacao: 8, vendas: 0 },
    { atendidas: 5, sem_avanco: 5, sem_tabulacao: 5, vendas: 0 },
  ];
  const m = dcMediaEquipe(cons);
  eq([Math.round(m.semAvanco * 1000), Math.round(m.semTab * 1000), Math.round(m.conversao * 1000)], [415, 73, 20], 'média ponderada pelas atendidas');
  eq(dcMediaEquipe([]), { semAvanco: null, semTab: null, conversao: null, atPorHora: null, pausasPorHora: null, curtas: null }, 'equipe vazia');
  eq(dcPiorQueMedia(0.6, 0.4, true), true, 'sem avanço 50% acima: pior');
  eq(dcPiorQueMedia(0.5, 0.4, true), false, 'sem avanço 25% acima: normal');
  eq(dcPiorQueMedia(0.01, 0.02, false), true, 'conversão 50% abaixo: pior');
  eq(dcPiorQueMedia(0.5, null, true), false, 'sem média: nunca destaca');

  // ==== TASK 2: HTML dos blocos ====
  const R = { tentativas: 139925, contato: 8551, atendidas: 5932, abandonadas: 2619, sem_tabulacao: 47, seg_falados_medio: 48, vendas: 34, abandono_alerta: 0.15, ultima_sync: null };
  const k = dcKpisHtml(R);
  assert(k.includes('139.925') && k.includes('6,1%') && k.includes('30,6%') && k.includes('5.932') && k.includes('48 s') && k.includes('>34<'), 'cartões com números formatados');
  assert(k.includes('47 sem tabulação'), 'sub das atendidas');
  const k0 = dcKpisHtml({ tentativas: 0, contato: 0, atendidas: 0, abandonadas: 0, sem_tabulacao: 0, seg_falados_medio: null, vendas: 0 });
  assert(!k0.includes('NaN') && k0.includes('—'), 'período vazio: sem NaN, taxas com traço');
  assert(dcKpisHtml(null).includes('Não foi possível carregar'), 'resumo com erro');

  const horas = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(h => ({ hora: h, tentativas: h === 14 ? 2935 : 0, contato: h === 14 ? 137 : 0, atendidas: h === 14 ? 120 : 0, abandonadas: h === 14 ? 17 : 0, media_atendidas: h === 14 ? 101 : 0, media_abandonadas: h === 14 ? 31 : 0 }));
  const hh = dcHorasHtml(horas, true);
  assert((hh.match(/class="bmHora"/g) || []).length === 13, '13 colunas de hora');
  assert(hh.includes('14h') && hh.includes('12,4%'), 'hora 14 com % de abandono (17/137)');
  assert(hh.includes('dashed'), 'linha da média quando comMedia');
  assert(!dcHorasHtml(horas, false).includes('dashed'), 'sem média em período de vários dias');
  assert(dcHorasHtml(null, true).includes('Não foi possível carregar'), 'por hora com erro');

  const calor = [{ dia_semana: 1, hora: 14, tentativas: 1000, contato: 80 }, { dia_semana: 3, hora: 10, tentativas: 500, contato: 10 }];
  const ch = dcCalorHtml(calor);
  assert(ch.includes('bmCalor') && ch.includes('Seg') && ch.includes('Qua') && ch.includes('8,0%') && ch.includes('2,0%'), 'mapa de calor com taxa de contato');
  assert(dcCalorHtml([]).includes('Sem chamadas'), 'mapa vazio');

  const consultores = [
    { agente_id: 189, profile_id: null, nome: 'Agente 189', atendidas: 100, seg_falados_total: 4800, seg_falados_medio: 48, sem_avanco: 60, retornos: 5, ganhos: 1, sem_tabulacao: 1, vendas: 3 },
    { agente_id: 193, profile_id: 'p1', nome: 'Caio Teste', atendidas: 100, seg_falados_total: 6000, seg_falados_medio: 60, sem_avanco: 30, retornos: 2, ganhos: 2, sem_tabulacao: 9, vendas: 0 },
    { agente_id: 93, profile_id: null, nome: 'Agente 93', atendidas: 4, seg_falados_total: 12, seg_falados_medio: 3, sem_avanco: 4, retornos: 0, ganhos: 0, sem_tabulacao: 4, vendas: 0 },
  ];
  const ct = dcConsultoresHtml(consultores);
  assert(ct.includes('data-dc-agente="189"') && ct.includes('Caio Teste') && ct.includes('60,0%'), 'linha por agente, clicável');
  assert(/data-dc-agente="189"[^]*?dcPior[^]*?60,0%/.test(ct), 'agente 189: sem avanço 60% vs média ~44% → destacado');
  assert(/data-dc-agente="193"[^]*?dcPior[^]*?9,0%/.test(ct), 'agente 193: sem tabulação 9% vs média ~6,9% → destacado');
  assert(!ct.split('data-dc-agente="93"')[1].split('</tr>')[0].includes('dcPior'), 'agente 93 com 4 atendidas não é destacado');
  assert(dcConsultoresHtml([]).includes('Ninguém atendeu'), 'sem consultores');

  const ml = dcMailingHtml([{ chave: 'ZZ-CARGA <b>1</b>', tentativas: 45570, contato: 2524, atendidas: 1854, abandonadas: 670, ganhos: 5, vendas: 15 }], 'Carga');
  assert(ml.includes('ZZ-CARGA &lt;b&gt;1&lt;/b&gt;') && !ml.includes('<b>1</b>'), 'texto do banco escapado');
  assert(ml.includes('45.570') && ml.includes('5,5%') && ml.includes('26,5%') && ml.includes('0,33'), 'contato, abandono e vendas por mil');
  assert(dcMailingHtml([], 'Cidade').includes('Sem dados'), 'mailing vazio');

  assert(typeof dcDiasHtml === 'undefined', 'detalhe por dia antigo removido (virou o Raio-X)');

  const vh = dcVinculoHtml([{ agente_id: 189, atendidas_30d: 971, ultima_chamada: '2026-10-14T19:00:00Z' }], [{ id: 'p1', nome: 'Caio Teste', role: 'consultor' }, { id: 'p2', nome: 'Ana <Teste>', role: 'supervisor' }]);
  assert(vh.includes('1 agente sem consultor') && vh.includes('Agente 189') && vh.includes('971'), 'vínculo: lista');
  assert(vh.includes('data-dc-vinc="189"') && vh.includes('value="p1"') && vh.includes('Ana &lt;Teste&gt;'), 'vínculo: seletor com perfis escapados');
  eq(dcVinculoHtml([], []), '', 'sem pendências: nada');

  // ==== TASK 3: permissão, carga e eventos ====
  const respostasOk = () => {
    window.__rpcRespostas = {
      discador_resumo: { data: [Object.assign({}, R, { ultima_sync: new Date(Date.now() - 30 * 60000).toISOString() })], error: null },
      discador_por_hora: { data: horas, error: null },
      discador_mapa_calor: { data: calor, error: null },
      discador_consultores: { data: consultores, error: null },
      discador_mailing: (a) => ({ data: [{ chave: 'ZZ-' + a.p_dim, tentativas: 1000, contato: 60, atendidas: 40, abandonadas: 20, ganhos: 1, vendas: 2 }], error: null }),
      discador_agentes_sem_vinculo: { data: [{ agente_id: 189, atendidas_30d: 971, ultima_chamada: null }], error: null },
      discador_vincular_agente: { data: null, error: null },
    };
  };
  respostasOk();
  window.__tabelas.profiles = [{ id: 'p1', nome: 'Caio Teste', role: 'consultor' }];

  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  dcAplicarPermissao();
  assert(document.getElementById('tabBtnDiscador').style.display === 'none', 'consultor não vê o botão');
  window.__rpcCalls.length = 0;
  await dcCarregar(); await espera();
  assert(!window.__rpcCalls.length && document.getElementById('dcConteudo').innerHTML === '', 'consultor: nenhuma RPC, nada na tela');

  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  dcAplicarPermissao();
  assert(document.getElementById('tabBtnDiscador').style.display !== 'none', 'supervisor vê o botão');
  window.__rpcCalls.length = 0;
  document.querySelector('#tabsNav button[data-tab="discador"]').click(); await espera(60);
  const nomes = window.__rpcCalls.map(c => c.nome).filter(n => n.startsWith('discador_')).sort();
  eq(nomes, ['discador_consultores', 'discador_mailing', 'discador_mailing', 'discador_mailing', 'discador_mapa_calor', 'discador_por_hora', 'discador_resumo'], 'supervisor: 7 RPCs, sem vínculo');
  const hoje = hojeSP();
  eq(window.__rpcCalls.find(c => c.nome === 'discador_resumo').args, { p_de: hoje, p_ate: hoje, p_operacao: null }, 'abre em Hoje (supervisor: operação decidida pelo banco)');
  eq(window.__rpcCalls.filter(c => c.nome === 'discador_mailing').map(c => c.args.p_dim).sort(), ['carga', 'cidade', 'operadora'], 'mailing nas 3 dimensões');
  const tela = document.getElementById('dcConteudo').innerHTML;
  assert(tela.includes('139.925') && tela.includes('bmHoras') && tela.includes('bmCalor') && tela.includes('data-dc-agente') && tela.includes('ZZ-carga') && tela.includes('ZZ-cidade'), 'todos os blocos na tela');
  assert(document.getElementById('dcVinculo').innerHTML === '', 'supervisor não vê o vínculo');
  assert(document.getElementById('dcStatus').textContent.includes('Hoje'), 'status com o período');
  assert(!document.getElementById('dcAvisos').textContent.includes('não sincroniza'), 'sync recente: sem faixa');

  // detalhe por dia
  window.__rpcCalls.length = 0;
  document.querySelector('#dcConteudo tr[data-dc-agente="193"]').click(); await espera(40);
  eq(window.__rpcCalls.map(c => [c.nome, c.args.p_agente]), [['discador_consultor_raiox', 193]], 'clique no consultor abre o Raio-X');
  assert(document.getElementById('dcDetalhe').innerHTML.includes('Caio Teste') && document.getElementById('dcDetalhe').innerHTML.includes('Raio-X'), 'Raio-X renderizado');

  // período: Mês
  window.__rpcCalls.length = 0;
  document.querySelector('#dcPeriodos [data-dc-periodo="mes"]').click(); await espera(60);
  eq(window.__rpcCalls.find(c => c.nome === 'discador_resumo').args, { p_de: hoje.slice(0, 8) + '01', p_ate: hoje, p_operacao: null }, 'Mês: do dia 1 até hoje');
  assert(document.querySelector('#dcPeriodos [data-dc-periodo="mes"]').classList.contains('active'), 'pílula ativa');
  assert(window.__rpcCalls.some(c => c.nome === 'discador_consultor_raiox' && c.args.p_de === hoje.slice(0, 8) + '01'), 'trocar período recarrega o Raio-X aberto (nova chamada com o período novo)');
  document.querySelector('#dcDetalhe [data-dc-fechar]').click(); await espera();

  // personalizado inválido: aviso, nenhuma RPC
  document.querySelector('#dcPeriodos [data-dc-periodo="custom"]').click(); await espera();
  assert(document.getElementById('dcCustom').style.display !== 'none', 'personalizado mostra as datas');
  document.getElementById('dcDe').value = '2026-10-10'; document.getElementById('dcAte').value = '2026-10-01';
  window.__rpcCalls.length = 0; avisos.length = 0;
  document.getElementById('btnDcAplicar').click(); await espera(40);
  assert(!window.__rpcCalls.length && avisos.some(a => a[0] === 'erro'), 'personalizado inválido: aviso e nada consultado');
  assert(dcPeriodo(dcEstado.chave, hojeSP(), dcEstado.de, dcEstado.ate) !== null, 'personalizado inválido não estraga o estado (período anterior continua valendo)');
  window.__rpcCalls.length = 0;
  document.querySelector('#dcConteudo tr[data-dc-agente="193"]').click(); await espera(40);
  assert(window.__rpcCalls.some(c => c.nome === 'discador_consultor_raiox'), 'depois do inválido, o Raio-X ainda funciona');
  document.getElementById('dcDe').value = '2026-10-01'; document.getElementById('dcAte').value = '2026-10-10';
  document.getElementById('btnDcAplicar').click(); await espera(60);
  eq(window.__rpcCalls.find(c => c.nome === 'discador_resumo').args, { p_de: '2026-10-01', p_ate: '2026-10-10', p_operacao: null }, 'personalizado válido');

  // corrida: resposta antiga não sobrescreve a nova
  window.__rpcAtraso = { discador_resumo: 120 };
  window.__rpcRespostas.discador_resumo = { data: [Object.assign({}, R, { tentativas: 111 })], error: null };
  const lenta = dcCarregar();
  window.__rpcAtraso = {};
  window.__rpcRespostas.discador_resumo = { data: [Object.assign({}, R, { tentativas: 222 })], error: null };
  await dcCarregar(); await lenta; await espera(150);
  assert(document.getElementById('dcConteudo').innerHTML.includes('>222<') && !document.getElementById('dcConteudo').innerHTML.includes('>111<'), 'só a última carga aparece');

  // falha isolada
  respostasOk();
  window.__rpcRespostas.discador_mapa_calor = { data: null, error: { message: 'timeout' } };
  await dcCarregar(); await espera(60);
  const t2 = document.getElementById('dcConteudo').innerHTML;
  assert(t2.includes('Não foi possível carregar') && t2.includes('139.925') && t2.includes('data-dc-agente'), 'mapa falhou, resto aparece');

  // faixa de sync parado (última há 2 dias úteis) e alerta de abandono no Hoje
  respostasOk();
  window.__rpcRespostas.discador_resumo = { data: [Object.assign({}, R, { ultima_sync: new Date(Date.now() - 3 * 86400000).toISOString() })], error: null };
  const horaAgora = Math.floor(vlPartesSP(Date.now()).min / 60);
  window.__rpcRespostas.discador_por_hora = { data: [{ hora: horaAgora - 1, tentativas: 900, contato: 50, atendidas: 30, abandonadas: 20, media_atendidas: 0, media_abandonadas: 0 }], error: null };
  document.querySelector('#dcPeriodos [data-dc-periodo="hoje"]').click(); await espera(60);
  const av = document.getElementById('dcAvisos').textContent;
  assert(av.includes('não sincroniza'), 'faixa de sync parado');
  assert(av.includes('40,0%') && av.includes('segurar o ritmo'), 'alerta de abandono na última hora cheia');
  document.querySelector('#dcPeriodos [data-dc-periodo="ontem"]').click(); await espera(60);
  assert(!document.getElementById('dcAvisos').textContent.includes('segurar o ritmo'), 'alerta só no Hoje');

  // admin: vínculo
  respostasOk();
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  dcAplicarPermissao();
  window.__rpcCalls.length = 0;
  await dcCarregar(); await espera(60);
  assert(window.__rpcCalls.some(c => c.nome === 'discador_agentes_sem_vinculo'), 'admin busca agentes sem vínculo');
  assert(document.getElementById('dcVinculo').innerHTML.includes('Agente 189'), 'admin vê o vínculo');
  avisos.length = 0; window.__rpcCalls.length = 0;
  document.querySelector('#dcVinculo [data-dc-vinc="189"]').click(); await espera(40);
  assert(!window.__rpcCalls.some(c => c.nome === 'discador_vincular_agente') && avisos.some(a => a[0] === 'erro'), 'sem escolher consultor: aviso, nada gravado');
  document.querySelector('#dcVinculo [data-dc-vinc-sel="189"]').value = 'p1';
  document.querySelector('#dcVinculo [data-dc-vinc="189"]').click(); await espera(80);
  eq((window.__rpcCalls.find(c => c.nome === 'discador_vincular_agente') || {}).args, { p_agente: 189, p_profile: 'p1', p_apelido: null }, 'vincula pela RPC');
  assert(avisos.some(a => a[0] === 'ok') && window.__rpcCalls.filter(c => c.nome === 'discador_resumo').length === 1, 'aviso ok e recarrega a aba');

  // admin → supervisor no mesmo navegador: o bloco de vínculo some na hora, e carga do admin em andamento é descartada
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  dcAplicarPermissao();
  assert(document.getElementById('dcVinculo').innerHTML === '', 'troca para supervisor limpa o vínculo do admin');
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  dcAplicarPermissao();
  window.__rpcAtraso = { discador_resumo: 100 };
  const cargaAdmin = dcCarregar();
  window.__rpcAtraso = {};
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  dcAplicarPermissao();
  await cargaAdmin; await espera(130);
  assert(document.getElementById('dcVinculo').innerHTML === '', 'carga do admin que termina depois da troca não mostra o vínculo ao supervisor');

  // ==== §89: operação (Apex / Campinas) ====
  respostasOk();
  window.__rpcRespostas.discador_resumo = (a) => ({ data: [Object.assign({}, R, { operacao: a.p_operacao || 'apex', sem_operacao: 'ZZ-CAMPANHA-NOVA', ultima_sync: new Date().toISOString() })], error: null });
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin', operacao: 'apex' };
  dcAplicarPermissao();
  assert(document.getElementById('dcOperacoes').style.display !== 'none', 'admin vê o seletor de operação');
  dcEstado.chave = 'hoje';
  window.__rpcCalls.length = 0;
  await dcCarregar(); await espera(60);
  eq(window.__rpcCalls.filter(c => c.nome.startsWith('discador_') && c.nome !== 'discador_agentes_sem_vinculo').map(c => c.args.p_operacao), ['apex', 'apex', 'apex', 'apex', 'apex', 'apex', 'apex'], 'admin abre em Apex, nas 7 RPCs');
  assert(document.getElementById('dcStatus').textContent.includes('Apex'), 'status com a operação');
  assert(document.getElementById('dcAvisos').textContent.includes('ZZ-CAMPANHA-NOVA'), 'admin é avisado da campanha sem operação');
  window.__rpcCalls.length = 0;
  document.querySelector('#dcOperacoes [data-dc-operacao="campinas"]').click(); await espera(60);
  eq(window.__rpcCalls.find(c => c.nome === 'discador_resumo').args.p_operacao, 'campinas', 'pílula Campinas');
  assert(document.querySelector('#dcOperacoes [data-dc-operacao="campinas"]').classList.contains('active') && document.getElementById('dcStatus').textContent.includes('Campinas'), 'pílula ativa e status');
  window.__rpcCalls.length = 0;
  document.querySelector('#dcConteudo tr[data-dc-agente="193"]').click(); await espera(40);
  eq(window.__rpcCalls.find(c => c.nome === 'discador_consultor_raiox').args.p_operacao, 'campinas', 'Raio-X na mesma operação');
  document.querySelector('#dcOperacoes [data-dc-operacao="todas"]').click(); await espera(60);
  assert(document.getElementById('dcStatus').textContent.includes('Todas'), 'todas as operações');

  // supervisor de Campinas: vê a aba, sem seletor, e não manda operação (o banco usa a dele)
  currentUser = { id: 'sc', nome: 'Supervisor Campinas Teste', username: 'supc', role: 'supervisor', operacao: 'campinas' };
  dcAplicarPermissao();
  assert(document.getElementById('tabBtnDiscador').style.display !== 'none', 'supervisor de Campinas vê a aba');
  assert(document.getElementById('dcOperacoes').style.display === 'none', 'supervisor não vê o seletor');
  // o banco devolve a operação do supervisor (o mock imita); sem_operacao fica preenchido para provar que a TELA só avisa o admin
  window.__rpcRespostas.discador_resumo = { data: [Object.assign({}, R, { operacao: 'campinas', sem_operacao: 'ZZ-CAMPANHA-NOVA', ultima_sync: new Date().toISOString() })], error: null };
  window.__rpcCalls.length = 0;
  await dcCarregar(); await espera(60);
  eq(window.__rpcCalls.find(c => c.nome === 'discador_resumo').args.p_operacao, null, 'supervisor manda operação nula');
  assert(document.getElementById('dcStatus').textContent.includes('Campinas'), 'status mostra a operação devolvida pelo banco');
  assert(!document.getElementById('dcAvisos').textContent.includes('ZZ-CAMPANHA-NOVA'), 'aviso de campanha sem operação é só do admin');

  // trocar para consultor limpa a tela
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  dcAplicarPermissao();
  assert(document.getElementById('dcConteudo').innerHTML === '' && document.getElementById('dcVinculo').innerHTML === '', 'perdeu permissão: tela limpa');

  // ==== §96: colunas novas da tabela ====
  eq(dcHoraMin('2026-10-15T17:02:00Z'), '14:02', 'hora em SP');
  eq(dcHoraMin(null), '—', 'hora nula');
  const consN = [
    { agente_id: 1, nome: 'A Teste', profile_id: 'p', atendidas: 100, seg_falados_total: 1, seg_falados_medio: 1, sem_avanco: 0, retornos: 0, ganhos: 0, sem_tabulacao: 0, vendas: 2,
      jornada_inicio: '2026-10-15T17:02:00Z', jornada_fim: '2026-10-15T22:58:00Z', horas_ativas: 5, pausas: 5, curtas: 60 },
    { agente_id: 2, nome: 'B Teste', profile_id: 'p', atendidas: 100, seg_falados_total: 1, seg_falados_medio: 1, sem_avanco: 0, retornos: 0, ganhos: 0, sem_tabulacao: 0, vendas: 2,
      jornada_inicio: null, jornada_fim: null, horas_ativas: 5, pausas: 0, curtas: 20 },
  ];
  const mN = dcMediaEquipe(consN);
  eq([mN.atPorHora, mN.pausasPorHora, mN.curtas], [20, 0.5, 0.4], 'médias: 200/10 at/h, 5/10 pausas/h, 80/200 curtas');
  const tN = dcConsultoresHtml(consN);
  assert(tN.includes('Jornada') && tN.includes('Atend./h') && tN.includes('Pausas') && tN.includes('% curtas'), 'cabeçalhos novos');
  const linhaA = tN.split('data-dc-agente="1"')[1].split('</tr>')[0];
  assert(linhaA.includes('14:02–19:58') && linhaA.includes('60,0%'), 'jornada e % curtas do A');
  assert((linhaA.match(/dcPior/g) || []).length === 2, 'A: pausas (1/h vs 0,5) e curtas (60% vs 40%) em vermelho');
  const linhaB = tN.split('data-dc-agente="2"')[1].split('</tr>')[0];
  assert(linhaB.includes('<td>—</td>') && !linhaB.includes('dcPior'), 'B: jornada — e sem destaque');
  assert(!dcConsultoresHtml([{ agente_id: 3, nome: 'C', atendidas: 0, horas_ativas: 0, pausas: 0, curtas: 0 }]).includes('NaN'), 'sem atendidas: sem NaN');
  // ==== §96: Raio-X ====
  const RX = { operacao: 'apex',
    dias: [{ dia: '2026-10-15', inicio: '2026-10-15T17:02:00Z', fim: '2026-10-15T22:58:00Z', horas_ativas: 5, atendidas: 100, pausas: 2, min_pausa: 41 }],
    por_hora: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(h => ({ hora: h, atendidas: h === 14 ? 30 : 0 })),
    pausas: [{ inicio: '2026-10-15T18:20:00Z', fim: '2026-10-15T18:48:00Z', minutos: 28, equipe_sem_chamadas: false },
             { inicio: '2026-10-15T20:00:00Z', fim: '2026-10-15T20:20:00Z', minutos: 20, equipe_sem_chamadas: true }],
    qualidade: { agente: { atendidas: 100, curtas: 60, seg_falados_medio_sem_curtas: 71, seg_espera_medio: 2, mix: { sem_avanco: 50, retorno: 6, descarte: 4, perdido: 3, ganho: 1, sem_contato: 20, sem_tabulacao: 16, outros: 0 } },
                 equipe: { atendidas: 1000, curtas: 400, seg_falados_medio_sem_curtas: 80, seg_espera_medio: 2, mix: { sem_avanco: 400, retorno: 60, descarte: 40, perdido: 30, ganho: 10, sem_contato: 300, sem_tabulacao: 160, outros: 0 } } },
    resultado: { dias: [{ dia: '2026-10-15', atendidas: 100, vendas: 2 }], semana_atual: { atendidas: 480, vendas: 6 }, semana_anterior: { atendidas: 400, vendas: 8 } } };
  const medRX = { atPorHora: 18, pausasPorHora: 0.2, curtas: 0.4 };
  const rxh = dcRaioXHtml('Caio Teste', RX, medRX, { de: '2026-10-15', ate: '2026-10-15' });
  assert(rxh.includes('Caio Teste') && rxh.includes('Apex') && rxh.includes('14:02–19:58'), 'cabeçalho e jornada');
  assert(rxh.includes('>20,0<') && rxh.includes('equipe 18,0'), 'atend./hora ativa 100/5 vs equipe');
  assert(rxh.includes('2 · 41 min'), 'pausas e minutos');
  assert(rxh.includes('60,0%') && rxh.includes('equipe 40,0%'), '% curtas vs equipe');
  assert((rxh.match(/dcPior/g) || []).length === 2, 'pausas/h (0,4 vs 0,2) e curtas (60% vs 40%) em vermelho, e só eles');
  const linhaSemana = rxh.split('Últimos 7 dias úteis')[1].split('</tr>')[0];
  assert((linhaSemana.match(/bmChip/g) || []).length === 3 && (linhaSemana.match(/▼/g) || []).length === 2, 'seta em atendidas (▲), vendas (▼) e conversão (▼ 1,25% vs 2%)');
  dcEstado.pausaMin = 20;
  const rx20 = dcRaioXHtml('Caio Teste', RX, medRX, { de: '2026-10-15', ate: '2026-10-15' });
  assert(rx20.includes('mais de 20 min') && !rx20.includes('mais de 15 min'), 'texto da pausa vem da config');
  assert(dcConsultoresHtml(consN).includes('mais de 20 min'), 'legenda da tabela também');
  dcEstado.pausaMin = 15;
  assert(rxh.includes('15:20–15:48 · 28 min') && rxh.includes('equipe sem chamadas'), 'lista de pausas com a etiqueta');
  assert(rxh.includes('bmHoras') && rxh.includes('Qualidade') && rxh.includes('Resultado'), 'blocos');
  assert(rxh.includes('Semana anterior') && rxh.includes('▲') && rxh.includes('▼'), 'variação: atendidas sobe, vendas desce');
  assert(rxh.includes('data-dc-fechar'), 'botão fechar');
  const rxv = dcRaioXHtml('Caio Teste', Object.assign({}, RX, { por_hora: [], pausas: [], dias: [RX.dias[0], Object.assign({}, RX.dias[0], { dia: '2026-10-16' })] }), medRX, { de: '2026-10-15', ate: '2026-10-16' });
  assert(rxv.includes('2 dias') && rxv.includes('16/10') && !rxv.includes('bmHoras'), 'vários dias: tabela por dia, sem barras');
  const rx0 = dcRaioXHtml('Zé Teste', { operacao: 'apex', dias: [], por_hora: [], pausas: [], qualidade: { agente: { atendidas: 0, curtas: 0, mix: {} }, equipe: { atendidas: 0, curtas: 0, mix: {} } },
    resultado: { dias: [], semana_atual: { atendidas: 0, vendas: 0 }, semana_anterior: { atendidas: 0, vendas: 0 } } }, {}, { de: '2026-10-17', ate: '2026-10-17' });
  assert(!rx0.includes('NaN') && rx0.includes('Sem atendimentos'), 'consultor sem atendimento: sem NaN');
  assert(dcRaioXHtml('X', null, {}, { de: '2026-10-15', ate: '2026-10-15' }).includes('Não foi possível carregar'), 'falha');
  eq(Math.round(dcVariacao(480, 400) * 1000) / 1000, 0.2, 'variação +20%');
  eq(dcVariacao(5, 0), null, 'sem base: nula');
  // ==== §96: carga do Raio-X ====
  respostasOk();
  window.__rpcRespostas.discador_consultor_raiox = (a) => ({ data: Object.assign({}, RX, { operacao: 'apex', dias: [Object.assign({}, RX.dias[0], { atendidas: a.p_agente })] }), error: null });
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin', operacao: 'apex' };
  dcAplicarPermissao(); dcEstado.chave = 'hoje'; dcEstado.operacao = 'apex';
  await dcCarregar(); await espera(60);
  window.__rpcCalls.length = 0;
  document.querySelector('#dcConteudo tr[data-dc-agente="193"]').click(); await espera(40);
  const chamadaRx = window.__rpcCalls.find(c => c.nome === 'discador_consultor_raiox');
  assert(chamadaRx && chamadaRx.args.p_agente === 193 && chamadaRx.args.p_operacao === 'apex', 'clique abre o Raio-X na operação');
  assert(document.getElementById('dcDetalhe').innerHTML.includes('Raio-X') && document.getElementById('dcDetalhe').innerHTML.includes('Caio Teste'), 'Raio-X na tela');
  // corrida: A (lento) e logo B — fica B
  window.__rpcAtraso = { discador_consultor_raiox: 120 };
  document.querySelector('#dcConteudo tr[data-dc-agente="189"]').click();
  window.__rpcAtraso = {};
  document.querySelector('#dcConteudo tr[data-dc-agente="193"]').click();
  await espera(200);
  assert(document.getElementById('dcDetalhe').innerHTML.includes('Caio Teste') && !document.getElementById('dcDetalhe').innerHTML.includes('Agente 189'), 'clique rápido A→B mostra B');
  // trocar o período recarrega o Raio-X aberto
  window.__rpcCalls.length = 0;
  document.querySelector('#dcPeriodos [data-dc-periodo="ontem"]').click(); await espera(120);
  assert(window.__rpcCalls.some(c => c.nome === 'discador_consultor_raiox' && c.args.p_de === somaDiasStr(hojeSP(), -1)), 'trocar período recarrega o Raio-X');
  // fechar
  document.querySelector('#dcDetalhe [data-dc-fechar]').click(); await espera();
  assert(document.getElementById('dcDetalhe').innerHTML === '' && dcEstado.raiox === null, 'fechar limpa e não reabre');
  window.__rpcCalls.length = 0;
  document.querySelector('#dcPeriodos [data-dc-periodo="hoje"]').click(); await espera(100);
  assert(!window.__rpcCalls.some(c => c.nome === 'discador_consultor_raiox'), 'depois de fechar, trocar período não abre de novo');
  // janela de venda vem da config
  window.__tabelas.config = [{ chave: 'discador', valor: '{"janela_venda_dias":45}' }];
  await dcCarregar(); await espera(80);
  assert(document.getElementById('dcConteudo').innerHTML.includes('até 45 dias antes'), 'cartão de vendas usa a janela da config');
  window.__tabelas.config = [{ chave: 'discador', valor: '{"janela_venda_dias":30,"pausa_min":25}' }];
  await dcCarregar(); await espera(80);
  eq(dcEstado.pausaMin, 25, 'pausa_min lido da config');
  window.__tabelas.config = [{ chave: 'discador', valor: 'xx' }];
  await dcCarregar(); await espera(80);
  eq([dcEstado.pausaMin, dcEstado.janelaVenda], [15, 30], 'config ilegível: padrões');
  window.__tabelas.config = [];
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
