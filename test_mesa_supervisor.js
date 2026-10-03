// Testa a Mesa do Supervisor (02/10/2026) — REGRAS_NEGOCIO.md §68.
// Spec: docs/superpowers/specs/2026-10-02-velocidade-lead-mesa-supervisor-design.md
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
  const sp = (s) => Date.parse(s + '-03:00');
  const iso = (s) => new Date(sp(s)).toISOString();
  const cfg = vlCfg(null);
  const AGORA = sp('2026-10-05T10:00:00'), HOJE = '2026-10-05';
  const LD = (id, extra) => Object.assign({ aba: 'OUTUBRO', lead_id: id, consultor: 'Caio', profile_id: 'p-caio', criado_em_lead: iso('2026-10-05T09:00:00'), primeira_sync_em: iso('2026-10-05T09:06:00'), categoria: 'andamento', converteu: false, primeiro_clique: null, canal_clique: null, primeira_ligacao: null }, extra || {});

  // ==== TASK 6: funções puras ====
  eq(mesaMediana([3, 1, 2]), 2, 'mediana ímpar');
  eq(mesaMediana([1, 2, 3, 4]), 2.5, 'mediana par');
  eq(mesaMediana([]), null, 'mediana vazia');
  eq(mesaDiaSP('2026-10-05T02:00:00Z'), '2026-10-04', 'dia em SP (madrugada UTC = véspera)');
  eq(mesaNivelPedido({ desde: iso('2026-09-30T10:00:00') }, HOJE), 'minimo', 'pedido: 3 dias úteis = mínimo');
  eq(mesaNivelPedido({ desde: iso('2026-10-02T10:00:00') }, HOJE), null, 'pedido: 1 dia útil = fora');

  const leads = [
    LD('rapido', { primeiro_clique: iso('2026-10-05T09:04:00') }),          // 4 min: no prazo
    LD('lento', { primeira_ligacao: iso('2026-10-05T09:40:00') }),          // 40 min: fora
    LD('esperandoVerm', { criado_em_lead: iso('2026-10-05T09:30:00') }),    // 30 min sem contato: conta como fora
    LD('esperandoVerde', { criado_em_lead: iso('2026-10-05T09:58:00') }),   // 2 min: ainda não entra no prazo
    LD('semDono', { consultor: null, profile_id: null, criado_em_lead: iso('2026-10-05T09:50:00') }),
    LD('antigo', { criado_em_lead: iso('2026-09-20T09:00:00'), categoria: 'convertido', primeiro_clique: iso('2026-09-21T09:00:00') }),
  ];
  eq(mesaNoPrazo(leads.slice(0, 4), AGORA, cfg), 1 / 3, 'no prazo: 1 de 3 (rápido; lento e esperando vermelho fora; verde ainda não conta)');
  eq(mesaNoPrazo([], AGORA, cfg), null, 'sem base: null');

  const pend = [
    { profile_id: 'p-caio', nome: 'Caio Teste', tipo: 'consultor' },
    { profile_id: 'p-luria', nome: 'Luria Teste', tipo: 'consultor' },
    { profile_id: 'p-zeca', nome: 'Zeca Teste', tipo: 'consultor' },
    { profile_id: 'p-luria', nome: 'Luria Teste', tipo: 'retorno_atrasado', ref: 'l9', titulo: 'Lead Teste 9', desde: iso('2026-10-04T00:00:00') },
    { profile_id: 'p-luria', nome: 'Luria Teste', tipo: 'proposta_parada', ref: 'pr1', titulo: 'Empresa Teste', desde: iso('2026-09-20T10:00:00') },
    { profile_id: 'p-zeca', nome: 'Zeca Teste', tipo: 'pedido_risco', ref: 'N1', titulo: 'Cliente Teste', desde: iso('2026-09-15T10:00:00'), extra: { etapa: 'ENTREGA (NEOCRM)' } },
    { profile_id: 'p-zeca', nome: 'Zeca Teste', tipo: 'pedido_risco', ref: 'N2', titulo: 'Cliente Teste 2', desde: iso('2026-10-02T10:00:00'), extra: { etapa: 'ENTREGA (NEOCRM)' } },
  ];
  const k = mesaKpis(leads, pend, AGORA, cfg, HOJE);
  eq(k.novosHoje, 5, 'KPI: leads novos hoje');
  eq(k.esperando, 3, 'KPI: esperando agora (verm, verde e sem dono)');
  eq(k.semDono, 1, 'KPI: sem dono');
  eq(k.retornosAtrasados, 1, 'KPI: retornos atrasados');
  eq(k.pedidosVermelhos, 1, 'KPI: pedidos 🔴 (N1 com 10+ dias úteis)');
  eq(k.medianaMin, 22, 'KPI: mediana até o 1º contato (4 e 40 min)');

  const lig = [{ profile_id: 'p-caio', lig_lead: 30, lig_total: 40, ultima: iso('2026-10-05T09:59:00') }, { profile_id: 'p-luria', lig_lead: 10, lig_total: 12, ultima: iso('2026-10-05T09:00:00') }];
  const vendas = [{ profile_id: 'p-caio', pedidos: 3, receita: 900 }, { profile_id: 'p-admin', pedidos: 1, receita: 100 }];
  const metas = [{ profile_id: 'p-caio', meta_receita: 3000 }];
  const sem = mesaSemaforo({ leads, pend, lig, vendas, metas }, AGORA, cfg, HOJE);
  eq(sem.map(r => r.nome), ['Caio Teste', 'Zeca Teste', 'Luria Teste'], 'ordem: vermelhos (Caio por lead 30 min; Zeca por pedido 🔴) por nº de pendências, depois amarelo');
  eq(sem.map(r => r.cor), ['vermelho', 'vermelho', 'amarelo'], 'cores das linhas');
  const caio = sem[0];
  eq(caio.esperando.length, 2, 'Caio: 2 esperando');
  eq(caio.lig.lig_lead, 30, 'Caio: ligações para lead hoje');
  eq(caio.mediaLig, 20, 'média de ligações da equipe (30 e 10)');
  eq([caio.vendas.receita, caio.meta], [900, 3000], 'Caio: vendas e meta do mês');
  assert(!sem.some(r => r.profileId === 'p-admin'), 'vendas de quem não é consultor não cria linha');
  eq(sem.find(r => r.nome === 'Zeca Teste').pedidos.map(p => p.ref), ['N1'], 'pedido com 1 dia útil não entra');
  const luria = sem.find(r => r.nome === 'Luria Teste');
  eq(luria.cor, 'amarelo', 'retorno atrasado de ontem (1 dia) = amarelo');
  const verdeSem = mesaSemaforo({ leads: [], pend: [{ profile_id: 'p-x', nome: 'Xis Teste', tipo: 'consultor' }], lig: [], vendas: [], metas: [] }, AGORA, cfg, HOJE);
  eq([verdeSem[0].cor, verdeSem[0].nPend], ['verde', 0], 'consultor sem pendência aparece verde');
  const semLogin = mesaSemaforo({ leads: [LD('s1', { consultor: 'Beltrano', profile_id: null, criado_em_lead: iso('2026-10-05T09:00:00') })], pend: [], lig: [], vendas: [], metas: [] }, AGORA, cfg, HOJE);
  assert(semLogin[0].semLogin && semLogin[0].nome === 'Beltrano', 'nome da planilha sem perfil vira linha "sem login"');
  const retVelho = mesaSemaforo({ leads: [], pend: [{ profile_id: 'p-y', nome: 'Ypsilon Teste', tipo: 'retorno_atrasado', desde: iso('2026-10-02T00:00:00') }], lig: [], vendas: [], metas: [] }, AGORA, cfg, HOJE);
  eq(retVelho[0].cor, 'vermelho', 'retorno atrasado há 2+ dias = vermelho');

  const txt = mesaTextoCobranca(caio);
  assert(txt.startsWith('Oi, Caio!') && txt.includes('2 leads esperando') && txt.includes('30 min'), 'texto de cobrança com o pior relógio (lead das 09:30): ' + txt);
  eq(mesaTextoCobranca(verdeSem[0]), '', 'linha verde não tem cobrança');

  const vc = mesaVelocidadeConversao([
    LD('a', { primeiro_clique: iso('2026-10-05T09:03:00'), categoria: 'convertido' }),
    LD('b', { primeiro_clique: iso('2026-10-05T09:03:00') }),
    LD('c', { categoria: 'perdido' }),
    LD('d', { aba: 'SETEMBRO', primeiro_clique: iso('2026-10-05T09:03:00') }),
  ], 'OUTUBRO', cfg);
  eq(vc.map(r => r.faixa), ['ate5', '5a15', '15a60', '1a4h', 'mais4h', 'sem'], 'todas as faixas, na ordem');
  eq([vc[0].leads, vc[0].vendas, vc[0].conversao], [2, 1, 0.5], 'faixa até 5: 2 leads, 1 venda, 50%');
  eq([vc[5].leads, vc[1].conversao], [1, null], 'sem contato registrado: 1; faixa vazia: conversão null');

  eq(mesaAtrasoPlanilhaMin(leads, AGORA), 6, 'atraso da planilha: mediana de primeira_sync_em - criado_em_lead');
  eq(mesaAtrasoPlanilhaMin([LD('z', { primeira_sync_em: null })], AGORA), null, 'sem primeira_sync_em: null');

  // ==== TASK 7: aba, carga, KPIs, fila, permissões ====
  const nowReal = Date.now;
  Date.now = () => AGORA;
  window.__rpcRespostas.mesa_leads_relogio = { data: leads, error: null };
  window.__rpcRespostas.mesa_pendencias = { data: pend, error: null };
  window.__rpcRespostas.mesa_ligacoes_hoje = { data: lig, error: null };
  window.__rpcRespostas.mesa_vendas_mes = { data: vendas, error: null };
  window.__tabelas.metas_consultor = [{ profile_id: 'p-caio', mes: '2026-10-01', meta_receita: 3000 }];
  window.__tabelas.config = [];

  // consultor: sem botão, painel vazio, nenhuma RPC da Mesa
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  mesaAplicarPermissao();
  assert(document.getElementById('tabBtnMesa').style.display === 'none', 'consultor não vê o botão da Mesa');
  window.__rpcCalls.length = 0;
  await loadMesa(true);
  assert(!window.__rpcCalls.some(c => /^mesa_/.test(c.nome)), 'consultor não dispara RPC da Mesa');
  assert(document.getElementById('mesaSemaforoTbody').innerHTML === '', 'painel vazio para o consultor');

  // supervisor (troca de login sem recarregar): botão aparece e a carga funciona
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  mesaAplicarPermissao();
  assert(document.getElementById('tabBtnMesa').style.display !== 'none', 'supervisor vê o botão da Mesa');
  document.querySelector('#tabsNav button[data-tab="mesa"]').click();
  await espera(60);
  assert(document.getElementById('panel-mesa').classList.contains('active'), 'clique abre o painel da Mesa');
  const cDesde = window.__rpcCalls.find(c => c.nome === 'mesa_leads_relogio');
  eq(cDesde && cDesde.args.p_desde, '2026-09-01T00:00:00-03:00', 'busca desde o 1º dia do mês anterior (SP)');
  eq((window.__rpcCalls.find(c => c.nome === 'mesa_pendencias') || {}).args, { p_ref: HOJE }, 'pendências de hoje (SP)');
  eq((window.__rpcCalls.find(c => c.nome === 'mesa_vendas_mes') || {}).args, { p_mes: '2026-10-01' }, 'vendas do mês');
  const kTxt = document.getElementById('mesaKpis').textContent;
  assert(kTxt.includes('Leads novos hoje') && kTxt.includes('5'), 'KPI de leads novos');
  assert(kTxt.includes('33,3%'), 'KPI no prazo 7 d');
  assert(kTxt.includes('22 min'), 'KPI mediana');
  eq([...document.querySelectorAll('#mesaFila .vlRow')].map(r => r.dataset.leadId), ['esperandoVerm', 'semDono', 'esperandoVerde'], 'fila da equipe: vermelho, amarelo, verde');
  assert(document.querySelector('#mesaFila [data-lead-id="semDono"]').textContent.includes('sem dono'), 'sem dono sinalizado');
  assert(!document.getElementById('mesaFila').innerHTML.includes('5519900'), 'Mesa não mostra telefone');
  assert(document.getElementById('mesaAtraso').textContent.includes('6 min'), 'atraso da planilha');
  assert(!/NaN|undefined/.test(document.getElementById('panel-mesa').textContent), 'nada de NaN/undefined');

  // um bloco que falha não derruba os outros
  window.__rpcRespostas.mesa_pendencias = { data: null, error: { message: 'x' } };
  await loadMesa(true);
  assert(document.getElementById('mesaSemaforoTbody').textContent.includes('Não foi possível carregar'), 'semáforo avisa a falha');
  assert(document.querySelectorAll('#mesaFila .vlRow').length === 3, 'fila continua aparecendo');
  window.__rpcRespostas.mesa_pendencias = { data: pend, error: null };

  // reset ao trocar para consultor
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  mesaAplicarPermissao();
  assert(document.getElementById('mesaFila').innerHTML === '' && document.getElementById('mesaKpis').innerHTML === '', 'troca para consultor limpa a Mesa');
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  mesaAplicarPermissao();
  Date.now = nowReal;

  // ==== TASK 8: semáforo, expandir, cobrar, Excel, velocidade × conversão ====
  Date.now = () => AGORA;
  window.__abertos = [];
  window.open = (u) => { window.__abertos.push(u); return null; };
  window.__copiados = [];
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (t) => { window.__copiados.push(t); return Promise.resolve(); } }, configurable: true });
  window.__xlsx = [];
  window.XLSX.writeFile = (wb, nome) => window.__xlsx.push({ wb, nome });
  await loadMesa(true);
  const trs = [...document.querySelectorAll('#mesaSemaforoTbody tr[data-mesa-linha]')];
  eq(trs.map(t => t.querySelector('.mesaNome').textContent.trim()), ['Caio Teste', 'Zeca Teste', 'Luria Teste'], 'linhas na ordem do semáforo');
  assert(trs[0].textContent.includes('2') && trs[0].textContent.includes('30 min'), 'Caio: 2 esperando e o pior relógio (30 min)');
  assert(trs[0].textContent.includes('30') && trs[0].textContent.includes('média 20'), 'Caio: ligações hoje x média');
  assert(trs[0].textContent.includes('R$') && trs[0].textContent.includes('30,0%'), 'Caio: vendas x meta (900/3000 = 30%)');
  assert(trs[2].textContent.includes('sem meta'), 'Luria: sem meta');
  assert(document.querySelector('#mesaSemaforoTbody tr[data-mesa-linha] .retornoBadge.atrasado'), 'linha vermelha com selo atrasado');
  const zecaPedidoNivel = trs[1].querySelector('.ppNivel.maximo');
  assert(zecaPedidoNivel && zecaPedidoNivel.textContent.includes('MÁXIMO'), 'Zeca: pedido em risco com a cor do nível (ppNivel.maximo)');

  // expandir
  trs[1].click();
  await espera(20);
  const det = document.querySelector('#mesaSemaforoTbody tr.mesaDetalhe');
  assert(det && det.textContent.includes('Cliente Teste') && det.textContent.includes('MÁXIMO'), 'expandir mostra o pedido e o nível');
  // a tabela é redesenhada a cada clique: buscar a linha de novo (a referência antiga ficou fora do DOM)
  document.querySelector('#mesaSemaforoTbody tr[data-mesa-linha="p:p-zeca"]').click();
  await espera(20);
  assert(!document.querySelector('#mesaSemaforoTbody tr.mesaDetalhe'), 'clicar de novo recolhe');

  // cobrar
  document.querySelector('#mesaSemaforoTbody [data-mesa-cobrar="p:p-caio"]').click();
  await espera(20);
  assert(window.__copiados[0] && window.__copiados[0].startsWith('Oi, Caio!'), 'cobrar copia o texto');
  assert(window.__abertos[0] && window.__abertos[0].startsWith('https://wa.me/?text=Oi%2C%20Caio'), 'cobrar abre wa.me sem número');
  assert(!document.querySelector('#mesaSemaforoTbody [data-mesa-cobrar]:not([data-mesa-cobrar^="p:"])'), 'só linhas com chave válida têm Cobrar');

  // Excel
  document.getElementById('btnMesaExportar').click();
  await espera(20);
  const x = window.__xlsx.pop();
  assert(x && x.nome === 'MesaSupervisor_' + HOJE + '.xlsx', 'nome do Excel');
  eq(x.wb.SheetNames, ['Semáforo', 'Itens'], 'abas do Excel');

  // velocidade × conversão: pílulas por mês e tabela
  const pills = [...document.querySelectorAll('#mesaVelPills [data-mesa-aba]')].map(b => b.dataset.mesaAba);
  assert(pills.length >= 1 && pills[0] === 'OUTUBRO', 'pílulas por mês (mais recente primeiro)');
  assert(document.getElementById('mesaVelTabela').textContent.includes('até 5 min') && document.getElementById('mesaVelTabela').textContent.includes('sem contato registrado'), 'tabela com as faixas');
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
