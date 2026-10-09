// Testa o Boletim da Manhã — resumo do dia anterior (v2, 09/10/2026) — REGRAS_NEGOCIO.md §76 e §77.
// Spec: docs/superpowers/specs/2026-10-09-boletim-da-manha-v2-design.md
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
window.jspdf = require('jspdf');
window.process = process;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const sp = (s) => Date.parse(s + '-03:00');
  const iso = (s) => new Date(sp(s)).toISOString();
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));

  // ==== período, nomes, formatos ====
  let p = bmPeriodo('2026-10-08');
  eq([p.diaUtil, p.de, p.ate, p.dias], [true, '2026-10-07', '2026-10-07', ['2026-10-07']], 'quinta: só quarta');
  p = bmPeriodo('2026-10-13');
  eq([p.de, p.ate, p.dias.length], ['2026-10-09', '2026-10-12', 4], 'terça depois do feriado: sexta a segunda');
  eq([bmPeriodo('2026-10-10').diaUtil, bmPeriodo('2026-10-12').diaUtil], [false, false], 'sábado e feriado sem boletim');
  eq(bmRotuloPeriodo(bmPeriodo('2026-10-08')), 'Resumo de quarta-feira, 07/10/2026', 'rótulo de um dia');
  eq(bmRotuloPeriodo(bmPeriodo('2026-10-05')), 'Resumo de sexta (02/10) a domingo (04/10/2026)', 'rótulo de segunda');
  eq([bmQuando(bmPeriodo('2026-10-08')), bmQuando(bmPeriodo('2026-10-05'))], ['Ontem', 'De sexta a domingo'], 'quando');
  eq([bmNomeBonito('LÚRIA AMANDA ALVIM LOURENÇO'), bmNomeCurto('VITORIA DA SILVA SANTOS BRITO'), bmNomeCurto('YASMIN SILVA')], ['Lúria Amanda Alvim Lourenço', 'Vitoria Silva', 'Yasmin Silva'], 'nomes');
  eq([bmFmtMil(1149.43), bmFmtMil(10946), bmFmtMil(0)], ['R$ 1.149', 'R$ 10,9 mil', 'R$ 0'], 'R$ curto');
  eq(bmGrupoPerda('', bmCfg(null)), 'sem_motivo', 'perda sem motivo');

  // ==== dados fictícios de quarta, 07/10 (boletim de quinta, 08/10) ====
  const HOJE = '2026-10-08', AGORA = sp('2026-10-08T10:20:00');
  const cfg = bmCfg({ telefonia: { 'apex.caio': 'CAIO TESTE', 'Apex.YasminFicticia': 'YASMIN TESTE', 'apex.gio': 'GIO TESTE', 'apex.rafael': 'RAFAEL SANTIAGO ANGELÃO' },
    planilha: { Caio: 'CAIO TESTE', Rafael: 'RAFAEL SANTIAGO ANGELÃO' }, perdas: { evitaveis: ['Desistência Demora'], nao_evitaveis: ['Restrição de Crédito'] } });
  const ctx = { hoje: HOJE, agoraMs: AGORA, periodo: bmPeriodo(HOJE), cfg, vlcfg: vlCfg('{"seg_sex":["11:00","21:00"],"sabado":null}'), nome: 'Supervisora Teste' };
  const hora = (h, n) => { const a = Array(24).fill(0); a[h] = n; return a; };
  const vendas = {};
  for(let d = '2026-09-01'; d <= '2026-10-06'; d = somaDiasStr(d, 1)){
    if(!ppDiaUtil(d)){ vendas[d] = { contratos: 0, valor: 0, linhas: 0, porConsultor: [], porTipo: [], porHora: Array(24).fill(0) }; continue; }
    vendas[d] = { contratos: 1, valor: 100, linhas: 1, porConsultor: [{ key: 'CAIO TESTE', contratos: 1, linhas: 1, valor: 100 }], porTipo: [{ grupo: 'VOZ - Novo', qtd: 1 }], porHora: hora(15, 1) };
  }
  vendas['2026-10-02'].porConsultor.push({ key: 'GIO TESTE', contratos: 1, linhas: 1, valor: 80 }); vendas['2026-10-02'].contratos = 2; vendas['2026-10-02'].valor = 180;
  vendas['2026-10-07'] = { contratos: 3, valor: 350, linhas: 3, porTipo: [{ grupo: 'VOZ - Portabilidade', qtd: 2 }, { grupo: 'VOZ - Novo', qtd: 1 }], porHora: (() => { const a = hora(15, 2); a[19] = 1; return a; })(),
    porConsultor: [{ key: 'YASMIN TESTE', contratos: 2, linhas: 2, valor: 250 }, { key: 'CAIO TESTE', contratos: 1, linhas: 1, valor: 100 }, { key: 'RAFAEL SANTIAGO ANGELÃO', contratos: 1, linhas: 1, valor: 999 }] };
  const lig = (usuario, hh, at, seg) => ({ usuario, gerada_em: iso('2026-10-07T' + hh + ':00'), atendida: at, seg_falados: seg });
  const ligacoes = [];
  for(let i = 0; i < 10; i++) ligacoes.push(lig('apex.caio', '14:' + String(10 + i), i < 6, i < 2 ? 90 : 20));
  for(let i = 0; i < 4; i++) ligacoes.push(lig('apex.yasminficticia', '19:' + String(10 + i), i < 2, 30));
  ligacoes.push(lig('apex.gio', '15:10', false, 0), lig('apex.gio', '15:20', false, 0), lig('apex.novo', '16:00', true, 70));
  for(let i = 0; i < 5; i++) ligacoes.push(lig('apex.rafael', '14:3' + i, true, 100));
  ligacoes.push(lig('apex.caio', '23:59', true, 10)); ligacoes[ligacoes.length - 1].gerada_em = iso('2026-10-06T14:00:00');   // outro dia: fora
  const ligacoesRef = [{ usuario: 'apex.caio', total: 300 }, { usuario: 'apex.rafael', total: 100 }];
  const LD = (id, consultor, criado, extra) => Object.assign({ aba: 'OUTUBRO', lead_id: id, consultor, profile_id: null, criado_em_lead: iso(criado), primeira_sync_em: iso(criado),
    categoria: 'andamento', converteu: false, primeiro_clique: null, canal_clique: null, primeira_ligacao: null, nome: 'Empresa Lead ' + id }, extra || {});
  const leads = [
    LD('1', 'Caio', '2026-10-07T12:00:00', { categoria: 'convertido', primeiro_clique: iso('2026-10-07T12:10:00') }),
    LD('2', 'Caio', '2026-10-07T13:00:00', { primeira_ligacao: iso('2026-10-07T14:00:00') }),
    LD('3', 'Caio', '2026-10-07T15:00:00', { categoria: 'sem_contato' }),
    LD('4', 'Mariana', '2026-10-07T16:00:00'),
    LD('5', 'Rafael', '2026-10-07T16:30:00', { categoria: 'sem_contato' }),
    LD('6', 'Caio', '2026-10-07T17:00:00', { aba: 'REPIQUE', categoria: 'sem_contato' }),
    LD('7', 'Caio', '2026-10-06T17:00:00', { categoria: 'sem_contato' }),
  ];
  const PD = (n, usuario, valor, categoria, dia) => ({ numero_pedido: n, usuario, valor, categoria, perdido_em: iso((dia || '2026-10-07') + 'T12:00:00'), cliente: 'CLIENTE FICTICIO ' + n });
  const perdas = [PD('P1', 'CAIO TESTE', 70, 'Desistência Demora'), PD('P2', 'YASMIN TESTE', 50, 'Restrição de Crédito'), PD('P3', 'CAIO TESTE', 30, ''), PD('P4', 'GIO TESTE', 20, 'Motivo Novo'),
    PD('P5', 'RAFAEL SANTIAGO ANGELÃO', 99, 'Desistência Demora'), PD('P6', 'CAIO TESTE', 40, 'Desistência Demora', '2026-10-06')];
  const dados = { vendas, ligacoes, ligacoesRef, leads, perdas,
    metas: [{ profile_id: 'p-caio', meta_receita: 1000 }, { profile_id: 'p-rafa', meta_receita: 5000 }],
    vinculos: [{ profile_id: 'p-caio', neo_usuario_id: 1 }, { profile_id: 'p-rafa', neo_usuario_id: 9 }],
    neoNomes: { 1: 'CAIO TESTE', 9: 'RAFAEL SANTIAGO ANGELÃO' }, saude: { producao: iso('2026-10-08T09:59:40') }, falhas: [] };

  // ==== blocos ====
  const rk = bmRanking(dados, ctx);
  eq(rk.lista.map(c => [c.curto, c.contratos, c.valor]), [['Yasmin Teste', 2, 250], ['Caio Teste', 1, 100]], 'ranking por valor, sem o Rafael');
  eq(rk.naoVenderam, ['GIO TESTE'], 'não venderam = equipe ativa (vendeu nos 20 dias úteis) sem venda ontem; quem nunca vendeu não entra');
  eq(bmMix(rk.total), [{ rotulo: 'Portabilidade', qtd: 2 }, { rotulo: 'Linha nova', qtd: 1 }], 'o que foi vendido');
  const cal = bmCalor(dados, ctx, rk.ativos);
  eq(cal.dias, ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'], 'mapa de calor: 5 últimos dias úteis');
  eq(cal.linhas.map(l => [l.curto, l.valores, l.total]), [['Caio Teste', [1, 1, 1, 1, 1], 5], ['Yasmin Teste', [0, 0, 0, 0, 2], 2], ['Gio Teste', [0, 1, 0, 0, 0], 1]], 'mapa de calor por consultor');
  const mm = bmMetaMes(dados, ctx);
  eq([mm.mes, mm.meta, mm.vendido, mm.decorridos], ['2026-10', 1000, 830, 5], 'mês: meta sem a do Rafael; vendido do mês');
  const caioMes = mm.consultores.find(c => c.nome === 'CAIO TESTE');
  eq([caioMes.vendido, caioMes.meta, caioMes.pct], [500, 1000, 0.5], 'meta do mês do Caio');
  assert(mm.consultores.some(c => c.nome === 'YASMIN TESTE' && c.meta === null) && !mm.consultores.some(c => /RAFAEL/.test(c.nome)), 'sem meta aparece; Rafael fora');
  const fu = bmFunil(dados, ctx, rk);
  const fC = fu.lista.find(r => r.nome === 'CAIO TESTE'), fY = fu.lista.find(r => r.nome === 'YASMIN TESTE'), fN = fu.lista.find(r => r.nome === 'apex.novo');
  eq([fC.ligacoes, fC.atendidas, fC.conversas, fC.vendas, fC.porCem, fC.primeira, fC.ultima], [10, 6, 2, 1, 10, '14:10', '14:19'], 'funil do Caio (login ligado, outro dia fora)');
  eq([fY.ligacoes, fY.vendas, fY.porCem], [4, 2, 50], 'funil da Yasmin (login com maiúscula diferente)');
  assert(fN && fN.semVinculo && fN.ligacoes === 1, 'login sem vínculo aparece pelo login');
  assert(!fu.lista.some(r => /RAFAEL|rafael/.test(r.nome)), 'ligações do Rafael fora');
  eq([fu.total, fu.atendidas], [17, 9], 'total de ligações válidas do período');
  const ph = bmPorHora(dados, ctx, rk.total);
  eq(ph.horas.map(h => h.h), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 'eixo 8h–20h');
  eq([ph.horas.find(h => h.h === 14).ligacoes, ph.horas.find(h => h.h === 15).vendas, ph.horas.find(h => h.h === 19).ligacoes], [10, 2, 4], 'ligações e vendas por hora');
  eq(ph.faixas.map(f => [f.de, f.ate]), [[11, 14], [17, 19], [20, 21]], 'horas paradas do expediente agrupadas');
  const ld = bmLeads(dados, ctx);
  const lC = ld.lista.find(c => c.nome === 'CAIO TESTE');
  eq([ld.recebidos, ld.convertidos, lC.recebidos, lC.convertidos, lC.minutos, lC.semPlanilha, lC.semSistema], [4, 1, 3, 1, 35, 1, 1], 'leads: só do período, sem REPIQUE e sem os do Rafael');
  assert(ld.lista.some(c => c.nome === 'Mariana' && c.semVinculo && c.semSistema === 1 && c.semPlanilha === 0), 'consultor da planilha sem vínculo aparece pelo nome da planilha');
  eq(ld.destaque && [ld.destaque.curto, ld.destaque.convertidos, ld.destaque.recebidos], ['Caio Teste', 1, 3], 'maior conversão (mínimo de 3 leads)');
  eq(ld.semContato.map(x => [x.consultor, x.lead, x.planilha, x.sistema]), [['Caio Teste', 'Empresa Lead 3', true, true], ['Mariana', 'Empresa Lead 4', false, true]], 'leads sem contato, de quem são, pelas duas contas');
  const pd = bmPerdas(dados, ctx);
  eq([pd.n, pd.valor, pd.grupos.evitavel.n, pd.grupos.nao_evitavel.n, pd.grupos.sem_motivo.n, pd.grupos.outros.n], [4, 170, 1, 1, 1, 1], 'perdas do período sem o Rafael, por grupo');
  eq(pd.porConsultor.map(c => [c.curto, c.n, c.valor]), [['Caio Teste', 2, 100], ['Yasmin Teste', 1, 50], ['Gio Teste', 1, 20]], 'perdas por consultor');

  // ==== retrato completo ====
  const R = bmMontar(dados, ctx);
  eq(R.versao, 2, 'retrato v2');
  eq(R.numeros.map(n => [n.chave, n.valor, n.ref]), [['vendas', 3, 1.1], ['valor', 350, 104], ['linhas', 3, null], ['ligacoes', 17, 15], ['leads', 4, null], ['perdas', 4, null]], '6 números com a média de 20 dias úteis');
  eq(R.resumo[0], 'Ontem a equipe fez 3 vendas (R$ 350) — valor 237% acima da média dos últimos 20 dias úteis.', 'resumo 1');
  eq(R.resumo[1], 'Quem mais vendeu: Yasmin Teste (R$ 250, 2 vendas). 1 pessoa da equipe não vendeu.', 'resumo 2');
  eq(R.resumo[2], 'Foram 17 ligações manuais (13% acima da média) e chegaram 4 leads — 2 ainda sem contato.', 'resumo 3');
  eq(R.atencao.length, 3, 'atenção: no máximo 3');
  assert(/^2 leads de ontem ainda sem contato — Caio Teste \\(1\\), Mariana \\(1\\)\\.$/.test(R.atencao[0]), 'atenção 1: leads sem contato — ' + R.atencao[0]);
  assert(/^Quase ninguém ligou das 11h às 14h e das 17h às 19h e das 20h às 21h/.test(R.atencao[1]), 'atenção 2: horas paradas — ' + R.atencao[1]);
  eq(R.atencao[2], 'Conversar com Gio Teste (2 ligações): não venderam e ligaram pouco.', 'atenção 3: não vendeu e ligou pouco');
  eq(bmAtencao({ leads: { semAlgum: 0, semContato: [] }, porHora: { faixas: [] }, funil: { mediaPorConsultor: null, lista: [] }, ranking: { naoVenderam: [] }, numeros: [], perdas: { grupos: { evitavel: { n: 0 } } } }, ctx), ['Nada fora do normal de ontem.'], 'sem nada a apontar');
  assert(!/RAFAEL|Rafael|SANTIAGO/.test(JSON.stringify(R)), 'nada do Rafael no retrato');
  assert(R.saude.semVinculo.indexOf('apex.novo') >= 0 && R.saude.semVinculo.indexOf('Mariana') >= 0, 'sem vínculo no rodapé');
  assert(JSON.stringify(R).length < 40000, 'retrato pequeno');

  // ==== geração do dia: regra das 10h, espera da sincronização, primeiro ganha, fonte que falha ====
  let agoraTeste = sp('2026-10-08T09:30:00');
  bmAgora = () => agoraTeste;
  const resumoFalso = (dia) => { const v = vendas[dia] || { contratos: 0, valor: 0, linhas: 0, porConsultor: [], porTipo: [], porHora: Array(24).fill(0) };
    return { contratos: v.contratos, valor: v.valor, linhas: v.linhas, porConsultor: v.porConsultor, porTipo: v.porTipo.map(t => Object.assign({ label: t.grupo }, t)),
      porHora: (v.porHora || Array(24).fill(0)).map(n => ({ contratos: n })) }; };
  bmObterResumoDiaria = async () => resumoFalso;
  const ANTIGO = { dia: '2026-10-07', periodo_de: '2026-10-06', periodo_ate: '2026-10-06', gerado_em: iso('2026-10-07T10:01:00'), gerado_por_nome: 'Isa Teste', retrato: { versao: 1, manchete: [] } };
  let gravado = null;
  const respostas = () => {
    window.__rpcRespostas = {
      boletim_obter: (a) => ({ data: !a.p_dia || a.p_dia === '2026-10-07' ? ANTIGO : null, error: null }),
      monitor_ligacoes_por_usuario: { data: ligacoesRef, error: null },
      mesa_leads_relogio: { data: leads.map(l => { const c = Object.assign({}, l); delete c.nome; return c; }), error: null },
      vendas_perdidas: { data: perdas, error: null },
      boletim_gravar: (a) => { gravado = a; return { data: { dia: a.p_dia, periodo_de: a.p_de, periodo_ate: a.p_ate, gerado_em: iso('2026-10-08T10:16:00'), gerado_por_nome: 'Supervisor Teste', retrato: a.p_retrato, gravou: true }, error: null }; },
    };
  };
  respostas();
  window.__tabelas = { config: [{ chave: 'boletim', valor: JSON.stringify(Object.assign({ abre_sozinho: ['s1'] }, { telefonia: cfg.telefonia, planilha: cfg.planilha, perdas: cfg.perdas })) }],
    producao_sync_log: [{ ok: true, terminou_em: iso('2026-10-08T08:59:30') }], ligacoes_manuais: ligacoes,
    leads: leads.map(l => ({ id: l.lead_id, aba: l.aba, full_name: l.nome })), metas_consultor: dados.metas, consultor_neo: dados.vinculos,
    producao_pedidos_neo: [{ id: 1, usuario_id: 1, usuario: 'CAIO TESTE' }, { id: 2, usuario_id: 9, usuario: 'RAFAEL SANTIAGO ANGELÃO' }],
    boletim_retratos: [{ dia: '2026-10-07', periodo_de: '2026-10-06', periodo_ate: '2026-10-06' }] };

  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  bmAplicarPermissao();
  assert(document.getElementById('tabBtnBoletim').style.display === 'none', 'consultor não vê o botão');
  window.__rpcCalls.length = 0;
  await bmGarantirDoDia(); await bmAoEntrar();
  assert(!window.__rpcCalls.length && document.getElementById('bmConteudo').innerHTML === '', 'consultor: nada carregado, nenhuma RPC');

  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  bmAplicarPermissao();
  window.__rpcCalls.length = 0;
  await bmGarantirDoDia();
  assert(/sai às 10:00/.test(document.getElementById('bmAviso').textContent) && /formato antigo/.test(document.getElementById('bmConteudo').textContent), 'antes das 10h: último boletim (aqui no formato antigo) + aviso');
  assert(!window.__rpcCalls.some(c => c.nome === 'boletim_gravar'), 'antes das 10h não grava');
  assert(document.getElementById('btnBmPdf').disabled, 'PDF desabilitado para o formato antigo');
  agoraTeste = sp('2026-10-08T10:05:00');
  await bmGarantirDoDia();
  assert(/Aguardando a sincronização das 09h59/.test(document.getElementById('bmAviso').textContent), 'às 10:05 sem sync: aguarda');
  agoraTeste = sp('2026-10-08T10:16:00');
  await bmGarantirDoDia();
  assert(gravado && gravado.p_dia === HOJE && gravado.p_de === '2026-10-07' && !('p_acoes' in gravado) && gravado.p_retrato.versao === 2 && gravado.p_retrato.saude.semSync === true, 'às 10:16 grava o retrato v2, sem ações, com o aviso da sync');
  eq(gravado.p_retrato.numeros.map(n => n.valor), [3, 350, 3, 17, 4, 4], 'números do retrato gravado (pela carga real)');
  assert(gravado.p_retrato.leads.semContato.some(x => x.lead === 'Empresa Lead 3'), 'nome do lead vem da tabela de leads (só para a tela)');
  const tela = document.getElementById('bmConteudo');
  assert(tela.querySelectorAll('[data-bm-num]').length === 6 && tela.querySelectorAll('[data-bm-rank]').length === 2 && tela.querySelectorAll('[data-bm-hora]').length === 13, 'tela: 6 números, ranking e 13 horas');
  ['Boletim da Manhã', 'Atenção hoje', 'Quem vendeu', 'Não venderam', 'Meta do mês por consultor', 'Últimos 5 dias úteis', 'O que foi vendido', 'Funil por consultor', 'Ritmo por hora', 'Leads por consultor', 'Maior conversão', 'Leads sem contato', 'Vendas perdidas', 'Evitáveis', 'gerado sem a sincronização das 9h59']
    .forEach(t => assert(tela.textContent.indexOf(t) >= 0, 'tela mostra "' + t + '"'));
  assert(tela.textContent.indexOf('Empresa Lead 3') >= 0, 'tela mostra o nome do lead sem contato');
  assert(!/Rafael|RAFAEL/.test(tela.textContent), 'nada do Rafael na tela');
  assert(!document.getElementById('btnBmPdf').disabled, 'PDF habilitado');
  assert(!document.getElementById('bmPlanoCard') && !document.getElementById('bmNotaOverlay'), 'a lista com check saiu da Mesa');
  // primeiro ganha
  const jaTem = { dia: HOJE, periodo_de: '2026-10-07', periodo_ate: '2026-10-07', gerado_em: iso('2026-10-08T10:02:00'), gerado_por_nome: 'Outra Pessoa', retrato: gravado.p_retrato };
  respostas();
  window.__rpcRespostas.boletim_gravar = () => ({ data: Object.assign({}, jaTem, { gravou: false }), error: null });
  window.__tabelas.producao_sync_log = [{ ok: true, terminou_em: iso('2026-10-08T09:59:40') }];
  agoraTeste = sp('2026-10-08T10:03:00');
  await bmGarantirDoDia();
  assert(/Outra Pessoa/.test(document.getElementById('bmSubtitulo').textContent), 'primeiro ganha: mostra o de quem gravou antes');
  // fonte essencial faltando: não grava, avisa e tenta de novo
  respostas(); gravado = null;
  bmObterResumoDiaria = async () => null;
  agoraTeste = sp('2026-10-08T10:20:00');
  await bmGarantirDoDia();
  assert(gravado === null && /NÃO foi salvo/.test(document.getElementById('bmAviso').textContent) && /as vendas/.test(document.getElementById('bmAviso').textContent) && !!bmEstado.timer, 'sem as vendas: não grava e tenta de novo');
  bmObterResumoDiaria = async () => resumoFalso;
  // sábado
  agoraTeste = sp('2026-10-10T11:00:00');
  await bmGarantirDoDia();
  assert(/não é dia útil/.test(document.getElementById('bmAviso').textContent), 'sábado: sem boletim');
  // o dashboard é recarregado antes de contar as vendas
  const frameW = document.getElementById('producaoFrame').contentWindow;
  let empurrado = null;
  frameW.atualizarDadosDashboard = (linhas, quando) => { empurrado = { linhas, quando }; };
  window.__tabelas.producao_pedidos = [{ numero_pedido: 'N1', usuario: 'CAIO TESTE' }, { numero_pedido: 'N2', usuario: 'Rafael Santiago Angelão' }, { numero_pedido: 'N3', usuario: 'VITOR QUEIROZ CAVALCANTE' }];
  window.__tabelas.config.push({ chave: 'producao_neo_atualizado_em', valor: '08/10/2026, 09:59:40' });
  eq(await bmRefrescarDashboard(), true, 'recarrega os pedidos do dashboard');
  eq(empurrado && empurrado.linhas.map(x => x.numero_pedido), ['N1'], 'empurra para o iframe sem as pessoas fora do Dashboard (inclusive Rafael)');
  delete frameW.atualizarDadosDashboard;
  eq(await bmRefrescarDashboard(), false, 'sem o dashboard carregado: não finge que atualizou');

  // ==== PDF: 4 páginas, sem cliente, lead nem CNPJ ====
  const doc = bmPdf({ dia: HOJE, gerado_em: iso('2026-10-08T10:16:00'), retrato: gravado ? gravado.p_retrato : R });
  const saida = doc.output();
  eq(doc.getNumberOfPages(), 4, 'PDF com 4 páginas');
  ['RESUMO', 'VENDAS', 'LEADS E PERDAS', 'Quem vendeu'.toUpperCase(), 'FUNIL POR CONSULTOR', 'RITMO POR HORA', 'Maior convers'].forEach(t => assert(saida.indexOf(t) >= 0, 'PDF tem "' + t + '"'));
  assert(/p.gina 1 de 4/.test(saida) && /p.gina 4 de 4/.test(saida), 'rodapé página N de 4');
  assert(!/Empresa Lead|CLIENTE FICTICIO|Rafael|RAFAEL/.test(saida), 'PDF sem nome de lead, cliente ou do Rafael');

  // ==== abertura automática ====
  const marcas = {};
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: k => (k in marcas ? marcas[k] : null), setItem: (k, v) => { marcas[k] = String(v); } } });
  respostas();
  const alertas = []; window.alert = (m) => alertas.push(String(m));
  const sair = () => document.getElementById('panel-boletim').classList.remove('active');
  sair();
  agoraTeste = sp('2026-10-08T09:40:00');
  await bmAoEntrar();
  assert(!document.getElementById('panel-boletim').classList.contains('active'), 'antes das 10h não abre sozinho');
  agoraTeste = sp('2026-10-08T10:01:00');
  bmVerificarHora(false);
  assert(alertas.some(m => /Boletim da Manhã pronto/.test(m)) && !document.getElementById('panel-boletim').classList.contains('active'), 'painel aberto às 10h: só o aviso');
  delete marcas['bmAbriu:s1']; bmEstado.avisadoDia = '';
  sair();
  await bmAoEntrar();
  assert(document.getElementById('panel-boletim').classList.contains('active'), 'quem está em abre_sozinho: abre o boletim');
  sair();
  await bmAoEntrar();
  assert(!document.getElementById('panel-boletim').classList.contains('active'), 'abre uma vez por dia');
  currentUser = { id: 'a9', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  await bmAoEntrar();
  assert(!document.getElementById('panel-boletim').classList.contains('active'), 'quem não está na lista não é levado ao boletim');
  clearInterval(bmEstado.relogio); clearTimeout(bmEstado.timer);
  await espera(30);

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
