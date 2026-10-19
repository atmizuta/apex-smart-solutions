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
  assert(perto(o.realizado.valor, 440) && perto(o.realizado.contratos, 7), 'realizado até ontem: R$ 440 e 7 contratos (sábado 17/10 entra) — ' + JSON.stringify(o.realizado));
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
  assert(perto(camp.realizado.contratos, 2.5) && perto(camp.hoje.valor, 30), 'Campinas: 2,5 contratos, hoje 30');
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
  assert(dd('2026-10-14').linhas.length === 2 && perto(dd('2026-10-14').contratos, 1), 'convergência: 2 linhas, 1 contrato');

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
  assert(perto(c[0].valor, 235) && perto(c[0].contratos, 3.5) && perto(c[0].ritmo, 235 / 11) && perto(c[0].projMes, 235 / 11 * 21) && perto(c[0].projContratos, 3.5 / 11 * 21), 'Bruno');
  assert(c[0].linhas.length === 5 && c[0].operacao === 'apex', 'Bruno: 5 linhas até ontem');
  assert(perto(c[1].valor, 205) && c[1].linhas.length === 5, 'Ana: 205 (hoje fora)');

  const t = g => p.tipos.find(x => x.grupo === g);
  assert(p.tipos.length === 6 && p.tipos[0].grupo === 'VOZ - Novo', '6 tipos, Linha Nova primeiro');
  assert(t('VOZ - Novo').label === 'Linha Nova' && perto(t('VOZ - Novo').valor, 245) && t('VOZ - Novo').pedidos === 5, 'Linha Nova: 245 em 5 pedidos');
  assert(perto(t('VOZ - Novo').pct, 245 / 440) && perto(t('VOZ - Novo').projMes, 245 / 11 * 21), 'Linha Nova: % e projeção');
  assert(t('SVA MÓVEL').label === 'Claro Monitor' && perto(t('SVA MÓVEL').valor, 5), 'SVA Móvel com o rótulo da Visão Diária');
  assert(t('GRUPO NOVO X').label === 'GRUPO NOVO X' && perto(t('GRUPO NOVO X').valor, 10), 'grupo novo aparece pelo nome');
  assert(perto(p.tipos.reduce((a, x) => a + x.valor, 0), 440), 'tipos somam o realizado');

  const e = k => p.etapas.find(x => x.k === k);
  assert(JSON.stringify(p.etapas.map(x => x.k)) === '["concluido","entrega","antifraude","biometria"]', 'etapas na ordem');
  assert(e('concluido').contratos === 3 && perto(e('concluido').bruto, 235) && perto(e('concluido').valor, 235), 'Concluído: A1, A8 e a convergência');
  assert(e('entrega').contratos === 3 && perto(e('entrega').valor, 130), 'Entrega + eSIM: A2, A3 e M1');
  assert(e('antifraude').contratos === 1 && perto(e('antifraude').bruto, 90) && perto(e('antifraude').valor, 45), 'Antifraude: bruto 90, ponderado 45');
  assert(e('biometria').contratos === 1 && perto(e('biometria').bruto, 60) && perto(e('biometria').valor, 30), 'Biometria: bruto 60, ponderado 30');
  assert(perto(p.etapas.reduce((a, x) => a + x.valor, 0), 440) && p.etapas.reduce((a, x) => a + x.contratos, 0) === 8, 'etapas somam 440 e 8 contratos');

  const camp = w.montarProjecao(FIX_CAMP, { mes: '2026-10', hoje: '2026-10-19', operacao: 'campinas' });
  assert(camp.dias[0].data === '2026-10-06', 'Campinas: gráfico começa em 06/10');
  assert(camp.semanas.length === 4 && camp.semanas[0].de === '2026-10-05' && camp.semanas[0].diasUteis === 4, 'Campinas: 4 semanas, a 1ª com 4 úteis');
  assert(perto(camp.semanas.reduce((a, s) => a + s.valor, 0), 360), 'Campinas: semanas somam 360');
  const tod = w.montarProjecao(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-19', operacao: 'todas' });
  const carla = tod.consultores.find(x => x.usuario === 'CARLA CAMPINAS');
  assert(tod.consultores.length === 3 && carla.operacao === 'campinas' && perto(carla.projMes, 360), 'Apex + Campinas: Carla com os dias de Campinas');
  assert(perto(tod.semanas.reduce((a, s) => a + s.valor, 0), 1200), 'Apex + Campinas: semanas somam 1200');
});

// ---------------- fim ----------------
Promise.resolve().then(() => typeof testarExcel === 'function' ? testarExcel() : null)
  .catch(err => { fail++; console.log('FALHOU (exceção no teste do Excel):', err && err.stack || err); })
  .finally(() => {
    console.log('--- test_projecao_ganho RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
    if(fail > 0) process.exitCode = 1;
  });
