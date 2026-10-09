// Testa o filtro que tira do Dashboard de Produção (Visão Geral, Cadastro Diário, Visão Diária,
// Fechamento etc.) pessoas que não trabalham na Apex (06/10/2026, pedido do usuário). Filtro só de
// exibição — não apaga nada de producao_pedidos. Ver REGRAS_NEGOCIO.md seção 16.18.
const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: () => ({ select: function(){return this;}, then: (resolve) => resolve({ data: [], error: null }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => {};
window.confirm = () => true;

const testScript = `
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  const PEDIDOS = [
    { numero_pedido: '1', usuario: 'Caio Costa Santana', valor: 100 },
    { numero_pedido: '2', usuario: 'Vitor Queiroz Cavalcante', valor: 200 },
    { numero_pedido: '3', usuario: 'Ranniele da Silva Vieira Cotrim', valor: 300 },
    { numero_pedido: '4', usuario: '  vitoria priscila da silva santos  ', valor: 400 },
    { numero_pedido: '5', usuario: 'DANILO MORAIS ARAUJO', valor: 500 },
    { numero_pedido: '6', usuario: 'Giovanna Firmina Gonçalves', valor: 600 },
    { numero_pedido: '7', usuario: 'Gabriel Macedo Martins', valor: 700 },
    { numero_pedido: '8', usuario: 'JUAN DE MELO FERNANDES', valor: 800 },
    { numero_pedido: '9', usuario: 'Beatriz Cristina Germania Silva', valor: 900 },
  ];
  definirVendedoresOperacao(['RANNIELE DA SILVA VIEIRA COTRIM', 'VITORIA PRISCILA DA SILVA SANTOS', 'JUAN DE MELO FERNANDES',
    'BEATRIZ CRISTINA GERMANIA SILVA'].map(nome => ({ nome, operacao: 'campinas' })));
  const filtrados = filtrarProducaoPedidos(PEDIDOS);
  // 09/10/2026 (seção 78): Ranniele, Vitória Priscila, Juan e Beatriz não são mais escondidos — são da Operação Campinas
  // (mapa vendedores_operacao) e saem da visão da Apex pelo filtro de operação, não pela lista de escondidos.
  assert(filtrados.map(p => p.numero_pedido).sort().join(',') === '1,3,4,6,8,9', 'escondidos só Vitor, Danilo e Gabriel — achou ' + filtrados.map(p => p.numero_pedido).join(','));
  assert(filtrarDashboardPedidos(PEDIDOS).map(p => p.numero_pedido).sort().join(',') === '1,6', 'Dashboard da Apex: só Caio e Giovanna');
  assert(filtrarProducaoPedidos(PEDIDOS).every(p => p.usuario !== 'Vitor Queiroz Cavalcante' && p.usuario !== 'Gabriel Macedo Martins'), 'Vitor Queiroz Cavalcante e Gabriel Macedo Martins não aparecem mais, mesmo tendo usuário no painel');
  assert(filtrarProducaoPedidos(null).length === 0, 'lista vazia/nula não quebra, devolve array vazio');

  const EQUIPE = ['Caio Costa Santana', 'Vitor Queiroz Cavalcante', 'Giovanna Firmina Gonçalves', 'Danilo Morais Araujo', 'Gabriel Macedo Martins', 'Juan de Melo Fernandes', 'BEATRIZ CRISTINA GERMANIA SILVA'];
  const equipeFiltrada = filtrarProducaoEquipe(EQUIPE);
  assert(equipeFiltrada.length === 4 && !equipeFiltrada.includes('Vitor Queiroz Cavalcante'), 'lista de equipe sem Vitor, Danilo e Gabriel — achou ' + JSON.stringify(equipeFiltrada));
  const eqApex = filtrarDashboardEquipe(EQUIPE);
  assert(eqApex.length === 2 && eqApex.includes('Caio Costa Santana') && eqApex.includes('Giovanna Firmina Gonçalves'), 'equipe do Dashboard da Apex (quem zerou) — achou ' + JSON.stringify(eqApex));

  // 09/10/2026 (seção 77): Rafael Santiago e Isabelly saem do Dashboard e do Boletim, mas continuam no Fechamento (comissão)
  const COM_DOIS = PEDIDOS.concat([
    { numero_pedido: '10', usuario: 'Rafael Santiago Angelão', valor: 1000 },
    { numero_pedido: '11', usuario: 'ISABELLY FONSECA BATISTA DA SILVA', valor: 1100 },
  ]);
  assert(filtrarDashboardPedidos(COM_DOIS).map(p => p.numero_pedido).sort().join(',') === '1,6', 'Dashboard: tira as 7 pessoas de fora e também Rafael e Isabelly');
  assert(filtrarProducaoPedidos(COM_DOIS).map(p => p.numero_pedido).sort().join(',') === '1,10,11,3,4,6,8,9', 'Fechamento (filtrarProducaoPedidos): Rafael e Isabelly continuam');
  const eqDash = filtrarDashboardEquipe(EQUIPE.concat(['RAFAEL SANTIAGO ANGELÃO', 'Isabelly Fonseca Batista da Silva']));
  assert(eqDash.length === 2, 'equipe do Dashboard sem Rafael e Isabelly — achou ' + JSON.stringify(eqDash));

  console.log(\`\\n--- RESULTADO: \${ok} passaram, \${fail} falharam ---\`);
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.error('ERRO NO TESTE:', e);
  window.__testResult = 'FAIL';
}
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 50);
