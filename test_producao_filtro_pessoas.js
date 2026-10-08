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
  const filtrados = filtrarProducaoPedidos(PEDIDOS);
  assert(filtrados.length === 2, 'só sobram os 2 pedidos de gente da Apex (Caio e Giovanna) — achou ' + filtrados.length);
  assert(filtrados.map(p => p.numero_pedido).sort().join(',') === '1,6', 'os pedidos que sobram são o 1 e o 6 — achou ' + filtrados.map(p => p.numero_pedido).join(','));
  assert(filtrarProducaoPedidos(PEDIDOS).every(p => p.usuario !== 'Vitor Queiroz Cavalcante' && p.usuario !== 'Gabriel Macedo Martins'), 'Vitor Queiroz Cavalcante e Gabriel Macedo Martins não aparecem mais, mesmo tendo usuário no painel');
  assert(filtrarProducaoPedidos(null).length === 0, 'lista vazia/nula não quebra, devolve array vazio');

  const EQUIPE = ['Caio Costa Santana', 'Vitor Queiroz Cavalcante', 'Giovanna Firmina Gonçalves', 'Danilo Morais Araujo', 'Gabriel Macedo Martins', 'Juan de Melo Fernandes', 'BEATRIZ CRISTINA GERMANIA SILVA'];
  const equipeFiltrada = filtrarProducaoEquipe(EQUIPE);
  assert(equipeFiltrada.length === 2 && equipeFiltrada.includes('Caio Costa Santana') && equipeFiltrada.includes('Giovanna Firmina Gonçalves'), 'lista de equipe (usada pro "quem zerou") também exclui as 7 pessoas — achou ' + JSON.stringify(equipeFiltrada));

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
