// Testa a aba "Pedidos Parados" do consultor (30/09/2026) — ver REGRAS_NEGOCIO.md seção 53 e
// docs/superpowers/specs/2026-09-30-painel-do-consultor-design.md. Mesma técnica dos outros testes:
// decodifica o <script> real de _template.html, mocka o Supabase e roda tudo num jsdom.
// Dados fictícios (nada de cliente real).
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

// ---- mocks do Supabase: só o que a aba usa -------------------------------------------------
window.__rpcCalls = [];
window.__rpcRespostas = {};   // nome da rpc -> { data, error } | função(args)
window.__tabelas = {};        // tabela -> linhas
window.__escritas = [];       // upsert/delete feitos pelo painel
function builder(tabela){
  const linhasFiltradas = () => { const f = b.__eq || {}; return (window.__tabelas[tabela] || []).filter(l => Object.keys(f).every(c => l[c] === undefined || l[c] === f[c])); };
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b,
    eq: (c, v) => { b.__eq = Object.assign(b.__eq || {}, { [c]: v }); return b; },
    upsert: (rows, opts) => { window.__escritas.push({ tabela, op: 'upsert', rows, opts }); return Promise.resolve({ error: null }); },
    delete: () => {
      const d = { f: {}, eq: (c, v) => { d.f[c] = v; return d; },
        in: (c, v) => { d.f[c] = v; window.__escritas.push({ tabela, op: 'delete', filtro: d.f }); return Promise.resolve({ error: null }); } };
      return d;
    },
    maybeSingle: async () => ({ data: linhasFiltradas()[0] || null, error: null }),
    then: (resolve) => resolve({ data: linhasFiltradas(), error: null }),
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
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.alert = () => {};
window.confirm = () => true;
window.Chart = function(){ this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process; // o script de teste encerra o processo com process.exit (mesma técnica do test_fechamento.js)

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const HOJE = '2026-09-30'; // quarta-feira

  function L(o){
    return Object.assign({
      numero_pedido: 'P0', grupo: 'VOZ - Novo', usuario: 'CAIO COSTA SANTANA', etapa: 'ANTIFRAUDE (NEOCRM)',
      cadastro: '2026-09-10T10:00:00-03:00', atualizacao: '2026-09-22T15:00:00-03:00', valor: 100, quantidade: 1,
      produto: 'Plano A', cliente: 'Cliente A', cnpj: '11.222.333/0001-44', tag: '',
      data_portabilidade: null, data_instalacao: null, na_etapa_desde: '2026-09-22T15:00:00-03:00',
    }, o);
  }

  // --- 1) dias úteis (seg-sex, sem feriados nacionais) ---
  eq(ppDiasUteisDesde('2026-09-25', '2026-09-28'), 1, 'sexta -> segunda = 1 dia útil');
  eq(ppDiasUteisDesde('2026-09-23', '2026-09-30'), 5, 'quarta -> quarta seguinte = 5 dias úteis');
  eq(ppDiasUteisDesde('2026-09-04', '2026-09-08'), 1, '07/09 (Independência, segunda) não conta: sexta 04 -> terça 08 = 1');
  eq(ppDiasUteisDesde('2026-09-30', '2026-09-30'), 0, 'mesmo dia = 0');
  eq(ppDiasUteisDesde('2026-09-30', '2026-09-25'), 0, 'referência anterior à data = 0');
  eq(ppDiasUteisDesde(null, HOJE), 0, 'sem data = 0');
  eq(ppNivel(2), null, 'até 2 dias úteis = em dia');
  eq(ppNivel(3), 'minimo', '3 = mínimo');
  eq(ppNivel(5), 'minimo', '5 = mínimo');
  eq(ppNivel(6), 'medio', '6 = médio');
  eq(ppNivel(9), 'medio', '9 = médio');
  eq(ppNivel(10), 'maximo', '10 = máximo');
  eq(ppDiasUteisNoMes('2026-09'), 21, 'setembro/2026 tem 22 dias de semana - 1 feriado (07/09) = 21 úteis');
  eq(ppDiasUteisNoMes('2026-09', '2026-09-15'), 10, 'úteis de 01 a 15/09 (inclusive), sem o feriado de 07/09 = 10');
  eq(ppDiasUteisNoMes('2026-09', '2026-10-20'), 21, 'referência depois do mês: mês inteiro');

  // --- 2) agrupar linhas em pedidos ---
  const linhas = [
    L({ numero_pedido: 'A1', produto: 'Chip', valor: 50, quantidade: 1, etapa: 'BIOMETRIA (NEOCRM)', atualizacao: '2026-09-20T10:00:00-03:00', na_etapa_desde: '2026-09-20T10:00:00-03:00' }),
    L({ numero_pedido: 'A1', produto: 'Plano', valor: 40, quantidade: 2, etapa: 'BIOMETRIA (NEOCRM)', atualizacao: '2026-09-21T10:00:00-03:00', na_etapa_desde: '2026-09-21T10:00:00-03:00' }),
    L({ numero_pedido: '', produto: 'Sem número', valor: 999 }),
  ];
  const agr = ppAgruparPedidos(linhas);
  eq(agr.length, 1, 'linha sem número de pedido é ignorada');
  eq(agr[0].valor, 90, 'valor do pedido = soma das linhas');
  eq(agr[0].qtd, 3, 'quantidade somada');
  eq(agr[0].produtos, 'Chip + Plano', 'produtos distintos unidos por " + " (ordem alfabética)');
  eq(agr[0].desde, '2026-09-21T10:00:00-03:00', 'desde = data mais recente da etapa');
  eq(agr[0].cnpj, '11.222.333/0001-44', 'cnpj do pedido');

  // --- 3) fila: só as 8 etapas monitoradas, dias úteis até a data de referência ---
  const base = [
    L({ numero_pedido: 'F1', etapa: 'ANTIFRAUDE (NEOCRM)', valor: 100, na_etapa_desde: '2026-09-22T15:00:00-03:00', cliente: 'Antifraude Ltda' }), // 6 úteis -> médio
    L({ numero_pedido: 'F2', etapa: 'ENTREGA (NEOCRM)', valor: 50, na_etapa_desde: '2026-09-28T09:00:00-03:00' }),                             // 2 -> em dia
    L({ numero_pedido: 'F3', etapa: 'BIOMETRIA (NEOCRM)', valor: 70, na_etapa_desde: '2026-09-10T09:00:00-03:00' }),                            // 14 -> máximo
    L({ numero_pedido: 'F4', etapa: 'CONCLUIDO (NEOCRM)', valor: 500, na_etapa_desde: '2026-09-01T09:00:00-03:00' }),                           // fechado: fora
    L({ numero_pedido: 'F5', etapa: 'NEGOCIACAO (NEOCRM)', valor: 30, na_etapa_desde: '2026-09-01T09:00:00-03:00' }),                          // aberto, não monitorado
    L({ numero_pedido: 'F6', etapa: 'VENDA PERDIDA (NEOCRM)', valor: 400 }),
    L({ numero_pedido: 'F7', etapa: 'PORTABILIDADE EM TRATATIVA (NEOCRM)', valor: 20, na_etapa_desde: '2026-09-24T09:00:00-03:00' }),           // 4 -> mínimo
  ];
  const fila = ppResumoFila(ppAgruparPedidos(base), HOJE);
  eq(fila.parados, 3, 'parados = 3 (F1 médio, F3 máximo, F7 mínimo); F2 está em dia');
  eq(fila.valorParado, 190, 'R$ parados = 100 + 70 + 20');
  eq(fila.abertos, 5, 'abertos = F1, F2, F3, F5, F7 (concluído e perdido não contam)');
  eq(fila.valorAberto, 270, 'R$ em aberto = 100+50+70+30+20');
  eq(fila.lista.map(p => p.numero), ['F3', 'F1', 'F7'], 'lista do mais parado pro menos parado');
  eq(fila.lista[0].nivel, 'maximo', 'F3 máximo');
  eq(fila.lista[1].dias, 6, 'F1 = 6 dias úteis');
  eq(fila.lista[0].bola, 'cliente', 'biometria: a bola está com o cliente');
  eq(fila.lista[1].bola, 'operadora', 'antifraude: a bola está com a operadora');
  eq(fila.lista[0].etapaCurta, 'Biometria', 'rótulo curto da etapa');
  eq(fila.porEtapa.map(e => [e.curta, e.n, e.valor]), [['Antifraude', 1, 100], ['Biometria', 1, 70], ['Portab. em tratativa', 1, 20]], 'por etapa: só etapas com parados, maior R$ primeiro');
  eq(Object.keys(PP_ETAPAS).length, 8, 'são 8 etapas monitoradas (decisão D2)');

  // --- 4) agenda ---
  const ag = [
    L({ numero_pedido: 'G1', etapa: 'VALIDAÇÃO ESIM (NEOCRM)', data_portabilidade: '2026-09-25T10:00:00-03:00', valor: 60 }), // atrasado 5 dias
    L({ numero_pedido: 'G2', etapa: 'ENTREGA (NEOCRM)', data_portabilidade: '2026-09-30T10:00:00-03:00', valor: 30 }),        // hoje
    L({ numero_pedido: 'G3', etapa: 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', data_portabilidade: '2026-10-01T10:00:00-03:00' }),// amanhã
    L({ numero_pedido: 'G4', etapa: 'ENTREGA (NEOCRM)', data_portabilidade: '2026-10-06T10:00:00-03:00' }),                    // próximos 7 dias
    L({ numero_pedido: 'G5', etapa: 'ENTREGA (NEOCRM)', data_portabilidade: '2026-10-20T10:00:00-03:00' }),                    // depois
    L({ numero_pedido: 'G6', etapa: 'ENTREGA (NEOCRM)' }),                                                                      // sem data
    L({ numero_pedido: 'G7', etapa: 'CONCLUIDO (NEOCRM)', data_portabilidade: '2026-09-01T10:00:00-03:00' }),                   // concluído: fora
    L({ numero_pedido: 'G8', etapa: 'BIOMETRIA (NEOCRM)' }),                                                                    // sem data, mas etapa não exige data
    L({ numero_pedido: 'G9', etapa: 'PORTABILIDADE EM TRATATIVA (NEOCRM)', data_instalacao: '2026-09-29T10:00:00-03:00' }),    // instalação ontem -> atrasado
  ];
  const agenda = ppAgenda(ppAgruparPedidos(ag), HOJE);
  eq(agenda.atrasados.map(p => p.numero), ['G1', 'G9'], 'atrasados: mais atrasado primeiro (G1 5 dias, G9 1 dia)');
  eq(agenda.atrasados[0].diasAtraso, 5, 'G1 atrasado 5 dias');
  eq(agenda.hoje.map(p => p.numero), ['G2'], 'hoje');
  eq(agenda.amanha.map(p => p.numero), ['G3'], 'amanhã');
  eq(agenda.proximos7.map(p => p.numero), ['G4'], 'próximos 7 dias (02 a 07/10)');
  eq(agenda.depois.map(p => p.numero), ['G5'], 'depois de 7 dias');
  eq(agenda.semData.map(p => p.numero), ['G6'], 'sem data: só etapas que dependem de data (entrega/portabilidade/eSIM)');
  eq(agenda.total, 7, 'total da agenda = 6 com data (G1,G2,G3,G4,G5,G9) + 1 sem data (G6)');

  // --- 5) recuperar vendas perdidas (por motivo) e devolvidos ---
  const per = [
    L({ numero_pedido: 'R1', etapa: 'VENDA PERDIDA (NEOCRM)', tag: '#SEMCREDITO', valor: 80, atualizacao: '2026-08-20T10:00:00-03:00', cnpj: '22.333.444/0001-55', cliente: 'Sem Credito SA' }), // 41 dias: pode reabordar
    L({ numero_pedido: 'R2', etapa: 'VENDA PERDIDA (NEOCRM)', tag: '#SEMCREDITO', valor: 60, atualizacao: '2026-09-20T10:00:00-03:00', cnpj: '33.444.555/0001-66' }),                         // 10 dias: ainda cedo
    L({ numero_pedido: 'R3', etapa: 'VENDA PERDIDA (NEOCRM)', tag: '#HOTLEAD', valor: 50, atualizacao: '2026-09-25T10:00:00-03:00', cnpj: '44.555.666/0001-77' }),
    L({ numero_pedido: 'R4', etapa: 'VENDA PERDIDA (NEOCRM)', tag: '#SEMINTERESSE', valor: 999, atualizacao: '2026-09-25T10:00:00-03:00', cnpj: '55.666.777/0001-88' }),
    L({ numero_pedido: 'R5', etapa: 'VENDA PERDIDA (NEOCRM)', tag: '#COMCREDITO', valor: 70, atualizacao: '2026-09-10T10:00:00-03:00', cnpj: '66.777.888/0001-99' }),
    L({ numero_pedido: 'R6', etapa: 'VENDA PERDIDA (NEOCRM)', tag: '', valor: 10, atualizacao: '2026-09-10T10:00:00-03:00', cnpj: '77.888.999/0001-00' }),
    L({ numero_pedido: 'R7', etapa: 'VENDA PERDIDA (NEOCRM)', tag: '#SEMCREDITO', valor: 90, atualizacao: '2026-04-01T10:00:00-03:00', cnpj: '88.999.000/0001-11' }), // velho (>90d)
    L({ numero_pedido: 'R8', etapa: 'VENDA PERDIDA (NEOCRM)', tag: '#COMRESTRICAO', valor: 40, atualizacao: '2026-08-15T10:00:00-03:00', cnpj: '99.000.111/0001-22' }), // cliente já tem pedido aberto: fora
    L({ numero_pedido: 'R9', etapa: 'ANTIFRAUDE (NEOCRM)', valor: 40, cnpj: '99.000.111/0001-22' }),
    L({ numero_pedido: 'D1', etapa: 'DEVOLVIDO (NEOCRM)', tag: '#COMRESTRICAO', valor: 45, atualizacao: '2026-09-18T10:00:00-03:00', cnpj: '12.345.678/0001-90' }),
    L({ numero_pedido: 'D2', etapa: 'DEVOLVIDO (NEOCRM)', valor: 45, atualizacao: '2026-05-18T10:00:00-03:00' }), // velho
  ];
  const pedPer = ppAgruparPedidos(per);
  const rec = ppRecuperaveis(pedPer, HOJE);
  eq(rec.lista.map(p => p.numero), ['R3', 'R5', 'R1', 'R2', 'R6'], 'ordem: quente, crédito ok, restrição que já pode reabordar, restrição ainda cedo, sem motivo');
  eq(rec.lista.find(p => p.numero === 'R1').podeReabordar, true, 'restrição há 41 dias: já pode reabordar (>=30)');
  eq(rec.lista.find(p => p.numero === 'R2').podeReabordar, false, 'restrição há 10 dias: ainda cedo');
  eq(rec.lista.find(p => p.numero === 'R3').motivo, 'quente', 'HOTLEAD = quente');
  assert(!rec.lista.some(p => p.numero === 'R4'), 'SEMINTERESSE não é recuperável');
  assert(!rec.lista.some(p => p.numero === 'R7'), 'perdido há mais de 90 dias fica de fora');
  assert(!rec.lista.some(p => p.numero === 'R8'), 'cliente que já tem pedido aberto seu não entra');
  eq(rec.valorReabordavel, 80 + 50 + 70 + 10 + 60, 'R$ das recuperáveis');
  eq(rec.descartados, 1, 'descartados por desinteresse/cobertura (R4) = 1');
  const dev = ppDevolvidos(pedPer, HOJE);
  eq(dev.map(p => p.numero), ['D1'], 'devolvidos dos últimos 90 dias');

  // --- 6) reoferecer (concluídos entre 30 e 120 dias atrás, cliente sem pedido aberto) ---
  const conc = [
    L({ numero_pedido: 'C1', etapa: 'CONCLUIDO (NEOCRM)', data_portabilidade: '2026-08-10T10:00:00-03:00', valor: 100, cnpj: '10.000.000/0001-01', cliente: 'Cliente Velho' }), // 51 dias
    L({ numero_pedido: 'C2', etapa: 'CONCLUIDO (NEOCRM)', data_portabilidade: '2026-09-20T10:00:00-03:00', valor: 100, cnpj: '20.000.000/0001-02' }),                          // 10 dias: cedo
    L({ numero_pedido: 'C3', etapa: 'CONCLUIDO (NEOCRM)', data_portabilidade: '2026-07-15T10:00:00-03:00', valor: 300, cnpj: '30.000.000/0001-03', cliente: 'Cliente Grande' }),  // 77 dias
    L({ numero_pedido: 'C4', etapa: 'CONCLUIDO (NEOCRM)', data_portabilidade: '2026-07-16T10:00:00-03:00', valor: 50, cnpj: '30.000.000/0001-03', cliente: 'Cliente Grande' }),   // mesmo cliente
    L({ numero_pedido: 'C5', etapa: 'CONCLUIDO (NEOCRM)', data_portabilidade: '2026-08-01T10:00:00-03:00', valor: 80, cnpj: '40.000.000/0001-04' }),                          // tem pedido aberto
    L({ numero_pedido: 'C6', etapa: 'BIOMETRIA (NEOCRM)', valor: 10, cnpj: '40.000.000/0001-04' }),
    L({ numero_pedido: 'C7', etapa: 'CONCLUIDO (NEOCRM)', data_portabilidade: '2026-03-01T10:00:00-03:00', valor: 80, cnpj: '50.000.000/0001-05' }),                          // >120 dias
  ];
  const op = ppOportunidades(ppAgruparPedidos(conc), HOJE);
  eq(op.map(o => [o.cliente, o.pedidos, o.valor]), [['Cliente Grande', 2, 350], ['Cliente Velho', 1, 100]], 'oportunidades: agrupa por CNPJ, maior R$ primeiro');

  // --- 7) placar do mês ---
  const pl = [
    L({ numero_pedido: 'M1', etapa: 'CONCLUIDO (NEOCRM)', grupo: 'VOZ - Portabilidade', valor: 200, data_portabilidade: '2026-09-10T10:00:00-03:00', cadastro: '2026-09-02T10:00:00-03:00' }),
    L({ numero_pedido: 'M1', etapa: 'CONCLUIDO (NEOCRM)', grupo: 'VOZ - Portabilidade', valor: 100, data_portabilidade: '2026-09-10T10:00:00-03:00', cadastro: '2026-09-02T10:00:00-03:00' }),
    L({ numero_pedido: 'M2', etapa: 'CONCLUIDO (NEOCRM)', grupo: 'BANDA LARGA - Novo', valor: 150, data_instalacao: '2026-09-20T10:00:00-03:00', cadastro: '2026-09-05T10:00:00-03:00' }),
    L({ numero_pedido: 'M3', etapa: 'CONCLUIDO (NEOCRM)', grupo: 'VOZ - Novo', valor: 999, data_portabilidade: '2026-08-20T10:00:00-03:00', cadastro: '2026-08-10T10:00:00-03:00' }), // agosto: fora do mês
    L({ numero_pedido: 'M4', etapa: 'VENDA PERDIDA (NEOCRM)', valor: 400, cadastro: '2026-09-03T10:00:00-03:00' }),
    L({ numero_pedido: 'M5', etapa: 'ANTIFRAUDE (NEOCRM)', valor: 100, cadastro: '2026-09-25T10:00:00-03:00' }),
    L({ numero_pedido: 'M6', etapa: 'DEVOLVIDO (NEOCRM)', valor: 50, cadastro: '2026-09-12T10:00:00-03:00' }),
  ];
  const placar = ppPlacar(pl, '2026-09', HOJE, 1000);
  eq(placar.ativacoes, 2, 'ativações do mês = 2 contratos (M1 conta uma vez)');
  eq(placar.receita, 450, 'receita das ativações = 200+100+150');
  eq(placar.cadastrados, 5, 'pedidos cadastrados no mês (M1,M2,M4,M5,M6)');
  eq(placar.pct, 45, '45% da meta de R$ 1000');
  eq(placar.faltam, 550, 'faltam R$ 550');
  eq(placar.diasUteisMes, 21, 'dias úteis do mês');
  eq(placar.diasUteisDecorridos, 21, 'até 30/09 já passaram os 21 úteis');
  eq(placar.ritmo, 450, 'ritmo = receita / úteis decorridos * úteis do mês (último dia: igual à receita)');
  eq(placar.aberto, 100, 'valor ainda em aberto (M5)');
  eq(placar.potencial, null, 'poucos pedidos fechados (<10): não estima potencial');
  const placarSemMeta = ppPlacar(pl, '2026-09', HOJE, 0);
  eq(placarSemMeta.pct, null, 'sem meta: sem percentual');
  eq(placarSemMeta.faltam, null, 'sem meta: sem "faltam"');
  const metade = ppPlacar(pl, '2026-09', '2026-09-15', 1000);
  eq(metade.diasUteisDecorridos, 10, 'em 15/09 já passaram 10 úteis');
  eq(Math.round(metade.ritmo), Math.round(450 / 10 * 21), 'ritmo projeta o mês inteiro pelo ritmo de 15/09');
  const muitos = pl.concat([1,2,3,4,5,6].map(i => L({ numero_pedido: 'Z' + i, etapa: i <= 4 ? 'CONCLUIDO (NEOCRM)' : 'VENDA PERDIDA (NEOCRM)', valor: 10, cadastro: '2026-09-01T10:00:00-03:00' })));
  const comPot = ppPlacar(muitos, '2026-09', HOJE, 1000);
  assert(comPot.potencial !== null && comPot.potencial > 0, 'com >=10 fechados estima potencial do que está em aberto');
  eq(comPot.previsao, Math.round((comPot.receita + comPot.potencial) * 100) / 100, 'previsão = receita + potencial');

  // --- 8) sugestão de vínculos painel x NeoCRM ---
  const perfis = [
    { id: 'p-caio', nome: 'Caio Costa' }, { id: 'p-manu', nome: 'Manuella Bento' }, { id: 'p-yas', nome: 'Yasmin Bezerra' },
    { id: 'p-g1', nome: 'Gabriel' }, { id: 'p-g2', nome: 'Gabriel' }, { id: 'p-vito', nome: 'Vitoria Brito' },
    { id: 'p-vic', nome: 'Victoria Horni' }, { id: 'p-ana', nome: 'Ana' }, { id: 'p-luria', nome: 'Luria Lourenço' },
    { id: 'p-ja', nome: 'Isabelly' },
  ];
  const neos = [
    { usuario_id: 1, nome: 'CAIO COSTA SANTANA' }, { usuario_id: 2, nome: 'Manuela Bento Macedo' },
    { usuario_id: 3, nome: 'YASMIN SILVA' }, { usuario_id: 4, nome: 'Gabriel Macedo Martins' },
    { usuario_id: 5, nome: 'Gabriel da Silva Gomes' }, { usuario_id: 6, nome: 'Vitoria da Silva Santos Brito' },
    { usuario_id: 7, nome: 'VICTORIA HORNI DA ROCHA' }, { usuario_id: 8, nome: 'Danilo Morais Araujo' },
    { usuario_id: 9, nome: 'Lúria Amanda Alvim Lourenço' }, { usuario_id: 10, nome: 'ISABELLY FONSECA BATISTA DA SILVA' },
  ];
  const sug = ppSugerirVinculos(perfis, neos);
  const por = id => sug.find(s => s.profile_id === id);
  eq([por('p-caio').usuario_id, por('p-caio').forca], [1, 'forte'], 'Caio Costa = CAIO COSTA SANTANA (forte)');
  eq([por('p-manu').usuario_id, por('p-manu').forca], [2, 'forte'], 'Manuella (2 L) = Manuela Bento Macedo');
  eq([por('p-yas').usuario_id, por('p-yas').forca], [3, 'fraca'], 'Yasmin Bezerra ~ YASMIN SILVA (mesmo 1º nome, único) = fraca, pede confirmação');
  assert(!por('p-g1') && !por('p-g2'), 'dois Gabriel: nenhuma sugestão automática (ambíguo)');
  eq([por('p-vito').usuario_id, por('p-vito').forca], [6, 'forte'], 'Vitoria Brito = Vitoria da Silva Santos Brito');
  eq([por('p-vic').usuario_id, por('p-vic').forca], [7, 'forte'], 'Victoria Horni (com C) não se confunde com Vitória');
  assert(!por('p-ana'), 'sem candidato: sem sugestão');
  eq([por('p-luria').usuario_id, por('p-luria').forca], [9, 'forte'], 'Luria Lourenço (acentos)');
  eq([por('p-ja').usuario_id, por('p-ja').forca], [10, 'fraca'], 'só o primeiro nome, único dos dois lados: fraca');
  const jaVinculado = ppSugerirVinculos(perfis, neos, [{ profile_id: 'p-caio', neo_usuario_id: 1 }]);
  assert(!jaVinculado.some(s => s.profile_id === 'p-caio'), 'perfil já vinculado não recebe sugestão');

  // ================= TELA: consultor, admin, isolamento =================
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 30));
  hojeSP = function(){ return HOJE; };                       // o teste não depende do relógio
  const iso = (d, h) => d + 'T' + (h || '12:00:00') + '-03:00';
  window.__rpcRespostas.producao_meus_pedidos = { data: [
    L({ numero_pedido: 'U1', etapa: 'ANTIFRAUDE (NEOCRM)', valor: 100, cliente: 'Antifraude Ltda', cnpj: '11.222.333/0001-44', na_etapa_desde: iso('2026-09-22'), atualizacao: iso('2026-09-22') }),
    L({ numero_pedido: 'U2', etapa: 'BIOMETRIA (NEOCRM)', valor: 70, cliente: 'Bio SA', cnpj: '22.333.444/0001-55', na_etapa_desde: iso('2026-09-10'), atualizacao: iso('2026-09-10') }),
    L({ numero_pedido: 'U3', etapa: 'ENTREGA (NEOCRM)', valor: 30, cliente: 'Entrega ME', cnpj: '33.444.555/0001-66', na_etapa_desde: iso('2026-09-29'), atualizacao: iso('2026-09-29'), data_portabilidade: iso('2026-09-28') }),
    L({ numero_pedido: 'U4', etapa: 'VENDA PERDIDA (NEOCRM)', valor: 80, tag: '#HOTLEAD', cliente: 'Quente SA', cnpj: '44.555.666/0001-77', atualizacao: iso('2026-09-25') }),
    L({ numero_pedido: 'U5', etapa: 'CONCLUIDO (NEOCRM)', valor: 120, grupo: 'VOZ - Portabilidade', cliente: 'Antigo Ltda', cnpj: '55.666.777/0001-88', data_portabilidade: iso('2026-08-10'), atualizacao: iso('2026-08-10'), cadastro: iso('2026-08-01') }),
    L({ numero_pedido: 'U6', etapa: 'CONCLUIDO (NEOCRM)', valor: 200, grupo: 'VOZ - Portabilidade', cliente: 'Este Mes SA', cnpj: '66.777.888/0001-99', data_portabilidade: iso('2026-09-12'), atualizacao: iso('2026-09-12'), cadastro: iso('2026-09-03') }),
  ], error: null };
  window.__rpcRespostas.minhas_movimentacoes = { data: [{ numero_pedido: 'U1', cliente: 'Antifraude Ltda', etapa_anterior: 'CREDITO (NEOCRM)', etapa_nova: 'ANTIFRAUDE (NEOCRM)', em: new Date().toISOString(), valor: 100 }], error: null };
  window.__rpcRespostas.cnpjs_com_pedido_aberto_de_outros = { data: ['22333444000155'], error: null };
  window.__tabelas.consultor_neo = [{ profile_id: 'u-caio', neo_usuario_id: 102218 }];
  window.__tabelas.metas_consultor = [{ profile_id: 'u-caio', meta_receita: 1000 }];
  window.__tabelas.config = [{ valor: '30/09/2026, 14:07:01' }];
  window.__tabelas.clientes = [{ cnpj_digits: '11222333000144', tel1: '(11) 3333-4444', tel2: '(11) 98888-7777', telefone_contato: null }];

  currentUser = { id: 'u-caio', nome: 'Caio Costa', username: 'caio', role: 'consultor' };
  enterApp();
  await espera(150);
  assert(document.getElementById('tabBtnPedidosParados').style.display === 'inline-block', 'consultor vê o botão da aba Pedidos Parados');
  assert(document.getElementById('meuDiaCard').style.display === 'block', 'consultor vê o cartão "Meu dia" no Dashboard');
  assert(/Bom dia|Boa tarde|Boa noite/.test(document.getElementById('meuDiaTitulo').textContent) && document.getElementById('meuDiaTitulo').textContent.includes('Caio'), 'saudação com o primeiro nome');
  assert(document.getElementById('meuDiaStats').textContent.includes('Pedidos parados'), 'Meu dia mostra pedidos parados');
  assert(window.__rpcCalls.some(c => c.nome === 'producao_meus_pedidos'), 'a aba usa a RPC que filtra por dono (não lê a tabela inteira)');
  assert(!window.__rpcCalls.some(c => c.nome === 'producao_meus_pedidos' && c.args && c.args.p_consultor), 'consultor não pede "ver como" outro consultor');

  document.querySelector('#tabsNav button[data-tab="pedidosparados"]').click();
  await espera(150);
  assert(document.getElementById('panel-pedidosparados').classList.contains('active'), 'aba Pedidos Parados abre');
  assert(document.getElementById('ppConteudo').style.display === 'block', 'conteúdo visível (vínculo existe)');
  assert(document.getElementById('ppSemVinculo').style.display === 'none', 'aviso de "sem vínculo" escondido');
  const kp = document.getElementById('ppKpis').textContent;
  assert(kp.includes('Pedidos parados') && kp.includes('R$/mês parados') && kp.includes('R$/mês em aberto'), 'KPIs: parados, R$ parados e R$ em aberto');
  assert(kp.includes(fmtBRL(170)), 'R$ parados = 100 (antifraude, 6 d.ú.) + 70 (biometria, 14 d.ú.) = 170 — veio ' + kp);
  const secao = document.getElementById('ppSecao').textContent;
  assert(secao.includes('Antifraude') && secao.includes('Biometria'), 'mostra a etapa de cada pedido');
  assert(secao.includes('Com o cliente') && secao.includes('Com a operadora'), 'mostra de quem é a bola');
  assert(!secao.includes('Entrega ME'), 'pedido em dia (U3) não entra na lista de parados');
  assert(secao.includes('outro consultor'), 'anti-duplicidade: marca CNPJ com pedido aberto de outro consultor');
  const placarTxt = document.getElementById('ppPlacar').textContent;
  assert(placarTxt.includes(fmtBRL(230)), 'placar: receita das ativações do mês = U6 200 + U3 30 (ENTREGA com data de portabilidade em setembro conta, igual ao Fechamento); U5 é de agosto — veio ' + placarTxt);
  assert(placarTxt.includes('23%'), 'placar: 230 de 1000 = 23%');
  assert(document.querySelectorAll('#ppSecao a[href^="https://wa.me/"]').length === 0, 'WhatsApp só onde a bola está com o cliente E há telefone: U2 (biometria) não tem telefone achado -> nenhum botão');

  // filtros
  document.querySelector('#ppSecao [data-ppetapa="BIOMETRIA (NEOCRM)"]').click();
  assert(document.querySelectorAll('#ppSecao table tbody tr').length === 1 && document.getElementById('ppSecao').textContent.includes('Bio SA'), 'clicar na etapa filtra a lista');
  document.querySelector('#ppSecao [data-ppf-limpar]').click();
  assert(document.querySelectorAll('#ppSecao table tbody tr').length === 2, 'limpar filtros volta às 2 linhas');
  const selNivel = document.querySelector('#ppSecao select[data-ppf="nivel"]');
  selNivel.value = 'maximo'; selNivel.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(document.querySelectorAll('#ppSecao table tbody tr').length === 1, 'filtro por nível máximo: 1 linha');

  // outras seções
  document.querySelector('#ppPills [data-pp="agenda"]').click();
  assert(document.getElementById('ppSecao').textContent.includes('Atrasados') && document.getElementById('ppSecao').textContent.includes('Entrega ME'), 'agenda mostra o pedido atrasado (data de ontem)');
  document.querySelector('#ppPills [data-pp="recuperar"]').click();
  assert(document.getElementById('ppSecao').textContent.includes('Quente SA') && document.getElementById('ppSecao').textContent.includes('Lead quente'), 'recuperar mostra a venda perdida quente');
  document.querySelector('#ppPills [data-pp="reoferecer"]').click();
  assert(document.getElementById('ppSecao').textContent.includes('Antigo Ltda'), 'reoferecer mostra o concluído de agosto');
  document.querySelector('#ppPills [data-pp="novidades"]').click();
  assert(document.getElementById('ppSecao').textContent.includes('ANTIFRAUDE') && document.getElementById('ppSecao').textContent.includes('CREDITO'), 'novidades mostra a mudança de etapa');

  // WhatsApp aparece para o cliente com telefone (U1 tem telefone na base, mas a bola está com a operadora -> só copia; agenda de U3 sem telefone)
  window.__tabelas.clientes = [{ cnpj_digits: '22333444000155', tel1: '(11) 98888-7777', tel2: null, telefone_contato: null }];
  ppEstado.carregadoEm = 0; ppEstado.neoOutros = new Set(); ppEstado.telefones = new Map();
  document.querySelector('#tabsNav button[data-tab="busca"]').click();
  document.querySelector('#tabsNav button[data-tab="pedidosparados"]').click();
  await espera(150);
  document.querySelector('#ppPills [data-pp="parados"]').click();
  const wa = document.querySelectorAll('#ppSecao a[href^="https://wa.me/"]');
  assert(wa.length === 1 && wa[0].getAttribute('href').startsWith('https://wa.me/5511988887777?text='), 'WhatsApp da biometria com o número no formato 55+DDD+número');
  assert(decodeURIComponent(wa[0].getAttribute('href')).includes('biometria facial'), 'mensagem pronta menciona a biometria');

  // sem vínculo: nunca mostra a base inteira
  window.__tabelas.consultor_neo = [];
  window.__rpcRespostas.producao_meus_pedidos = { data: [], error: null };
  ppEstado.carregadoEm = 0;
  document.querySelector('#tabsNav button[data-tab="busca"]').click();
  document.querySelector('#tabsNav button[data-tab="pedidosparados"]').click();
  await espera(150);
  assert(document.getElementById('ppSemVinculo').style.display === 'block', 'sem vínculo: mostra o aviso');
  assert(document.getElementById('ppConteudo').style.display === 'none', 'sem vínculo: nenhum conteúdo');
  assert(document.getElementById('meuDiaCard').style.display === 'none', 'sem vínculo: "Meu dia" some');

  // erro de carga (ex.: migration ainda não aplicada) com vínculo
  window.__tabelas.consultor_neo = [{ profile_id: 'u-caio', neo_usuario_id: 102218 }];
  window.__rpcRespostas.producao_meus_pedidos = { data: null, error: { message: 'function not found' } };
  ppEstado.carregadoEm = 0;
  document.querySelector('#tabsNav button[data-tab="busca"]').click();
  document.querySelector('#tabsNav button[data-tab="pedidosparados"]').click();
  await espera(150);
  assert(document.getElementById('ppErro').style.display === 'block' && document.getElementById('ppConteudo').style.display === 'none', 'erro de carga: mensagem amigável + botão de tentar de novo');

  // erro ao ler o VÍNCULO não pode parecer "sem vínculo" (seria mentira): mostra o erro
  window.__tabelas.consultor_neo = null;
  const construtorOriginal = sb.from.bind(sb);
  sb.from = (t) => { const b = construtorOriginal(t); if(t === 'consultor_neo') b.maybeSingle = async () => ({ data: null, error: { message: 'relation does not exist' } }); return b; };
  ppEstado.carregadoEm = 0;
  document.querySelector('#tabsNav button[data-tab="busca"]').click();
  document.querySelector('#tabsNav button[data-tab="pedidosparados"]').click();
  await espera(150);
  assert(document.getElementById('ppErro').style.display === 'block' && document.getElementById('ppSemVinculo').style.display === 'none', 'falha ao ler o vínculo mostra erro, não "sem vínculo"');
  sb.from = construtorOriginal;
  window.__tabelas.consultor_neo = [{ profile_id: 'u-caio', neo_usuario_id: 102218 }];

  // troca de usuário no mesmo navegador: nada do consultor anterior sobra (memória nem tela)
  window.__rpcRespostas.producao_meus_pedidos = { data: [L({ numero_pedido: 'T1', etapa: 'BIOMETRIA (NEOCRM)', cliente: 'Cliente Exclusivo do Caio', na_etapa_desde: iso('2026-09-10'), atualizacao: iso('2026-09-10') })], error: null };
  ppEstado.carregadoEm = 0;
  enterApp();
  await espera(150);
  document.querySelector('#tabsNav button[data-tab="pedidosparados"]').click();
  await espera(150);
  assert(document.getElementById('meuDiaCard').style.display === 'block' && document.getElementById('ppSecao').innerHTML.includes('Cliente Exclusivo do Caio'), 'Caio logado: "Meu dia" e a lista mostram o pedido dele');
  currentUser = { id: 'u-bia', nome: 'Bia Souza', username: 'bia', role: 'consultor' };
  enterApp();   // entra outro consultor (sem vínculo) — antes de a carga terminar
  assert(document.getElementById('ppSecao').innerHTML === '' && document.getElementById('ppKpis').innerHTML === '', 'troca de login: a tela do consultor anterior é limpa na hora');
  assert(document.getElementById('meuDiaCard').style.display === 'none', 'troca de login: "Meu dia" do anterior some');
  await espera(150);
  assert(!document.body.innerHTML.includes('Cliente Exclusivo do Caio'), 'troca de login: nenhum dado do consultor anterior permanece no DOM');
  assert(ppEstado.linhas.length === 0, 'troca de login: memória do consultor anterior descartada (Bia sem vínculo não recebe linhas)');

  // supervisor e admin: aba escondida, "Pedidos em Alerta" não é tocado
  currentUser = { id: 'u-sup', nome: 'Isa', username: 'isa', role: 'supervisor' };
  enterApp();
  await espera(60);
  assert(document.getElementById('tabBtnPedidosParados').style.display === 'none', 'supervisor não vê a aba Pedidos Parados');
  assert(document.getElementById('meuDiaCard').style.display === 'none', 'supervisor não vê "Meu dia"');
  assert(document.getElementById('ppVincCard').style.display === 'none' && document.getElementById('ppMetasCard').style.display === 'none', 'supervisor não vê os editores de vínculo/metas (só admin)');

  // ================= ADMIN: vínculos e metas =================
  currentUser = { id: 'u-adm', nome: 'Rafael', username: 'adm', role: 'admin' };
  window.__tabelas.profiles = [
    { id: 'p-caio', nome: 'Caio Costa', username: 'Caio', role: 'consultor' }, { id: 'p-manu', nome: 'Manuella Bento', username: 'Manuella', role: 'consultor' },
    { id: 'p-yas', nome: 'Yasmin Bezerra', username: 'Yasmin', role: 'consultor' }, { id: 'p-g1', nome: 'Gabriel', username: 'Gabriels', role: 'consultor' },
    { id: 'p-g2', nome: 'Gabriel', username: 'gabriel', role: 'consultor' },
  ];
  window.__rpcRespostas.neo_usuarios_detectados = { data: [
    { usuario_id: 102218, nome: 'CAIO COSTA SANTANA', pedidos: 200, ultimo_pedido: null, profile_id: null },
    { usuario_id: 102420, nome: 'Manuela Bento Macedo', pedidos: 67, ultimo_pedido: null, profile_id: null },
    { usuario_id: 103425, nome: 'Yasmin Silva', pedidos: 7, ultimo_pedido: null, profile_id: null },
    { usuario_id: 103196, nome: 'Gabriel Macedo Martins', pedidos: 72, ultimo_pedido: null, profile_id: null },
    { usuario_id: 103489, nome: 'Gabriel da Silva Gomes', pedidos: 2, ultimo_pedido: null, profile_id: null },
    { usuario_id: 103264, nome: 'Danilo Morais Araujo', pedidos: 12, ultimo_pedido: null, profile_id: null },
  ], error: null };
  window.__tabelas.consultor_neo = [];
  enterApp();
  await espera(60);
  assert(document.getElementById('tabBtnPedidosParados').style.display === 'none', 'admin não vê a aba Pedidos Parados (continua com Pedidos em Alerta)');
  assert(document.getElementById('meuDiaCard').style.display === 'none', 'admin não vê "Meu dia"');
  assert(document.getElementById('ppVincCard').style.display === 'block' && document.getElementById('ppMetasCard').style.display === 'block', 'admin vê os editores');
  document.querySelector('#tabsNav button[data-tab="consultores"]').click();
  await espera(150);
  const valSel = id => document.querySelector('#ppVincTbody select[data-vinc-perfil="' + id + '"]').value;
  eq(valSel('p-caio'), '102218', 'Caio já vem sugerido');
  eq(valSel('p-manu'), '102420', 'Manuella (2 L) sugerida para Manuela');
  eq(valSel('p-yas'), '103425', 'Yasmin Bezerra sugerida para Yasmin Silva');
  eq(valSel('p-g1'), '', 'Gabriel (ambíguo) sem sugestão: o admin escolhe');
  assert(document.getElementById('ppVincInfo').textContent.includes('Danilo Morais Araujo'), 'avisa que o Danilo não tem perfil no painel');
  assert(document.getElementById('ppVincTbody').textContent.includes('Sugestão ? — confirme'), 'sugestão fraca marcada com "?"');
  // escolher o mesmo usuário do NeoCRM para os dois Gabriel é bloqueado
  document.querySelector('#ppVincTbody select[data-vinc-perfil="p-g1"]').value = '103196';
  document.querySelector('#ppVincTbody select[data-vinc-perfil="p-g2"]').value = '103196';
  window.__escritas.length = 0;
  document.getElementById('btnPpVincSalvar').click();
  await espera(40);
  assert(window.__escritas.length === 0, 'mesmo usuário do NeoCRM em dois perfis: nada é gravado');
  document.querySelector('#ppVincTbody select[data-vinc-perfil="p-g2"]').value = '103489';
  document.getElementById('btnPpVincSalvar').click();
  await espera(80);
  const up = window.__escritas.find(e => e.tabela === 'consultor_neo' && e.op === 'upsert');
  assert(up && up.rows.length === 5, 'salva os 5 vínculos confirmados — achou ' + (up && up.rows.length));
  assert(up && up.rows.some(r => r.profile_id === 'p-g1' && r.neo_usuario_id === 103196) && up.rows.some(r => r.profile_id === 'p-g2' && r.neo_usuario_id === 103489), 'cada Gabriel no seu ID');
  assert(up && up.opts.onConflict === 'profile_id', 'upsert por perfil');

  // metas
  document.getElementById('ppMetasMes').value = '2026-09';
  window.__tabelas.metas_consultor = [{ profile_id: 'p-caio', meta_receita: 5000, mes: '2026-09-01' }];
  document.getElementById('ppMetasMes').dispatchEvent(new window.Event('change'));
  await espera(80);
  eq(document.querySelector('#ppMetasTbody input[data-meta-perfil="p-caio"]').value, '5000', 'meta existente aparece');
  document.querySelector('#ppMetasTbody input[data-meta-perfil="p-manu"]').value = '3000';
  window.__escritas.length = 0;
  document.getElementById('btnPpMetasSalvar').click();
  await espera(80);
  const mu = window.__escritas.find(e => e.tabela === 'metas_consultor' && e.op === 'upsert');
  assert(mu && mu.rows.length === 2 && mu.rows.every(r => r.mes === '2026-09-01'), 'grava as metas do mês com mes = dia 1');
  assert(mu && mu.rows.some(r => r.profile_id === 'p-manu' && r.meta_receita === 3000), 'meta nova da Manuella');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
