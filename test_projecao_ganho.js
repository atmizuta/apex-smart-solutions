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

// ---------------- fim ----------------
Promise.resolve().then(() => typeof testarExcel === 'function' ? testarExcel() : null)
  .catch(err => { fail++; console.log('FALHOU (exceção no teste do Excel):', err && err.stack || err); })
  .finally(() => {
    console.log('--- test_projecao_ganho RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
    if(fail > 0) process.exitCode = 1;
  });
