// Testa a sub-aba "Projeção de Ganho" do Dashboard de Produção (19/10/2026, REGRAS_NEGOCIO.md seção 101).
// Mesma técnica de test_pedidos_alerta.js: decodifica o template embutido de verdade (PRODUCAO_DASHBOARD_TPL_B64),
// preenche os placeholders com dados FICTÍCIOS e roda o script real num jsdom. Nenhum dado real de cliente aqui —
// o repositório é público.
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
function perto(a, b){ return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6; }
function secao(nome, fn){ try{ fn(); }catch(e){ fail++; console.log('FALHOU (exceção em ' + nome + '):', e && e.stack || e); } }
const txt = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// "Agora" padrão dos testes: segunda 19/10/2026, 15h em São Paulo.
const AGORA_PADRAO = Date.parse('2026-10-19T15:00:00-03:00');

// Registro no formato de producao_pedidos, já marcado com a operação (o painel de fora marca — seção 101).
// O cadastro chega da API como meia-noite de São Paulo (03:00Z).
const dia = d => d + 'T03:00:00+00:00';
function ped(over){ return Object.assign({
  numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'ANA TESTE', etapa: 'CONCLUIDO (NEOCRM)',
  cadastro: dia('2026-10-01'), atualizacao: '2026-10-19T10:00:00-03:00', criado_em: null,
  valor: 10, quantidade: 1, produto: 'Plano Teste', cliente: 'EMPRESA FICTICIA LTDA', cnpj: null, tag: null, operacao: 'apex',
}, over); }

// Apex, outubro/2026, hoje = 19/10: realizado até ontem 440 (11 dias úteis completos → ritmo 40, mês 840).
const FIX_APEX = [
  ped({ numero_pedido: 'A1', cadastro: dia('2026-10-01'), valor: 100 }),
  ped({ numero_pedido: 'A2', cadastro: dia('2026-10-02'), etapa: 'ENTREGA (NEOCRM)', valor: 60 }),
  ped({ numero_pedido: 'A3', cadastro: dia('2026-10-05'), etapa: 'VALIDAÇÃO ESIM (NEOCRM)', grupo: 'VOZ - Portabilidade', usuario: 'BRUNO TESTE', valor: 40 }),
  ped({ numero_pedido: 'A4', cadastro: dia('2026-10-06'), etapa: 'ANTIFRAUDE (NEOCRM)', grupo: 'VOZ - Tranf. Titularidade', usuario: 'BRUNO TESTE', valor: 80 }),
  ped({ numero_pedido: 'A5', cadastro: dia('2026-10-07'), etapa: 'BIOMETRIA (NEOCRM)', grupo: 'GRUPO NOVO X', valor: 20 }),
  ped({ numero_pedido: 'A6', cadastro: dia('2026-10-08'), etapa: 'TERRITORIO (NEOCRM)', valor: 999 }),          // peso 0
  ped({ numero_pedido: 'A7', cadastro: dia('2026-10-09'), etapa: 'NEGOCIACAO (NEOCRM)', valor: 500 }),          // peso 0
  ped({ numero_pedido: 'A8', cadastro: dia('2026-10-17'), usuario: 'BRUNO TESTE', valor: 35 }),                  // sábado
  ped({ numero_pedido: 'A9', cadastro: dia('2026-10-19'), valor: 50 }),                                          // hoje
  ped({ numero_pedido: 'A10', cadastro: dia('2026-09-30'), valor: 70 }),                                         // setembro
  ped({ numero_pedido: 'M1', cadastro: dia('2026-10-13'), etapa: 'ENTREGA (NEOCRM)', valor: 30 }),               // pedido de 2 linhas
  ped({ numero_pedido: 'M1', cadastro: dia('2026-10-13'), etapa: 'ANTIFRAUDE (NEOCRM)', grupo: 'SVA MÓVEL', valor: 10 }),
  ped({ numero_pedido: 'C1', cadastro: dia('2026-10-14'), grupo: 'BANDA LARGA - Novo', usuario: 'BRUNO TESTE', cnpj: '22222222000100', valor: 100 }), // convergência
  ped({ numero_pedido: 'C2', cadastro: dia('2026-10-14'), etapa: 'BIOMETRIA (NEOCRM)', usuario: 'BRUNO TESTE', cnpj: '22222222000100', valor: 40 }),
];
// Campinas (início 06/10): realizado até ontem 160 (8 dias úteis completos → ritmo 20, mês de 18 dias úteis = 360).
const FIX_CAMP = [
  ped({ numero_pedido: 'K0', cadastro: dia('2026-09-30'), usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 999 }), // antes do início
  ped({ numero_pedido: 'K1', cadastro: dia('2026-10-06'), usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 80 }),
  ped({ numero_pedido: 'K2', cadastro: dia('2026-10-13'), etapa: 'ANTIFRAUDE (NEOCRM)', usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 80 }),
  ped({ numero_pedido: 'K3', cadastro: dia('2026-10-16'), etapa: 'ENTREGA (NEOCRM)', grupo: 'VOZ - Tranf. Titularidade', usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 40 }),
  ped({ numero_pedido: 'K4', cadastro: dia('2026-10-19'), etapa: 'BIOMETRIA (NEOCRM)', usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 60 }),
];

function montarDashboard({ adminMode = true, operacao = 'apex', data = FIX_APEX, agora = AGORA_PADRAO } = {}){
  const html = htmlNoScript
    .replace('__ADMIN_BADGE__', '')
    .replace('__APEX_B64__', '')
    .replace('__CLARO_B64__', '')
    .replace('__UPDATED_AT__', '19/10/2026, 14:59:02');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {};
  w.confirm = () => true;
  const js = jsOriginal
    .replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(data) + ';')
    .replace('__ADMIN_MODE__', adminMode ? 'true' : 'false')
    .replace('__OPERACAO__', JSON.stringify(operacao))
    .replace('function projAgora(){ return Date.now(); }', 'function projAgora(){ return ' + agora + '; }');
  w.eval(js);
  return w;
}

