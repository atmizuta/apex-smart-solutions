// Testa o Boletim da Manhã + Plano do dia com check (08/10/2026) — REGRAS_NEGOCIO.md §76.
// Spec: docs/superpowers/specs/2026-10-08-boletim-da-manha-design.md
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
window.__lidas = [];
function builder(tabela){
  const linhasFiltradas = () => { const f = b.__eq || {}; return (window.__tabelas[tabela] || []).filter(l => Object.keys(f).every(c => l[c] === undefined || l[c] === f[c])); };
  const b = {
    select: () => b, in: () => b, is: () => b, not: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b, lt: () => b, gt: () => b, neq: () => b,
    eq: (c, v) => { b.__eq = Object.assign(b.__eq || {}, { [c]: v }); return b; },
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
  const sp = (s) => Date.parse(s + '-03:00');
  const iso = (s) => new Date(sp(s)).toISOString();

  // ==== período e edição ====
  let p = bmPeriodo('2026-10-08');   // quinta
  eq([p.diaUtil, p.de, p.ate, p.dias, p.edicao], [true, '2026-10-07', '2026-10-07', ['2026-10-07'], 'normal'], 'quinta comum: só quarta');
  p = bmPeriodo('2026-10-05');       // segunda
  eq([p.de, p.ate, p.dias.length, p.edicao], ['2026-10-02', '2026-10-04', 3, 'segunda'], 'segunda: sexta a domingo, edição de segunda');
  p = bmPeriodo('2026-10-13');       // terça depois do feriado de 12/10
  eq([p.de, p.ate, p.dias.length, p.edicao], ['2026-10-09', '2026-10-12', 4, 'segunda'], 'terça depois do feriado: sexta a segunda, 1º dia útil da semana');
  p = bmPeriodo('2026-10-01');       // quinta, 1º dia útil do mês
  eq([p.de, p.edicao], ['2026-09-30', 'inicio_mes'], '1º dia útil do mês');
  eq([bmPeriodo('2026-10-10').diaUtil, bmPeriodo('2026-10-11').diaUtil, bmPeriodo('2026-10-12').diaUtil], [false, false, false], 'sábado, domingo e feriado não têm boletim');
  eq(bmDiasUteisAntes('2026-10-07', 3), ['2026-10-06', '2026-10-05', '2026-10-02'], '3 dias úteis antes de 07/10');
  eq(bmDiasUteisAte('2026-10-04', 2), ['2026-10-02', '2026-10-01'], 'dias úteis até um domingo: sexta e quinta');
  eq(bmRotuloPeriodo(bmPeriodo('2026-10-08')), 'Ontem (qua, 07/10)', 'rótulo de um dia');
  eq(bmRotuloPeriodo(bmPeriodo('2026-10-13')), 'De sexta (09/10) a segunda (12/10)', 'rótulo de vários dias');

  // ==== semáforo ====
  eq([bmCor(100, 100, 'maior', 0.3), bmCor(70, 100, 'maior', 0.3), bmCor(69.9, 100, 'maior', 0.3)], ['verde', 'amarelo', 'vermelho'], 'maior é melhor: fronteiras 100% e 70%');
  eq([bmCor(100, 100, 'menor', 0.3), bmCor(130, 100, 'menor', 0.3), bmCor(130.1, 100, 'menor', 0.3)], ['verde', 'amarelo', 'vermelho'], 'menor é melhor: fronteiras 100% e 130%');
  eq([bmCor(5, null, 'maior', 0.3), bmCor(null, 10, 'maior', 0.3)], ['cinza', 'cinza'], 'sem base: cinza');
  eq([bmCor(0, 0, 'menor', 0.3), bmCor(5, 0, 'menor', 0.3), bmCor(5, 0, 'maior', 0.3)], ['verde', 'vermelho', 'verde'], 'referência zero');

  // ==== formatos ====
  eq([bmFmtMil(2345), bmFmtMil(850), bmFmtMil(15500)], ['R$ 2,3 mil', 'R$ 850', 'R$ 15,5 mil'], 'R$ em mil');

  // ==== manchete ====
  let m = bmManchete({ rotulo: 'Ontem (qua, 07/10)', contratos: 24, valor: 2300, refValor: 2053.57, mes: '2026-10', receita: 6100, meta: 15500, pctMes: 0.35, previsao: 16200, acao1: { o_que: 'Cobrar o back office: pedido 9 em Crédito há 3 dias úteis', quem: 'Supervisão', valor: 300 } });
  eq(m[0], 'Ontem (qua, 07/10): 24 contratos, R$ 2,3 mil — 12% acima da média de 20 dias úteis.', 'frase 1');
  eq(m[1], 'Outubro: R$ 6,1 mil de R$ 15,5 mil (39%) com 35% do mês útil decorrido; previsão R$ 16,2 mil.', 'frase 2');
  assert(/^Maior risco: Cobrar o back office: pedido 9/.test(m[2]) && m[2].indexOf('Supervisão') > 0, 'frase 3 é a ação nº 1: ' + m[2]);
  m = bmManchete({ rotulo: 'De sexta (09/10) a segunda (12/10)', contratos: 1, valor: 500, refValor: 1000, mes: '2026-10', receita: 0, meta: 0, pctMes: 0.4, previsao: null, acao1: null });
  eq(m[0], 'De sexta (09/10) a segunda (12/10): 1 contrato, R$ 500 — 50% abaixo da média de 20 dias úteis.', 'frase 1, vários dias, abaixo');
  eq(m[1], 'Outubro: R$ 0 ativados com 40% do mês útil decorrido.', 'frase 2 sem meta e sem previsão');
  eq(m[2], 'Sem risco grande hoje.', 'frase 3 sem ações');
  eq(bmManchete({ rotulo: 'X', contratos: 2, valor: 10, refValor: null, mes: '2026-10', receita: 0, meta: 0, pctMes: 0, previsao: null, acao1: null })[0], 'X: 2 contratos, R$ 10 — sem média de 20 dias úteis para comparar.', 'frase 1 sem referência');

  // ==== regras do plano ====
  const HOJE = '2026-10-08', AGORA = sp('2026-10-08T10:05:00');
  const cfg = bmCfg(null);
  eq([cfg.pedido_grande, cfg.queda_alerta, cfg.dias_parado, cfg.max_acoes_pagina1, cfg.hora], [150, 0.3, 2, 8, '10:00'], 'config padrão');
  eq(bmCfg('{"pedido_grande":200,"abre_sozinho":["x"]}').pedido_grande, 200, 'config do banco sobrepõe o padrão');
  let item = 0;
  const L = (num, over) => Object.assign({ numero_pedido: num, grupo: 'VOZ - Novo', usuario: 'CAIO TESTE', etapa: 'CREDITO (NEOCRM)',
    cadastro: iso('2026-09-20T00:00:00'), atualizacao: iso('2026-10-01T10:00:00'), valor: 100, quantidade: 1, produto: 'Plano', cliente: 'EMPRESA FICTICIA ' + num,
    cnpj: '00.000.000/0001-' + String(10 + (item % 80)), tag: '', data_portabilidade: null, data_instalacao: null, na_etapa_desde: iso('2026-10-07T10:00:00'),
    usuario_id: 1, criado_em: iso('2026-09-20T10:00:00'), item_id: ++item }, over || {});
  const linhas = [
    L('G1', { valor: 200, etapa: 'CREDITO (NEOCRM)', na_etapa_desde: iso('2026-10-05T10:00:00') }),                         // R1 (operadora → Supervisão)
    L('G2', { valor: 200, etapa: 'BIOMETRIA (NEOCRM)', na_etapa_desde: iso('2026-10-06T10:00:00') }),                       // R1 e R3 → fica R1
    L('B1', { valor: 149, etapa: 'AGUARDANDO ASSINATURA (NEOCRM)', na_etapa_desde: iso('2026-10-06T10:00:00') }),           // só R3
    L('V1', { valor: 50, etapa: 'ENTREGA (NEOCRM)', na_etapa_desde: iso('2026-09-24T10:00:00'), data_instalacao: iso('2026-10-20T10:00:00') }), // R2 (9 → 10 dias úteis)
    L('V2', { valor: 60, etapa: 'ENTREGA (NEOCRM)', na_etapa_desde: iso('2026-09-20T10:00:00'), data_instalacao: iso('2026-10-20T10:00:00') }), // já era MÁXIMO: não é R2
    L('D1', { valor: 300, etapa: 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', na_etapa_desde: iso('2026-10-01T10:00:00'), data_portabilidade: iso('2026-10-06T10:00:00') }), // R4 e R1 → fica R4
    L('P1', { valor: 90, etapa: 'VENDA PERDIDA (NEOCRM)', tag: '#HOTLEAD', atualizacao: iso('2026-10-07T15:00:00'), cnpj: '00.000.000/0002-01' }),    // R8
    L('P2', { valor: 90, etapa: 'VENDA PERDIDA (NEOCRM)', tag: '#HOTLEAD', atualizacao: iso('2026-10-01T15:00:00'), cnpj: '00.000.000/0002-02' }),    // perdido fora do período
    L('C1', { valor: 40, etapa: 'CREDITO (NEOCRM)', cnpj: '00.000.000/0003-01', usuario: 'CAIO TESTE' }),                   // R10
    L('C2', { valor: 45, etapa: 'ANTIFRAUDE (NEOCRM)', cnpj: '00.000.000/0003-01', usuario: 'GIO TESTE', usuario_id: 2 }),
    L('OK1', { valor: 500, etapa: 'CONCLUIDO (NEOCRM)', data_portabilidade: iso('2026-10-03T10:00:00') }),
  ];
  const pedidos = ppAgruparPedidos(linhas);
  const vendas = {};
  const vazio = () => ({ contratos: 0, valor: 0, linhas: 0, porConsultor: [], porContrato: [] });
  bmDiasUteisAntes('2026-10-07', 20).concat(['2026-10-07']).forEach(d => { vendas[d] = vazio(); });
  // CAIO vende todo dia (R$ 100); GIO vendeu em 05/10 e zerou 06 e 07; ZE nunca vendeu
  Object.keys(vendas).forEach(d => { vendas[d] = { contratos: 1, valor: 100, linhas: 1, porConsultor: [{ key: 'CAIO TESTE', contratos: 1, valor: 100 }], porContrato: [{ chave: 'K' + d, numero: 'K' + d, usuario: 'CAIO TESTE', valor: 100, linhas: 1 }] }; });
  vendas['2026-10-05'].porConsultor.push({ key: 'GIO TESTE', contratos: 1, valor: 400 }); vendas['2026-10-05'].valor += 400;
  vendas['2026-10-07'] = { contratos: 2, valor: 350, linhas: 2, porConsultor: [{ key: 'CAIO TESTE', contratos: 2, valor: 350 }], porContrato: [{ chave: 'BIG', numero: 'BIG', usuario: 'CAIO TESTE', valor: 250, linhas: 1 }, { chave: 'S', numero: 'S', usuario: 'CAIO TESTE', valor: 100, linhas: 1 }] };
  const leads = [
    { aba: 'OUTUBRO', lead_id: 'n1', consultor: null, profile_id: null, criado_em_lead: iso('2026-10-07T22:00:00'), categoria: 'sem_contato', primeiro_clique: null, primeira_ligacao: null },
    { aba: 'OUTUBRO', lead_id: 'n2', consultor: 'Caio', profile_id: 'p-caio', criado_em_lead: iso('2026-10-08T08:00:00'), categoria: 'sem_contato', primeiro_clique: null, primeira_ligacao: null },
    { aba: 'OUTUBRO', lead_id: 'n3', consultor: null, profile_id: null, criado_em_lead: iso('2026-10-07T20:00:00'), categoria: 'sem_contato', primeiro_clique: null, primeira_ligacao: null },   // antes das 21h
    { aba: 'OUTUBRO', lead_id: 'n4', consultor: 'Caio', profile_id: 'p-caio', criado_em_lead: iso('2026-10-07T23:00:00'), categoria: 'andamento', primeiro_clique: iso('2026-10-08T09:00:00'), primeira_ligacao: null }, // já teve contato
  ];
  const perdas = [
    { numero_pedido: 'X1', usuario: 'CAIO TESTE', valor: 80, perdido_em: iso('2026-10-07T12:00:00'), categoria: null },
    { numero_pedido: 'X2', usuario: 'CAIO TESTE', valor: 70, perdido_em: iso('2026-10-07T13:00:00'), categoria: 'DESISTÊNCIA' },
    { numero_pedido: 'X3', usuario: 'CAIO TESTE', valor: 60, perdido_em: iso('2026-10-02T13:00:00'), categoria: '' },   // fora do período
  ];
  const retornos = { agenda: [
      { id: 'a1', consultor_id: 'p-caio', quando: iso('2026-10-06T10:00:00'), status: 'pendente' },
      { id: 'a2', consultor_id: 'p-caio', quando: iso('2026-10-07T15:00:00'), status: 'pendente' },
      { id: 'a3', consultor_id: 'p-caio', quando: iso('2026-10-06T10:00:00'), status: 'feito' },
      { id: 'a4', consultor_id: 'p-caio', quando: iso('2026-10-08T09:00:00'), status: 'pendente' } ],   // hoje: ainda não é atrasado
    followups: [ { id: 'f1', consultor_id: 'p-caio', data_prevista: '2026-10-07', feito: false }, { id: 'f2', consultor_id: 'p-caio', data_prevista: '2026-10-08', feito: false } ] };
  const dados = {
    linhas, pedidos, vendas, leads, perdas, retornos, receitaPorLead: 100,
    equipe: ['CAIO TESTE', 'GIO TESTE', 'ZE TESTE'],
    metas: [{ profile_id: 'p-gio', meta_receita: 1000 }], vinculos: [{ profile_id: 'p-gio', neo_usuario_id: 2 }, { profile_id: 'p-caio', neo_usuario_id: 1 }],
    perfis: { 'p-caio': 'Caio Teste', 'p-gio': 'Gio Teste' },
    anterior: { dia: '2026-10-07', acoes: [{ id: 1, regra: 'pedido_grande_parado', chave: 'G1', dias_seguidos: 1 }] },
  };
  const ctx = { hoje: HOJE, agoraMs: AGORA, cfg, vlcfg: vlCfg('{"seg_sex":["11:00","21:00"],"sabado":null}'), periodo: bmPeriodo(HOJE) };
  const acoes = bmAcoes(dados, ctx);
  const por = (regra, chave) => acoes.find(a => a.regra === regra && (chave === undefined || a.chave === chave));
  const g1 = por('pedido_grande_parado', 'G1');
  assert(g1 && g1.quem === 'Supervisão' && /^Cobrar o back office: pedido G1 em Crédito há 3 dias úteis$/.test(g1.o_que) && g1.valor === 200 && g1.prazo === 'hoje', 'R1 com a bola na operadora: ' + JSON.stringify(g1));
  eq(g1 && g1.dias_seguidos, 2, 'R1 que estava no plano anterior entra como 2º dia');
  const g2 = por('pedido_grande_parado', 'G2');
  assert(g2 && g2.quem === 'CAIO TESTE' && /^Acionar o cliente: pedido G2/.test(g2.o_que), 'R1 com a bola no cliente é do consultor');
  assert(!por('cliente_parado', 'G2'), 'um pedido, uma ação: G2 fica só na R1');
  const b1 = por('cliente_parado', 'B1');
  assert(b1 && b1.quem === 'CAIO TESTE' && /^Reenviar a mensagem ao cliente: pedido B1/.test(b1.o_que) && b1.valor === 149, 'R3 cliente parado');
  const v1 = por('pedido_vermelho', 'V1');
  assert(v1 && v1.quem === 'Supervisão' && v1.o_que === 'Cobrar CAIO TESTE: pedido V1 chegou a 10 dias úteis em Entrega', 'R2 pedido que virou vermelho: ' + JSON.stringify(v1));
  assert(!por('pedido_vermelho', 'V2'), 'R2 não entra para quem já era MÁXIMO no início do período');
  const d1 = por('data_vencida', 'D1');
  assert(d1 && d1.quem === 'CAIO TESTE' && /^Confirmar a nova data com o cliente ou o back office: pedido D1 \\(portabilidade prevista para 06\\/10\\/2026\\)$/.test(d1.o_que), 'R4 data vencida: ' + (d1 && d1.o_que));
  assert(!por('pedido_grande_parado', 'D1'), 'um pedido, uma ação: D1 fica só na R4');
  const p1 = por('perda_recuperavel', 'P1');
  assert(p1 && p1.quem === 'CAIO TESTE' && /^Reatacar: lead quente/.test(p1.o_que) && p1.valor === 90, 'R8 perda recuperável do período');
  assert(!por('perda_recuperavel', 'P2'), 'R8 só para perdas do período');
  const c = por('cnpj_conflito');
  assert(c && c.quem === 'Supervisão' && c.valor === 85 && /pedido C1 \\(CAIO TESTE\\) × pedido C2 \\(GIO TESTE\\)/.test(c.o_que), 'R10 conflito de CNPJ: ' + (c && c.o_que));
  const z = por('consultor_zerado', 'GIO TESTE');
  assert(z && z.o_que === 'Conversa individual hoje com GIO TESTE: 2 dias úteis sem venda' && z.valor === 40, 'R5 zerado: média 400/20 × 2 = 40 — ' + JSON.stringify(z));
  assert(!por('consultor_zerado', 'CAIO TESTE'), 'R5 não entra para quem vendeu');
  const ze = por('consultor_zerado', 'ZE TESTE');
  assert(ze && ze.valor === 0 && /20\\+ dias úteis sem venda/.test(ze.o_que), 'R5 quem não vende há 20+ dias úteis: R$ 0 — ' + (ze && ze.o_que));
  const r6 = por('consultor_ritmo');
  assert(r6 && r6.quem === 'Supervisão' && /^Plano de recuperação com GIO TESTE: 0% da meta com \\d+% do mês; faltam R\\$/.test(r6.o_que) && r6.valor > 0, 'R6 ritmo abaixo de 50%: ' + (r6 && r6.o_que));
  const n = por('lead_noite');
  assert(n && n.chave === 'leads-noite' && n.o_que === 'Distribuir agora: 1 sem dono, 1 sem contato (leads da noite)' && n.valor === 200 && n.prazo === 'até 11h', 'R7 leads da noite: ' + JSON.stringify(n));
  eq(n && n.extra.leads.sort(), ['OUTUBRO|n1', 'OUTUBRO|n2'], 'R7 guarda os leads para a conferência');
  const sm = por('perda_sem_motivo');
  assert(sm && sm.o_que === 'Cobrar CAIO TESTE: 1 perda sem motivo no NEO' && sm.valor === 80, 'R9 perdas sem motivo do período: ' + JSON.stringify(sm));
  const rt = por('retorno_atrasado');
  assert(rt && rt.o_que === 'Cobrar CAIO TESTE: 3 retornos atrasados' && rt.valor === 0, 'R11 retornos atrasados (agenda + follow-up, nome do NeoCRM): ' + JSON.stringify(rt));
  const dc = por('destaque', 'maior-contrato'), dv = por('destaque', 'maior-valor');
  assert(dc && /^Parabenizar no grupo: CAIO TESTE fez o maior contrato do período \\(R\\$ 250,00\\/mês\\)$/.test(dc.o_que.replace(/\\u00a0/g, ' ')) && dc.valor === 0 && dc.extra.msg, 'R12 maior contrato: ' + (dc && dc.o_que));
  assert(dv && /CAIO TESTE/.test(dv.o_que), 'R12 maior R$ do período');
  // ordem: R$ do maior para o menor; R$ 0 no fim; ordem 1..N
  const valores = acoes.map(a => a.valor);
  assert(valores.every((v, i) => i === 0 || valores[i - 1] >= v), 'plano ordenado por R$: ' + valores.join(','));
  eq(acoes.map(a => a.ordem), acoes.map((a, i) => i + 1), 'ordem 1..N');
  eq(acoes[0].chave, 'D1', 'maior R$ primeiro (D1, R$ 300)');
  const empate = bmAcoes({ linhas: [], pedidos: [], vendas: {}, leads: [], perdas: [], retornos: { agenda: [], followups: [] }, equipe: [], metas: [], vinculos: [], perfis: {}, anterior: null,
    _extra: [] }, ctx);
  eq(empate.length, 0, 'sem dados, sem ações');

  // ==== conferência automática ====
  const linhasDepois = [
    L('G1', { valor: 200, etapa: 'PORTABILIDADE EM ANDAMENTO (NEOCRM)' }),
    L('V1', { valor: 50, etapa: 'CONCLUIDO (NEOCRM)' }),
    L('B1', { valor: 149, etapa: 'VENDA PERDIDA (NEOCRM)' }),
    L('G2', { valor: 200, etapa: 'BIOMETRIA (NEOCRM)' }),
    L('D1', { valor: 300, etapa: 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', data_portabilidade: iso('2026-10-12T10:00:00') }),
    L('N9', { valor: 77, etapa: 'CREDITO (NEOCRM)', cnpj: '00.000.000/0002-01' }),   // cliente do P1 voltou
    L('C1', { valor: 40, etapa: 'CREDITO (NEOCRM)', cnpj: '00.000.000/0003-01' }),
  ];
  const vendasDepois = { '2026-10-07': { contratos: 1, valor: 120, linhas: 1, porConsultor: [{ key: 'GIO TESTE', contratos: 1, valor: 120 }], porContrato: [] } };
  const leadsDepois = [
    Object.assign({}, leads[0], { consultor: 'Gio', primeira_ligacao: iso('2026-10-08T11:30:00') }),
    Object.assign({}, leads[1], { primeiro_clique: iso('2026-10-08T11:10:00') }),
  ];
  const ant = [
    { id: 1, dia: '2026-10-07', regra: 'pedido_grande_parado', chave: 'G1', extra: { numero: 'G1', etapa: 'CREDITO (NEOCRM)', valor: 200 } },
    { id: 2, dia: '2026-10-07', regra: 'pedido_vermelho', chave: 'V1', extra: { numero: 'V1', etapa: 'ENTREGA (NEOCRM)', valor: 50 } },
    { id: 3, dia: '2026-10-07', regra: 'cliente_parado', chave: 'B1', extra: { numero: 'B1', etapa: 'AGUARDANDO ASSINATURA (NEOCRM)', valor: 149 } },
    { id: 4, dia: '2026-10-07', regra: 'pedido_grande_parado', chave: 'G2', extra: { numero: 'G2', etapa: 'BIOMETRIA (NEOCRM)', valor: 200 } },
    { id: 5, dia: '2026-10-07', regra: 'data_vencida', chave: 'D1', extra: { numero: 'D1', etapa: 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', valor: 300 } },
    { id: 6, dia: '2026-10-07', regra: 'consultor_zerado', chave: 'GIO TESTE', extra: { consultor: 'GIO TESTE' } },
    { id: 7, dia: '2026-10-07', regra: 'lead_noite', chave: 'leads-noite', extra: { leads: ['OUTUBRO|n1', 'OUTUBRO|n2'] } },
    { id: 8, dia: '2026-10-07', regra: 'perda_recuperavel', chave: 'P1', extra: { numero: 'P1', cnpj: '00000000000201', valor: 90 } },
    { id: 9, dia: '2026-10-07', regra: 'perda_sem_motivo', chave: 'sem-motivo:CAIO TESTE', extra: { numeros: ['X1'] } },
    { id: 10, dia: '2026-10-07', regra: 'cnpj_conflito', chave: '00000000000301', extra: {} },
    { id: 11, dia: '2026-10-07', regra: 'retorno_atrasado', chave: 'retornos:p-caio', extra: { ids: ['ag:a1', 'fu:f1'] } },
    { id: 12, dia: '2026-10-07', regra: 'destaque', chave: 'maior-contrato', extra: {} },
    { id: 13, dia: '2026-10-07', regra: 'consultor_ritmo', chave: 'neo:2', extra: {} },
    { id: 14, dia: '2026-10-07', regra: 'pedido_grande_parado', chave: 'G1', resolvida_em: '2026-10-07T13:00:00Z', extra: { numero: 'G1', etapa: 'X', valor: 1 } },
  ];
  const conf = bmConferir(ant, { linhas: linhasDepois, pedidos: ppAgruparPedidos(linhasDepois), vendas: vendasDepois, leads: leadsDepois,
    perdas: [{ numero_pedido: 'X1', usuario: 'CAIO TESTE', valor: 80, perdido_em: iso('2026-10-07T12:00:00'), categoria: 'ERRO DE CADASTRO' }],
    retornos: { agenda: [{ id: 'a1', consultor_id: 'p-caio', quando: iso('2026-10-14T10:00:00'), status: 'pendente' }], followups: [{ id: 'f1', consultor_id: 'p-caio', data_prevista: '2026-10-07', feito: true }] } }, ctx);
  const cf = id => conf.find(x => x.id === id);
  eq(cf(1), { id: 1, desfecho: 'avancou', valor_recuperado: 200 }, 'pedido que saiu da etapa: avançou, R$ recuperado');
  eq(cf(2), { id: 2, desfecho: 'concluiu', valor_recuperado: 50 }, 'pedido concluído');
  eq(cf(3), { id: 3, desfecho: 'perdeu', valor_recuperado: 0 }, 'pedido perdido: R$ 0');
  eq(cf(4), undefined, 'pedido parado na mesma etapa não se resolve');
  eq(cf(5), { id: 5, desfecho: 'avancou', valor_recuperado: 300 }, 'data vencida que ganhou data nova');
  eq(cf(6), { id: 6, desfecho: 'vendeu', valor_recuperado: 120 }, 'consultor zerado que vendeu no dia do plano');
  eq(cf(7), { id: 7, desfecho: 'atribuido', valor_recuperado: 0 }, 'leads da noite com dono e contato');
  eq(cf(8), { id: 8, desfecho: 'reaberto', valor_recuperado: 77 }, 'perda recuperável: o CNPJ abriu pedido novo');
  eq(cf(9), { id: 9, desfecho: 'preenchido', valor_recuperado: 0 }, 'perdas ganharam motivo');
  eq(cf(10), { id: 10, desfecho: 'decidido', valor_recuperado: 0 }, 'conflito de CNPJ com um consultor só');
  eq(cf(11), { id: 11, desfecho: 'zerou', valor_recuperado: 0 }, 'retornos atrasados zerados');
  eq([cf(12), cf(13), cf(14)], [undefined, undefined, undefined], 'destaque e ritmo não se resolvem; já resolvida não é conferida de novo');

  // ==== resultado do plano anterior ====
  const res = bmResultadoAnterior({ dia: '2026-10-07', acoes: [
    { status: 'feita', resolvida_em: null, valor_recuperado: 0, o_que: 'a', quem: 'x' },
    { status: 'feita', resolvida_em: '2026-10-08T13:00:00Z', valor_recuperado: 200, o_que: 'b', quem: 'x' },
    { status: 'aberta', resolvida_em: '2026-10-08T13:00:00Z', valor_recuperado: 300, o_que: 'c', quem: 'x' },
    { status: 'nao_deu', resolvida_em: null, valor_recuperado: 0, o_que: 'd', quem: 'x', nota: 'cliente viajando' },
    { status: 'aberta', resolvida_em: null, valor_recuperado: 0, o_que: 'e', quem: 'y' },
  ] });
  eq(res.frase.replace(/\\u00a0/g, ' '), 'Plano de qua, 07/10: 3 de 5 ações concluídas (2 feitas + 1 resolvida sozinha), R$ 500,00 recuperados.', 'frase do resultado');
  eq([res.naoDeu.length, res.naoDeu[0].nota, res.semMarcacao.length], [1, 'cliente viajando', 1], 'listas do resultado');
  eq(bmResultadoAnterior(null), null, 'sem plano anterior');

  console.log('--- test_boletim_manha RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__resultado = fail > 0 ? 1 : 0;
}catch(e){ console.log('ERRO FATAL:', e && e.stack || e); window.__resultado = 1; }
})();
`;
window.eval(jsCode + '\n' + testScript);
const espera = setInterval(() => {
  if(window.__resultado === undefined) return;
  clearInterval(espera);
  process.exit(window.__resultado);
}, 50);
setTimeout(() => { console.log('TEMPO ESGOTADO'); process.exit(1); }, 60000);