// ---------------- Task 1: pesos, dias úteis e operações ----------------
secao('Task 1', () => {
  const w = montarDashboard();
  assert(w.projPeso('CONCLUIDO (NEOCRM)') === 1 && w.projPeso('ENTREGA (NEOCRM)') === 1, 'Concluído e Entrega = 100%');
  assert(w.projPeso('VALIDAÇÃO ESIM (NEOCRM)') === 1 && w.projFaixa('VALIDAÇÃO ESIM (NEOCRM)').k === 'entrega', 'Validação eSIM = 100%, dentro da faixa Entrega');
  assert(w.projFaixa('VALIDAÇÃO ESIM (NEOCRM)'.normalize('NFD')).k === 'entrega', 'acento em NFD cai na mesma faixa');
  assert(w.projFaixa('  entrega (neocrm) ').k === 'entrega', 'espaços e minúsculas não atrapalham');
  assert(w.projPeso('ANTIFRAUDE (NEOCRM)') === 0.5 && w.projPeso('BIOMETRIA (NEOCRM)') === 0.5, 'Antifraude e Biometria = 50%');
  ['TERRITORIO (NEOCRM)', 'FATURAMENTO (NEOCRM)', 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', 'NEGOCIACAO (NEOCRM)', 'VENDA PERDIDA (NEOCRM)', null, undefined]
    .forEach(e => assert(w.projPeso(e) === 0, 'peso 0 para ' + e));
  assert(w.projFaixa('TERRITORIO (NEOCRM)') === null, 'Território não tem faixa');
  assert(w.projFaixa('CONCLUIDO (NEOCRM)').k === 'concluido' && w.projFaixa('ANTIFRAUDE (NEOCRM)').k === 'antifraude' && w.projFaixa('BIOMETRIA (NEOCRM)').k === 'biometria', 'chaves das faixas');

  // operação escolhida no painel de fora
  assert((tplRaw.match(/__OPERACAO__/g) || []).length === 1, 'o placeholder da operação aparece uma única vez no dashboard');
  assert(w.eval('OPERACAO_SELECIONADA') === 'apex', 'padrão: Apex');
  assert(montarDashboard({ operacao: 'todas' }).eval('OPERACAO_SELECIONADA') === 'todas', 'recebe "todas"');
  assert(montarDashboard({ operacao: 'xpto' }).eval('OPERACAO_SELECIONADA') === 'apex', 'valor desconhecido vira Apex');
  assert(JSON.stringify(w.projOperacoes('todas')) === '["apex","campinas"]' && JSON.stringify(w.projOperacoes('campinas')) === '["campinas"]'
    && JSON.stringify(w.projOperacoes('apex')) === '["apex"]', 'operações de cada seleção');
  assert(w.projOperacaoDaLinha({ operacao: 'campinas' }, 'apex') === 'campinas', 'a marca da linha vence');
  assert(w.projOperacaoDaLinha({}, 'campinas') === 'campinas' && w.projOperacaoDaLinha({}, 'todas') === 'apex', 'linha sem marca: a seleção (ou Apex)');

  // datas (sempre texto AAAA-MM-DD, dia de São Paulo)
  assert(w.projSomaDias('2026-10-30', 3) === '2026-11-02' && w.projSomaDias('2026-10-01', -1) === '2026-09-30', 'projSomaDias vira o mês');
  assert(w.projDiaSemana('2026-10-19') === 1 && w.projDiaSemana('2026-10-17') === 6, 'dia da semana');
  assert(!w.projDiaUtil('2026-10-12') && w.projDiaUtil('2026-10-13') && !w.projDiaUtil('2026-10-17') && !w.projDiaUtil('2026-11-20'), 'feriados e fim de semana não são úteis');
  assert(w.projDiasDoMes('2026-02').length === 28 && w.projDiasDoMes('2026-10')[30] === '2026-10-31', 'dias do mês');
  const dOut = w.projDiasOperacao('apex', '2026-10', '2026-10-19');
  assert(dOut.total === 21 && dOut.completos === 11 && dOut.restantes === 10 && dOut.inicio === null, 'outubro/2026 Apex: 21 úteis, 11 completos em 19/10 — ' + JSON.stringify(dOut));
  const dCamp = w.projDiasOperacao('campinas', '2026-10', '2026-10-19');
  assert(dCamp.total === 18 && dCamp.completos === 8 && dCamp.restantes === 10 && dCamp.uteis[0] === '2026-10-06' && dCamp.inicio === '2026-10-06', 'outubro/2026 Campinas: começa em 06/10, 18 úteis');
  assert(w.projDiasOperacao('apex', '2026-11', '2026-11-01').total === 19, 'novembro/2026: 19 úteis (02/11 e 20/11)');
  assert(w.projDiasOperacao('apex', '2027-02', '2027-02-01').total === 18, 'fevereiro/2027: Carnaval fora (18 úteis)');
  const dSet = w.projDiasOperacao('apex', '2026-09', '2026-10-19');
  assert(dSet.total === 21 && dSet.completos === 21 && dSet.restantes === 0, 'mês fechado: todos completos');
  const s1 = w.projSemanaAtual('2026-10-21');
  assert(s1.de === '2026-10-19' && s1.ate === '2026-10-25', 'semana atual (quarta) = seg 19 a dom 25');
  assert(w.projSemanaAtual('2026-10-19').de === '2026-10-19', 'segunda abre a própria semana');
  const s2 = w.projSemanaAtual('2026-10-24'), s3 = w.projSemanaAtual('2026-10-25');
  assert(s2.de === '2026-10-26' && s2.ate === '2026-11-01' && s3.de === '2026-10-26', 'sábado e domingo: a semana seguinte');
  assert(w.projHoje() === '2026-10-19', 'hoje em São Paulo (relógio controlado pelo teste)');
});

// ---------------- Task 2: núcleo do cálculo ----------------
secao('Task 2', () => {
  const w = montarDashboard();
  const mp = (dados, opcoes) => w.montarProjecao(dados, opcoes);
  const p = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-19', operacao: 'apex' });
  assert(p.linhas.length === 11, 'linhas com peso > 0 em outubro: 11 (sem Território, Negociação e setembro) — ' + p.linhas.length);
  const cs = [...p.contratos.values()];
  assert(cs.length === 9, '9 contratos (M1 = 1, convergência C1+C2 = 1) — ' + cs.length);
  const m1 = cs.find(c => c.linhas.some(l => l.r.numero_pedido === 'M1'));
  assert(m1 && m1.peso === 1 && m1.faixa.k === 'entrega' && m1.linhas.length === 2, 'pedido com 2 linhas: peso do contrato = maior peso, faixa Entrega');
  const conv = cs.find(c => c.chave.indexOf('CONV_22222222000100') >= 0);
  assert(conv && conv.peso === 1 && conv.faixa.k === 'concluido' && conv.linhas.length === 2, 'convergência vira 1 contrato, faixa Concluído');
  assert(p.porOperacao.length === 1 && p.porOperacao[0].op === 'apex', 'uma operação');
  const o = p.porOperacao[0];
  assert(perto(o.realizado.valor, 440) && perto(o.realizado.contratos, 7) && o.realizado.linhas === 7, 'realizado até ontem: R$ 440 e 7 linhas reais (inteiro; ritmo e projeção partem da mesma contagem — sábado 17/10 entra) — ' + JSON.stringify(o.realizado));
  assert(perto(o.hoje.valor, 50) && perto(o.hoje.contratos, 1), 'hoje (parcial) fora do realizado: R$ 50');
  assert(perto(o.ritmo.valor, 40) && perto(o.ritmo.contratos, 7 / 11), 'ritmo = 440 ÷ 11');
  assert(perto(o.mes.valor, 840) && perto(o.mes.contratos, 7 / 11 * 21), 'mês = ritmo × 21');
  assert(o.semana && o.semana.de === '2026-10-19' && o.semana.ate === '2026-10-25' && o.semana.uteis === 5 && perto(o.semana.valor, 200), 'semana (segunda) = ritmo × 5');
  assert(perto(p.total.mes.valor, 840) && perto(p.total.ritmo.valor, 40) && perto(p.total.realizado.valor, 440) && perto(p.total.hoje.valor, 50), 'total = a operação');
  assert(p.total.semana.de === '2026-10-19' && p.total.semana.uteis === 5, 'total da semana com datas');
  assert(p.calendario.total === 21 && p.calendario.completos === 11 && p.fechado === false, 'calendário do mês');

  // quarta-feira: a semana soma o que já entrou nela + ritmo × dias que faltam
  const q = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-21', operacao: 'apex' }).porOperacao[0];
  assert(perto(q.realizado.valor, 490) && q.dias.completos === 13, 'quarta 21/10: 490 em 13 dias');
  assert(perto(q.semana.valor, 50 + 490 / 13 * 3), 'semana na quarta = 50 já realizado + ritmo × 3 — ' + q.semana.valor);
  // sábado: a semana seguinte, inteira projetada
  const sab = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-24', operacao: 'apex' }).porOperacao[0];
  assert(sab.dias.completos === 16 && sab.semana.de === '2026-10-26' && perto(sab.semana.valor, 490 / 16 * 5), 'sábado: 16 dias completos, semana de 26/10 = ritmo × 5');
  // semana que vira o mês: conta os úteis de dezembro com o ritmo de novembro
  const nov = mp([ped({ numero_pedido: 'N1', cadastro: dia('2026-11-03'), valor: 190 })], { mes: '2026-11', hoje: '2026-11-30', operacao: 'apex' }).porOperacao[0];
  assert(nov.dias.total === 19 && nov.dias.completos === 18, 'novembro: 18 de 19 completos em 30/11');
  assert(nov.semana.de === '2026-11-30' && nov.semana.ate === '2026-12-06' && nov.semana.uteis === 5 && perto(nov.semana.valor, 190 / 18 * 5), 'semana 30/11–06/12 com 5 úteis');
  assert(perto(nov.mes.valor, 190 / 18 * 19), 'novembro: mês = ritmo × 19');
  // 1º dia útil: sem ritmo
  const d1 = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-01', operacao: 'apex' });
  assert(d1.porOperacao[0].ritmo === null && d1.porOperacao[0].mes === null && d1.porOperacao[0].semana === null, '1º dia útil: sem ritmo, mês e semana');
  assert(d1.total.ritmo === null && d1.total.mes === null && perto(d1.total.realizado.valor, 0) && perto(d1.total.hoje.valor, 100), '1º dia útil: total sem projeção, hoje = 100');
  // mês fechado
  const set = mp(FIX_APEX, { mes: '2026-09', hoje: '2026-10-19', operacao: 'apex' });
  assert(set.fechado && set.semana === null && set.total.semana === null, 'setembro: mês fechado, sem semana');
  assert(perto(set.total.mes.valor, 70) && perto(set.total.realizado.valor, 70) && perto(set.total.ritmo.valor, 70 / 21), 'mês fechado: projeção = realizado');

  // Apex + Campinas: cada operação com o seu ritmo, total = soma
  const tod = mp(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-19', operacao: 'todas' });
  assert(JSON.stringify(tod.porOperacao.map(x => x.op)) === '["apex","campinas"]', 'duas operações');
  const camp = tod.porOperacao[1];
  assert(camp.dias.total === 18 && perto(camp.realizado.valor, 160) && perto(camp.ritmo.valor, 20) && perto(camp.mes.valor, 360), 'Campinas: 160 em 8 dias, mês 360');
  assert(perto(camp.realizado.contratos, camp.realizado.linhas) && perto(camp.hoje.valor, 30), 'Campinas: linhas reais = base do ritmo, hoje 30');
  assert(perto(tod.total.mes.valor, 1200) && perto(tod.total.ritmo.valor, 60) && perto(tod.total.hoje.valor, 80) && perto(tod.total.semana.valor, 300), 'total = 840 + 360');
  const soCamp = mp(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-19', operacao: 'campinas' });
  assert(soCamp.porOperacao.length === 1 && perto(soCamp.total.realizado.valor, 160) && soCamp.calendario.total === 18, 'só Campinas ignora linhas da Apex');
  // Campinas ainda sem dia útil completo (06/10): a Apex continua projetando
  const t6 = mp(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-06', operacao: 'todas' });
  assert(t6.porOperacao[1].ritmo === null && perto(t6.porOperacao[0].ritmo.valor, 200 / 3), 'em 06/10 Campinas sem ritmo, Apex com 200 ÷ 3');
  assert(perto(t6.total.ritmo.valor, 200 / 3) && perto(t6.total.mes.valor, 200 / 3 * 21), 'total só com a Apex');

  // meses do seletor
  assert(JSON.stringify(w.projMesesDisponiveis(FIX_APEX, 'apex', '2026-10-19')) === '["2026-10","2026-09"]', 'Apex: outubro e setembro');
  assert(JSON.stringify(w.projMesesDisponiveis(FIX_CAMP, 'campinas', '2026-10-19')) === '["2026-10"]', 'Campinas: nada antes do início');
  assert(JSON.stringify(w.projMesesDisponiveis([], 'apex', '2026-10-19')) === '["2026-10"]', 'sem dados: só o mês atual');
});

// ---------------- Task 3: quebras ----------------
secao('Task 3', () => {
  const w = montarDashboard();
  const p = w.montarProjecao(FIX_APEX, { mes: '2026-10', hoje: '2026-10-19', operacao: 'apex' });
  const dd = d => p.dias.find(x => x.data === d);
  assert(p.dias.length === 23, '21 úteis + feriado 12/10 + sábado com venda 17/10 — ' + p.dias.length);
  assert(dd('2026-10-12').tipo === 'feriado' && dd('2026-10-17').tipo === 'naoUtil' && perto(dd('2026-10-17').valor, 35), 'feriado e sábado com venda');
  assert(!dd('2026-10-18'), 'domingo sem venda não aparece');
  assert(dd('2026-10-19').tipo === 'hoje' && perto(dd('2026-10-19').valor, 50), 'hoje parcial');
  assert(dd('2026-10-20').tipo === 'projetado' && perto(dd('2026-10-20').valor, 40) && perto(dd('2026-10-20').contratos, 7 / 11), 'dia futuro = ritmo');
  assert(dd('2026-10-08').tipo === 'realizado' && perto(dd('2026-10-08').valor, 0), 'dia útil só com Território = 0');
  assert(perto(dd('2026-10-01').valor, 100) && perto(dd('2026-10-01').contratos, 1) && dd('2026-10-01').linhas.length === 1, 'dia com 1 pedido');
  assert(dd('2026-10-14').linhas.length === 2 && perto(dd('2026-10-14').contratos, 1), 'convergência: 2 linhas (BL + móvel), só a linha móvel conta (1 linha, inteira) e não há mais contrato');

  const sem = p.semanas;
  assert(sem.length === 5, '5 semanas — ' + sem.length);
  const esperado = [
    ['2026-10-01', '2026-10-04', 2, 'fechada', 160, 2], ['2026-10-05', '2026-10-11', 5, 'fechada', 90, 2],
    ['2026-10-12', '2026-10-18', 4, 'fechada', 190, 3], ['2026-10-19', '2026-10-25', 5, 'atual', 200, 7 / 11 * 5],
    ['2026-10-26', '2026-10-31', 5, 'futura', 200, 7 / 11 * 5],
  ];
  esperado.forEach((e, i) => {
    const s = sem[i];
    assert(s && s.de === e[0] && s.ate === e[1] && s.diasUteis === e[2] && s.tipo === e[3] && perto(s.valor, e[4]) && perto(s.contratos, e[5]),
      'semana ' + i + ': ' + JSON.stringify(s && { de: s.de, ate: s.ate, diasUteis: s.diasUteis, tipo: s.tipo, valor: s.valor, contratos: s.contratos }));
  });
  assert(perto(sem.reduce((a, s) => a + s.valor, 0), 840), 'a soma das semanas é a projeção do mês');

  const c = p.consultores;
  assert(c.length === 2 && c[0].usuario === 'BRUNO TESTE' && c[1].usuario === 'ANA TESTE', 'maior projeção primeiro');
  assert(perto(c[0].valor, 235) && perto(c[0].contratos, 4) && perto(c[0].ritmo, 235 / 11) && perto(c[0].projMes, 235 / 11 * 21) && perto(c[0].projContratos, 4 / 11 * 21), 'Bruno');
  assert(c[0].linhas.length === 5 && c[0].operacao === 'apex', 'Bruno: 5 linhas até ontem');
  assert(perto(c[1].valor, 205) && c[1].linhas.length === 5, 'Ana: 205 (hoje fora)');

  // (a projeção por tipo de venda tem a seção própria logo abaixo: "Tipos de venda")

  const e = k => p.etapas.find(x => x.k === k);
  assert(JSON.stringify(p.etapas.map(x => x.k)) === '["concluido","entrega","antifraude","biometria"]', 'etapas na ordem');
  assert(e('concluido').contratos === 2 && perto(e('concluido').bruto, 235) && perto(e('concluido').valor, 235), 'Concluído: 2 linhas móveis (A1, A8); a BL da convergência não conta como linha, mas o R$ sim');
  assert(e('entrega').contratos === 3 && perto(e('entrega').valor, 130), 'Entrega + eSIM: A2, A3 e M1');
  assert(e('antifraude').contratos === 1 && perto(e('antifraude').bruto, 90) && perto(e('antifraude').valor, 45), 'Antifraude: bruto 90, ponderado 45');
  assert(e('biometria').contratos === 1 && perto(e('biometria').bruto, 60) && perto(e('biometria').valor, 30), 'Biometria: bruto 60, ponderado 30');
  assert(perto(p.etapas.reduce((a, x) => a + x.valor, 0), 440) && p.etapas.reduce((a, x) => a + x.contratos, 0) === 7, 'etapas somam 440 e 7 linhas móveis');

  const camp = w.montarProjecao(FIX_CAMP, { mes: '2026-10', hoje: '2026-10-19', operacao: 'campinas' });
  assert(camp.dias[0].data === '2026-10-06', 'Campinas: gráfico começa em 06/10');
  assert(camp.semanas.length === 4 && camp.semanas[0].de === '2026-10-05' && camp.semanas[0].diasUteis === 4, 'Campinas: 4 semanas, a 1ª com 4 úteis');
  assert(perto(camp.semanas.reduce((a, s) => a + s.valor, 0), 360), 'Campinas: semanas somam 360');
  const tod = w.montarProjecao(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-19', operacao: 'todas' });
  const carla = tod.consultores.find(x => x.usuario === 'CARLA CAMPINAS');
  assert(tod.consultores.length === 3 && carla.operacao === 'campinas' && perto(carla.projMes, 360), 'Apex + Campinas: Carla com os dias de Campinas');
  assert(perto(tod.semanas.reduce((a, s) => a + s.valor, 0), 1200), 'Apex + Campinas: semanas somam 1200');
});

// ---------------- Tipos de venda (20/10/2026, seção 101.7) ----------------
// Cada tipo: linhas (cada linha vale o peso da etapa) e R$, com ritmo, semana e mês calculados por operação como os cards.
secao('Tipos de venda', () => {
  const w = montarDashboard();
  const mp = (dados, opcoes) => w.montarProjecao(dados, opcoes);
  const par = (x, valor, qtd) => !!x && perto(x.valor, valor) && perto(x.qtd, qtd);
  const p = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-19', operacao: 'apex' });
  const t = g => p.tipos.find(x => x.grupo === g);
  assert(JSON.stringify(p.tipos.map(x => x.grupo)) === JSON.stringify(['VOZ - Novo', 'BANDA LARGA - Novo', 'VOZ - Tranf. Titularidade', 'VOZ - Portabilidade',
    'GRUPO NOVO X', 'SVA MÓVEL', 'VOZ - Renovação', 'APARELHO', 'SVA FIXA']), 'maior projeção primeiro, os 3 zerados no fim na ordem da Visão Diária — ' + JSON.stringify(p.tipos.map(x => x.grupo)));
  assert(JSON.stringify(p.tipos.map(x => x.label)) === JSON.stringify(['Linha Nova', 'Banda Larga', 'Migração (Transf. Titularidade)', 'Portabilidade',
    'GRUPO NOVO X', 'Claro Monitor (SVA Móvel)', 'Renovação', 'Aparelho', 'Telefone fixo (SVA Fixa)']), 'rótulos por extenso — ' + JSON.stringify(p.tipos.map(x => x.label)));
  const novo = t('VOZ - Novo');
  assert(par(novo.realizado, 245, 5), 'Linha Nova até ontem: R$ 245 em 5 linhas reais (inteiro; o peso de 50% da Biometria só entra na projeção) — ' + JSON.stringify(novo.realizado));
  assert(par(novo.ritmo, 245 / 11, 5 / 11) && par(novo.mes, 245 / 11 * 21, 5 / 11 * 21), 'Linha Nova: ritmo ÷ 11 e mês × 21');
  assert(par(novo.semana, 245 / 11 * 5, 5 / 11 * 5), 'Linha Nova: semana na segunda = ritmo × 5');
  assert(novo.linhas.length === 5 && !novo.zero, 'Linha Nova: 5 linhas no analítico (hoje fora)');
  assert(par(t('VOZ - Tranf. Titularidade').realizado, 40, 1) && par(t('SVA MÓVEL').realizado, 5, 1) && par(t('BANDA LARGA - Novo').realizado, 100, 1), 'TT, Claro Monitor e Banda Larga');
  assert(par(t('GRUPO NOVO X').realizado, 10, 1), 'grupo fora da lista aparece pelo nome');
  const ren = t('VOZ - Renovação');
  assert(ren.zero && par(ren.realizado, 0, 0) && par(ren.mes, 0, 0) && par(ren.semana, 0, 0) && ren.linhas.length === 0, 'tipo sem venda aparece zerado');
  const tot = w.projTotalTipos(p.tipos);
  assert(par(tot.realizado, 440, 10) && perto(tot.ritmo.valor, 40) && perto(tot.semana.valor, 200) && perto(tot.mes.valor, 840), 'total em R$ bate com os cards — ' + JSON.stringify(tot));
  assert(perto(tot.mes.qtd, 10 / 11 * 21), 'total de linhas do mês');
  const comTerritorio = mp(FIX_APEX.concat([ped({ numero_pedido: 'T1', grupo: 'NET - TV', etapa: 'TERRITORIO (NEOCRM)', cadastro: dia('2026-10-08') })]),
    { mes: '2026-10', hoje: '2026-10-19', operacao: 'apex' });
  assert(!comTerritorio.tipos.some(x => x.grupo === 'NET - TV'), 'grupo fora da lista só com etapa de peso 0 não aparece');

  // quarta-feira: a semana do tipo soma o que já entrou nela
  const q = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-21', operacao: 'apex' });
  const qn = q.tipos.find(x => x.grupo === 'VOZ - Novo');
  assert(par(qn.realizado, 295, 6) && par(qn.semana, 50 + 295 / 13 * 3, 1 + 6 / 13 * 3), 'quarta 21/10: semana = 19/10 + ritmo × 3 — ' + JSON.stringify(qn.semana));
  assert(perto(w.projTotalTipos(q.tipos).semana.valor, q.total.semana.valor), 'quarta: semana dos tipos = card da semana');

  // semana que começa no mês anterior: a venda de 30/11 entra na semana de dezembro, não no mês
  const dez = mp([
    ped({ numero_pedido: 'N30', cadastro: dia('2026-11-30'), grupo: 'VOZ - Portabilidade', valor: 70 }),
    ped({ numero_pedido: 'N31', cadastro: dia('2026-11-30'), grupo: 'GRUPO SO SEMANA', valor: 10 }),
    ped({ numero_pedido: 'D1', cadastro: dia('2026-12-01'), valor: 30 }),
  ], { mes: '2026-12', hoje: '2026-12-02', operacao: 'apex' });
  const diasDez = w.projDiasOperacao('apex', '2026-12', '2026-12-02');
  const dt = g => dez.tipos.find(x => x.grupo === g);
  assert(diasDez.completos === 1 && dez.semana.de === '2026-11-30', 'dezembro: 1 dia completo, semana desde 30/11');
  assert(par(dt('VOZ - Novo').semana, 30 + 30 * 3, 1 + 3) && par(dt('VOZ - Novo').mes, 30 * diasDez.total, diasDez.total), 'Linha Nova em dezembro');
  assert(par(dt('VOZ - Portabilidade').realizado, 0, 0) && par(dt('VOZ - Portabilidade').semana, 70, 1) && !dt('VOZ - Portabilidade').zero, 'Portabilidade só na semana: não é zerado');
  assert(dt('GRUPO SO SEMANA') && par(dt('GRUPO SO SEMANA').semana, 10, 1), 'grupo fora da lista com venda só na semana aparece');
  assert(dez.tipos[0].grupo === 'VOZ - Novo' && perto(w.projTotalTipos(dez.tipos).semana.valor, dez.total.semana.valor), 'dezembro: semana dos tipos = card (200)');

  // 1º dia útil: sem ritmo, os 8 tipos zerados com "—"
  const d1 = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-01', operacao: 'apex' });
  assert(d1.tipos.length === 8 && d1.tipos.every(x => x.zero && x.ritmo === null && x.semana === null && x.mes === null), '1º dia útil: 8 tipos sem projeção');
  const tot1 = w.projTotalTipos(d1.tipos);
  assert(par(tot1.realizado, 0, 0) && tot1.mes === null && tot1.semana === null && tot1.ritmo === null, '1º dia útil: total sem projeção');
  // mês fechado: mês = realizado, sem semana
  const set = mp(FIX_APEX, { mes: '2026-09', hoje: '2026-10-19', operacao: 'apex' });
  const sn = set.tipos.find(x => x.grupo === 'VOZ - Novo');
  assert(par(sn.mes, 70, 1) && par(sn.ritmo, 70 / 21, 1 / 21) && sn.semana === null && set.tipos.every(x => x.semana === null), 'setembro fechado: mês = realizado');

  // Apex + Campinas: cada operação com o seu ritmo, somadas
  const tod = mp(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-19', operacao: 'todas' });
  const tn = tod.tipos.find(x => x.grupo === 'VOZ - Novo'), tt = tod.tipos.find(x => x.grupo === 'VOZ - Tranf. Titularidade');
  assert(par(tn.realizado, 365, 7) && par(tn.mes, 245 / 11 * 21 + 120 / 8 * 18, 5 / 11 * 21 + 2 / 8 * 18), 'Linha Nova: Apex ÷ 11 × 21 + Campinas ÷ 8 × 18');
  assert(par(tn.semana, 245 / 11 * 5 + 120 / 8 * 5, 5 / 11 * 5 + 2 / 8 * 5) && tn.linhas.length === 7, 'Linha Nova: semana das duas e 7 linhas no analítico');
  assert(par(tt.mes, 40 / 11 * 21 + 40 / 8 * 18, 1 / 11 * 21 + 1 / 8 * 18), 'TT das duas operações');
  const tTod = w.projTotalTipos(tod.tipos);
  assert(perto(tTod.mes.valor, 1200) && perto(tTod.semana.valor, 300) && perto(tTod.ritmo.valor, 60) && perto(tTod.realizado.valor, 600), 'Apex + Campinas: total = cards');
  // 06/10: Campinas ainda sem dia completo fica fora, como nos cards
  const t6 = mp(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-06', operacao: 'todas' });
  assert(perto(w.projTotalTipos(t6.tipos).mes.valor, t6.total.mes.valor), 'em 06/10 o total dos tipos = card (só Apex)');
});

// ---------------- Task 4: tela ----------------
secao('Task 4', () => {
  const w = montarDashboard();
  const d = w.document;
  const btn = d.querySelector('.tabs [data-tab="projecao"]');
  assert(!!btn && btn.textContent === 'Projeção de Ganho', 'botão da sub-aba para admin/supervisor');
  assert(btn && btn.previousElementSibling && btn.previousElementSibling.dataset.tab === 'perdidas', 'logo depois de Vendas Perdidas');
  w.switchTab('projecao');
  assert(d.getElementById('tabProjecao').classList.contains('active') && d.body.classList.contains('tab-projecao'), 'switchTab abre a sub-aba e esconde os filtros');
  assert(txt(d.getElementById('projTitulo').textContent) === 'Projeção de Ganho · Operação Apex', 'título com a operação');
  const opts = [...d.querySelectorAll('#projMes option')].map(o => o.value);
  assert(JSON.stringify(opts) === '["2026-10","2026-09"]' && d.getElementById('projMes').value === '2026-10', 'seletor de mês abre no mês atual');
  assert(/Antifraude 50%/.test(txt(d.getElementById('projRegra').textContent)) && /Demais etapas 0%/.test(txt(d.getElementById('projRegra').textContent)), 'selos da regra');

  const cards = [...d.querySelectorAll('#projCards .card')];
  const lab = i => txt(cards[i].querySelector('.label').textContent), val = i => txt(cards[i].querySelector('.value').textContent), sub = i => txt(cards[i].querySelector('.proj-card-sub').textContent);
  assert(cards.length === 4, '4 cards');
  assert(lab(0) === 'Projeção do mês · 21 dias úteis' && val(0) === 'R$ 840,00' && cards[0].classList.contains('proj-hero'), 'card do mês: ' + lab(0) + ' / ' + val(0));
  assert(lab(1) === 'Projeção da semana · 19/10 a 23/10' && val(1) === 'R$ 200,00' && /5 dias úteis/.test(sub(1)), 'card da semana: ' + lab(1) + ' / ' + val(1));
  assert(val(2) === 'R$ 40,00' && /linhas por dia/.test(sub(2)), 'card diário');
  assert(val(3) === 'R$ 440,00' && /7 linhas até ontem/.test(sub(3)) && /hoje \(parcial\): R\$ 50,00/.test(sub(3)), 'card realizado: ' + sub(3));
  // seção 115: os demais itens têm projeção própria (BL, Sol. Digitais, grupos novos) e não entram na conta das linhas
  assert(/Outros:/.test(sub(3)) && /1 BLs/.test(sub(3)) && /Sol\. Digitais/.test(sub(3)), 'card realizado lista os outros itens separados: ' + sub(3));
  assert(!/contratos/.test(sub(0) + sub(1) + sub(2) + sub(3)), 'nenhum quadro fala mais em contratos');
  const prog = txt(d.getElementById('projProgresso').textContent);
  assert(/52,4% da projeção do mês já realizado/.test(prog) && /11 de 21 dias úteis completos · faltam 10 \(com hoje\)/.test(prog), 'barra de progresso: ' + prog);

  assert(d.querySelectorAll('#projDias .proj-col').length === 23, '23 barras');
  assert(d.querySelectorAll('#projDias .proj-hoje').length === 1 && d.querySelectorAll('#projDias .proj-projetado').length === 9, 'hoje + 9 projetadas');
  assert(d.querySelectorAll('#projDias .proj-feriado').length === 1 && d.querySelectorAll('#projDias .proj-naoUtil').length === 1, 'feriado e sábado');
  assert(/ritmo R\$ 40,00/.test(txt(d.querySelector('#projDias .proj-ritmo').textContent)), 'linha do ritmo');

  const semRows = d.querySelectorAll('#projSemanas tbody tr');
  assert(semRows.length === 6 && /01\/10–04\/10/.test(txt(semRows[0].textContent)) && /R\$ 160,00/.test(txt(semRows[0].textContent)), 'semanas + total');
  assert(semRows[3].classList.contains('proj-atual') && /R\$ 840,00/.test(txt(semRows[5].textContent)), 'semana atual marcada e total do mês');
  const etRows = d.querySelectorAll('#projEtapas tbody tr');
  assert(etRows.length === 5 && /Concluído/.test(etRows[0].textContent) && /R\$ 235,00/.test(txt(etRows[0].textContent)) && /100%/.test(etRows[0].textContent), 'etapas: Concluído');
  assert(/Antifraude/.test(etRows[2].textContent) && /50%/.test(etRows[2].textContent) && /R\$ 45,00/.test(txt(etRows[2].textContent)), 'etapas: Antifraude');
  const coRows = d.querySelectorAll('#projConsultores tbody tr');
  assert(!/Operação/.test(d.querySelector('#projConsultores thead').textContent), 'sem coluna Operação numa operação só');
  assert(coRows.length === 2 && /BRUNO TESTE/.test(coRows[0].textContent) && /R\$ 448,64/.test(txt(coRows[0].textContent)), 'consultores: Bruno primeiro');
  // projeção por tipo de venda: logo depois da barra de progresso, antes do Dia a dia (a tabela antiga do fim saiu)
  const tabTipos = d.getElementById('projTipos');
  assert(d.querySelectorAll('#projTipos').length === 1 && tabTipos.classList.contains('proj-tipos'), 'uma tabela de tipos, com rolagem no celular');
  assert(d.getElementById('projProgresso').compareDocumentPosition(tabTipos) & 4 && tabTipos.compareDocumentPosition(d.getElementById('projDias')) & 4,
    'tabela de tipos entre a barra de progresso e o Dia a dia');
  assert(/Projeção por tipo de venda/.test(d.getElementById('tabProjecao').textContent), 'título da seção');
  assert(/19\/10 a 23\/10/.test(d.getElementById('projTiposSub').textContent) && !/cada operação/.test(d.getElementById('projTiposSub').textContent), 'subtítulo com a semana');
  const cabTipos = txt(tabTipos.querySelector('thead').textContent);
  assert(/Realizado \(até ontem\)/.test(cabTipos) && /Ritmo \/ dia útil/.test(cabTipos) && /Projeção semana/.test(cabTipos) && /Projeção mês/.test(cabTipos), 'cabeçalho: ' + cabTipos);
  const tiRows = d.querySelectorAll('#projTipos tbody tr');
  const celulas = tr => [...tr.querySelectorAll('td')].map(c => txt(c.textContent));
  assert(tiRows.length === 10, '9 tipos + total — ' + tiRows.length);
  assert(JSON.stringify(celulas(tiRows[0])) === JSON.stringify(['Linha Nova', '5', 'R$ 245,00', '0,5', 'R$ 22,27', '2', 'R$ 111,36', '10', 'R$ 467,73']),
    'linha da Linha Nova: ' + JSON.stringify(celulas(tiRows[0])));
  assert(tiRows[6].classList.contains('proj-zero') && !tiRows[6].hasAttribute('data-proj') && celulas(tiRows[6])[0] === 'Renovação', 'tipo zerado em cinza, sem clique');
  assert(tiRows[9].classList.contains('proj-total') && JSON.stringify(celulas(tiRows[9]).slice(1)) === JSON.stringify(['10', 'R$ 440,00', '0,9', 'R$ 40,00', '5', 'R$ 200,00', '19', 'R$ 840,00']),
    'total: ' + JSON.stringify(celulas(tiRows[9])));
  tiRows[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(d.getElementById('drilldownTitle').textContent === 'Projeção — Linha Nova' && /^5 linha\(s\)/.test(d.getElementById('drilldownSub').textContent), 'analítico do tipo');
  assert(d.getElementById('projOperacoesBloco').style.display === 'none', 'quadro Por operação escondido numa operação só');

  // clique abre o analítico com os pedidos por trás do número (o texto do analítico diz quantas linhas)
  coRows[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(d.getElementById('drilldownTitle').textContent === 'Projeção — BRUNO TESTE' && /^5 linha\(s\)/.test(d.getElementById('drilldownSub').textContent), 'analítico do consultor');
  d.querySelector('#projDias [data-proj="dia:2026-10-14"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(/^2 linha\(s\)/.test(d.getElementById('drilldownSub').textContent), 'analítico do dia 14/10');

  // mês fechado
  d.getElementById('projMes').value = '2026-09';
  w.renderProjecaoSeguro();
  const c2 = [...d.querySelectorAll('#projCards .card')];
  assert(txt(c2[0].querySelector('.label').textContent) === 'Mês fechado · 21 dias úteis' && txt(c2[0].querySelector('.value').textContent) === 'R$ 70,00', 'setembro fechado');
  assert(txt(c2[1].querySelector('.value').textContent) === '—', 'sem semana em mês fechado');
  const cabFechado = txt(d.querySelector('#projTipos thead').textContent);
  assert(/Mês fechado/.test(cabFechado) && /Média \/ dia útil/.test(cabFechado), 'tipos em mês fechado: ' + cabFechado);
  const novoSet = [...d.querySelectorAll('#projTipos tbody tr')[0].querySelectorAll('td')].map(c => txt(c.textContent));
  assert(novoSet[0] === 'Linha Nova' && novoSet[5] === '—' && novoSet[6] === '—' && novoSet[8] === 'R$ 70,00', 'tipos em mês fechado: semana "—", mês = realizado — ' + JSON.stringify(novoSet));
  // atualização de 1 h mantém o mês escolhido
  w.atualizarDadosDashboard(FIX_APEX.concat([ped({ numero_pedido: 'A11', cadastro: dia('2026-10-16'), valor: 110 })]), '19/10/2026, 15:59:02');
  assert(d.getElementById('projMes').value === '2026-09', 'atualização de 1 h não troca o mês escolhido');
  d.getElementById('projMes').value = '2026-10';
  w.renderProjecaoSeguro();
  assert(txt(d.querySelector('#projCards .card .value').textContent) === 'R$ 1.050,00', 'dados novos entram na projeção (550 ÷ 11 × 21)');

  // Apex + Campinas
  const wt = montarDashboard({ operacao: 'todas', data: FIX_APEX.concat(FIX_CAMP) });
  const dt = wt.document;
  assert(txt(dt.getElementById('projTitulo').textContent) === 'Projeção de Ganho · Apex + Campinas', 'título Apex + Campinas');
  assert(txt(dt.querySelector('#projCards .card .value').textContent) === 'R$ 1.200,00', 'mês das duas = 1.200');
  assert(dt.getElementById('projOperacoesBloco').style.display === '' && dt.querySelectorAll('#projOperacoes tbody tr').length === 2, 'quadro Por operação');
  const linhaCamp = txt(dt.querySelectorAll('#projOperacoes tbody tr')[1].textContent);
  assert(/Campinas/.test(linhaCamp) && /desde 06\/10/.test(linhaCamp) && /R\$ 360,00/.test(linhaCamp), 'linha de Campinas: ' + linhaCamp);
  assert(/Operação/.test(dt.querySelector('#projConsultores thead').textContent) && dt.querySelectorAll('#projConsultores tbody tr').length === 3, 'consultores com a coluna Operação');
  assert(/cada operação com o seu/.test(dt.getElementById('projTiposSub').textContent), 'subtítulo dos tipos em Apex + Campinas');
  const totTod = [...dt.querySelector('#projTipos tr.proj-total').querySelectorAll('td')].map(c => txt(c.textContent));
  assert(totTod[8] === 'R$ 1.200,00' && totTod[2] === 'R$ 600,00', 'tipos em Apex + Campinas: total 1.200 — ' + JSON.stringify(totTod));
  // Jaime: só Campinas
  const wc = montarDashboard({ operacao: 'campinas', data: FIX_CAMP });
  const cc = wc.document.querySelector('#projCards .card');
  assert(txt(cc.querySelector('.value').textContent) === 'R$ 360,00' && /18 dias úteis/.test(cc.querySelector('.label').textContent), 'Campinas: 360 em 18 dias úteis');
  assert(JSON.stringify([...wc.document.querySelectorAll('#projMes option')].map(o => o.value)) === '["2026-10"]', 'Campinas: sem meses antes do início');
  // consultor: a sub-aba não existe
  const wn = montarDashboard({ adminMode: false });
  assert(!wn.document.getElementById('tabProjecao') && !wn.document.querySelector('[data-tab="projecao"]'), 'consultor não vê a sub-aba');
  // 1º dia útil e Campinas sem dia completo
  const w1 = montarDashboard({ agora: Date.parse('2026-10-01T10:00:00-03:00') });
  const k1 = w1.document.querySelector('#projCards .card');
  assert(txt(k1.querySelector('.value').textContent) === '—' && /a projeção começa no 2º dia útil/.test(k1.textContent), '1º dia útil sem projeção');
  const w6 = montarDashboard({ operacao: 'todas', data: FIX_APEX.concat(FIX_CAMP), agora: Date.parse('2026-10-06T10:00:00-03:00') });
  assert(/Operação Campinas ainda sem dia útil completo/.test(w6.document.getElementById('projMsg').textContent), 'aviso de Campinas sem dia completo');
});

// ---------------- Task 5: Excel ----------------
// ExcelJS do Node só pra RELER o arquivo. Quem GERA é o bundle de navegador (o mesmo do cdnjs) carregado no jsdom.
async function testarExcel(){
  const ExcelJS = require('exceljs');
  const bundle = fs.readFileSync(require.resolve('exceljs/dist/exceljs.min.js'), 'utf8');
  const baixar = async (w) => {
    let baixado = null;
    w.baixarArquivo = (buffer, nome) => { baixado = { buffer, nome }; };
    await w.exportarProjecaoExcel();
    const wb = new ExcelJS.Workbook();
    if(baixado) await wb.xlsx.load(Buffer.from(baixado.buffer));
    return { nome: baixado && baixado.nome, wb };
  };
  const w = montarDashboard();
  w.eval(bundle);
  const { nome, wb } = await baixar(w);
  assert(nome === 'ProjecaoGanho_Apex_2026-10.xlsx', 'nome do arquivo: ' + nome);
  assert(JSON.stringify(wb.worksheets.map(s => s.name)) === JSON.stringify(['Resumo', 'Dia a dia', 'Semana a semana', 'Por consultor', 'Por tipo de venda', 'Por etapa', 'Pedidos']), '7 abas');
  const r = wb.getWorksheet('Resumo');
  assert(String(r.getCell('A1').value) === 'Projeção de Ganho — Operação Apex — Outubro/2026', 'título: ' + r.getCell('A1').value);
  assert(String(r.getCell('A2').value).indexOf('Base de 19/10/2026, 14:59:02') === 0, 'linha 2 com a base');
  assert(r.getCell('A3').value === 'Indicador' && r.getCell('A3').fill.fgColor.argb === 'FF1D1F20' && r.getCell('A3').font.color.argb === 'FFFFFFFF', 'cabeçalho grafite');
  assert(r.views[0] && r.views[0].state === 'frozen' && r.views[0].ySplit === 3, 'cabeçalho congelado');
  assert(r.getCell('A4').value === 'Projeção do mês' && perto(r.getCell('B4').value, 840) && String(r.getCell('B4').numFmt).indexOf('R$') >= 0, 'projeção do mês em R$');
  assert(perto(r.getCell('B5').value, 200) && perto(r.getCell('B6').value, 40) && perto(r.getCell('B7').value, 440) && perto(r.getCell('B8').value, 50), 'semana, dia, realizado e hoje');
  assert(r.getCell('A9').value === 'Dias úteis do mês' && r.getCell('B9').value === 21 && r.getCell('B9').numFmt === '0', 'dias úteis como número');
  const dd = wb.getWorksheet('Dia a dia');
  assert(dd.actualRowCount === 3 + 23, '23 dias');
  assert(dd.getCell('A4').value instanceof Date && dd.getCell('A4').value.getUTCDate() === 1 && dd.getCell('A4').numFmt === 'dd/mm/yyyy', 'data real do Excel');
  let linhaProj = null;
  dd.eachRow((row, n) => { if(n > 3 && row.getCell(3).value === 'projetado' && !linhaProj) linhaProj = row; });
  assert(linhaProj && linhaProj.getCell(1).font && linhaProj.getCell(1).font.italic === true && perto(linhaProj.getCell(4).value, 40), 'dia projetado em itálico com o ritmo');
  const ss = wb.getWorksheet('Semana a semana');
  assert(ss.actualRowCount === 3 + 5 + 1 && ss.getCell('A9').value === 'Mês' && perto(ss.getCell('D9').value, 840), 'semanas + linha do mês');
  const et = wb.getWorksheet('Por etapa');
  assert(et.getCell('A4').value === 'Concluído' && et.getCell('D4').value === 1 && et.getCell('D4').numFmt === '0%' && et.getCell('D4').fill.fgColor.argb === 'FF1F7A45', 'peso 100% verde');
  assert(et.getCell('D6').value === 0.5 && et.getCell('D6').fill.fgColor.argb === 'FFEAB308', 'peso 50% amarelo');
  const pe = wb.getWorksheet('Pedidos');
  assert(pe.actualRowCount === 3 + 10, '10 pedidos (M1 numa linha só, C1 e C2 separados)');
  let m1 = null, c1 = null, a9 = null;
  pe.eachRow((row, n) => { const v = row.getCell(1).value; if(v === 'M1') m1 = row; if(v === 'C1') c1 = row; if(v === 'A9') a9 = row; });
  assert(m1 && perto(m1.getCell(8).value, 40) && m1.getCell(9).value === 1 && perto(m1.getCell(10).value, 35), 'M1: bruto 40, peso 100%, ponderado 35');
  assert(m1 && m1.getCell(4).value === 'Linha Nova + Claro Monitor (SVA Móvel)' && m1.getCell(5).value === 'ENTREGA + ANTIFRAUDE', 'M1: tipos e etapas juntos');
  const ti = wb.getWorksheet('Por tipo de venda');
  const cabTi = []; ti.getRow(3).eachCell(c => cabTi.push(c.value));
  assert(JSON.stringify(cabTi) === JSON.stringify(['Tipo', 'Grupo no NeoCRM', 'Linhas até ontem', 'R$ até ontem', 'Linhas / dia útil', 'R$ / dia útil',
    'Linhas semana', 'R$ semana', 'Linhas mês', 'R$ mês']), 'Excel: colunas dos tipos — ' + JSON.stringify(cabTi));
  assert(ti.getCell('A4').value === 'Linha Nova' && ti.getCell('B4').value === 'VOZ - Novo' && ti.getCell('C4').value === 5 && perto(ti.getCell('D4').value, 245),
    'Excel: Linha Nova realizado');
  assert(Math.abs(ti.getCell('E4').value - 5 / 11) < 0.06 && perto(ti.getCell('F4').value, 245 / 11) && perto(ti.getCell('H4').value, 245 / 11 * 5) && perto(ti.getCell('J4').value, 245 / 11 * 21),
    'Excel: Linha Nova ritmo, semana e mês');
  assert(ti.getCell('C4').numFmt === '0' && ti.getCell('E4').numFmt === '0.0' && String(ti.getCell('J4').numFmt).indexOf('R$') >= 0, 'Excel: linhas inteiras, taxa com 1 casa, R$ como moeda');
  assert(ti.actualRowCount === 3 + 9 + 1 && ti.getCell('A13').value === 'Total' && perto(ti.getCell('D13').value, 440) && perto(ti.getCell('J13').value, 840)
    && ti.getCell('A13').font && ti.getCell('A13').font.bold === true, 'Excel: 9 tipos + total em negrito');
  assert(c1 && c1.getCell(12).value === '22222222000100' && c1.getCell(12).numFmt === '@' && c1.getCell(1).numFmt === '@', 'nº e CNPJ como texto');
  assert(a9 && a9.getCell(7).value === 'hoje (parcial)', 'pedido de hoje marcado como parcial');
  // revisão final: coluna em R$ larga o bastante para "R$ 2.518,92" (o Excel mostraria ####)
  [['Dia a dia', 4], ['Semana a semana', 4], ['Por etapa', 3], ['Por etapa', 5], ['Pedidos', 8], ['Resumo', 2], ['Por tipo de venda', 4], ['Por tipo de venda', 10]].forEach(([aba, col]) => {
    const largura = wb.getWorksheet(aba).getColumn(col).width;
    assert(largura >= 14, 'coluna em R$ com largura >= 14 em ' + aba + ' (coluna ' + col + '): ' + largura);
  });

  const wt = montarDashboard({ operacao: 'todas', data: FIX_APEX.concat(FIX_CAMP) });
  wt.eval(bundle);
  const t = await baixar(wt);
  assert(t.nome === 'ProjecaoGanho_ApexCampinas_2026-10.xlsx', 'arquivo das duas operações: ' + t.nome);
  assert(t.wb.getWorksheet('Por consultor').getCell('B3').value === 'Operação', 'coluna Operação no Excel');
  let campRow = null;
  t.wb.getWorksheet('Resumo').eachRow(row => { if(row.getCell(1).value === 'Projeção do mês — Campinas') campRow = row; });
  assert(campRow && perto(campRow.getCell(2).value, 360), 'Resumo com a projeção de cada operação');

  // falha ao carregar a biblioteca: aviso e botão reabilitado
  w.carregarExcelJS = () => Promise.reject(new Error('sem internet'));
  const errOrig = w.console.error; w.console.error = () => {};
  await w.exportarProjecaoExcel();
  w.console.error = errOrig;
  assert(/Não foi possível gerar o Excel/.test(w.document.getElementById('projMsg').textContent), 'aviso quando a ExcelJS não carrega');
  assert(w.document.getElementById('projExportBtn').disabled === false, 'botão volta a ficar habilitado');
}

// ---------------- Task 6: painel de fora ----------------
secao('Task 6', () => {
  const iOp = outerHtml.indexOf("tpl = tpl.replace('__OPERACAO__', () => JSON.stringify(operacaoAtiva()));");
  const iData = outerHtml.indexOf("tpl = tpl.replace('__DATA__'");
  assert(iOp > 0 && iData > iOp, 'loadProducaoDashboard preenche a operação antes dos pedidos');
  assert(/"__OPERACAO__"/.test(fs.readFileSync('build_painel.py', 'utf8')), 'build_painel.py aceita o placeholder da operação');
  assert(/filter\(r => daOperacao\(r\.usuario, op\)\)/.test(outerHtml), 'Fechamento usa daOperacao (aceita "todas")');
  assert(/if\(operacaoAtiva\(\) !== 'apex' && frame\)/.test(outerHtml), 'Boletim volta o Dashboard para a Apex também a partir de "Apex + Campinas"');
  assert((outerHtml.match(/data-operacao="todas">Apex \+ Campinas</g) || []).length === 2, 'botão "Apex + Campinas" nos dois seletores');
});

// ---------------- Revisão final: virada do mês com o painel aberto ----------------
secao('Revisão: virada do mês', () => {
  // painel aberto em 30/10 sem mexer no seletor: na atualização de 1 h de 02/11, a aba passa para novembro
  const w = montarDashboard({ agora: Date.parse('2026-10-30T18:00:00-03:00') });
  const d = w.document;
  assert(d.getElementById('projMes').value === '2026-10', 'abre em outubro');
  w.projAgora = () => Date.parse('2026-11-02T09:00:00-03:00');
  w.atualizarDadosDashboard(FIX_APEX, '02/11/2026, 08:59:02');
  assert(d.getElementById('projMes').value === '2026-11', 'quem estava no mês atual acompanha a virada — ' + d.getElementById('projMes').value);
  // escolha explícita de outro mês continua valendo depois da virada
  const w2 = montarDashboard({ agora: Date.parse('2026-10-30T18:00:00-03:00') });
  w2.document.getElementById('projMes').value = '2026-09';
  w2.renderProjecaoSeguro();
  w2.projAgora = () => Date.parse('2026-11-02T09:00:00-03:00');
  w2.atualizarDadosDashboard(FIX_APEX, '02/11/2026, 08:59:02');
  assert(w2.document.getElementById('projMes').value === '2026-09', 'mês escolhido à mão continua');
});

// ---------------- fim ----------------
Promise.resolve().then(() => typeof testarExcel === 'function' ? testarExcel() : null)
  .catch(err => { fail++; console.log('FALHOU (exceção no teste do Excel):', err && err.stack || err); })
  .finally(() => {
    console.log('--- test_projecao_ganho RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
    if(fail > 0) process.exitCode = 1;
  });
