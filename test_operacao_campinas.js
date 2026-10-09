// Operação Campinas (09/10/2026, seção 78): separação NA TELA entre a Operação Apex e a Operação Campinas.
// Cada login tem uma operação (profiles.operacao); cada venda é da operação do vendedor (rpc vendedores_operacao,
// nome do NeoCRM -> operação; vendedor fora do mapa = Apex). Admin vê as duas com um seletor; supervisor e
// consultor ficam presos na própria operação. O Boletim da Manhã é sempre da Operação Apex.
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
  rpc: async () => ({ data: [], error: null }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => {};
window.confirm = () => true;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // mapa como vem do banco (rpc vendedores_operacao): nome do NeoCRM em maiúsculo -> operação
  definirVendedoresOperacao([
    { nome: 'CAIO COSTA SANTANA', operacao: 'apex' },
    { nome: 'VITORIA PRISCILA DA SILVA SANTOS', operacao: 'campinas' },
    { nome: 'BEATRIZ CRISTINA GERMANIA SILVA', operacao: 'campinas' },
    { nome: 'RANNIELE DA SILVA VIEIRA COTRIM', operacao: 'campinas' },
    { nome: 'JUAN DE MELO FERNANDES', operacao: 'campinas' },
    { nome: 'LIXO', operacao: 'marte' },
  ]);
  assert(operacaoDoVendedor('  juan de melo fernandes ') === 'campinas', 'nome com espaço/minúscula acha a operação');
  assert(operacaoDoVendedor('GIOVANNA FIRMINA GONÇALVES') === 'apex', 'vendedor fora do mapa = Apex');
  assert(operacaoDoVendedor('LIXO') === 'apex', 'operação desconhecida no banco = Apex');

  const PEDIDOS = [
    { numero_pedido: '1', usuario: 'Caio Costa Santana' },
    { numero_pedido: '2', usuario: 'Giovanna Firmina Gonçalves' },          // sem vínculo -> Apex
    { numero_pedido: '3', usuario: 'Vitoria Priscila da Silva Santos' },
    { numero_pedido: '4', usuario: 'BEATRIZ CRISTINA GERMANIA SILVA' },
    { numero_pedido: '5', usuario: 'Ranniele da Silva Vieira Cotrim' },
    { numero_pedido: '6', usuario: 'Juan de Melo Fernandes' },
    { numero_pedido: '7', usuario: 'Vitor Queiroz Cavalcante' },            // continua fora de tudo
    { numero_pedido: '8', usuario: 'ISABELLY FONSECA BATISTA DA SILVA' },   // fora do dashboard (seção 77)
  ];
  const ids = rows => rows.map(p => p.numero_pedido).sort().join(',');

  // sem ninguém logado: Apex
  currentUser = null;
  assert(operacaoAtiva() === 'apex', 'sem usuário: Apex');

  // os 4 de Campinas saíram da lista de escondidos; Vitor, Danilo e Gabriel continuam
  assert(ids(filtrarProducaoPedidos(PEDIDOS)) === '1,2,3,4,5,6,8', 'filtrarProducaoPedidos não esconde mais Campinas, só o Vitor — achou ' + ids(filtrarProducaoPedidos(PEDIDOS)));
  assert(!PRODUCAO_USUARIOS_EXCLUIDOS.has('JUAN DE MELO FERNANDES') && PRODUCAO_USUARIOS_EXCLUIDOS.has('DANILO MORAIS ARAUJO'), 'lista de escondidos sem Campinas, com Danilo');

  // admin: seletor, abre na Apex
  currentUser = { id: 'a1', role: 'admin', operacao: 'apex' };
  operacaoSelecionada = 'apex';
  assert(podeTrocarOperacao(), 'admin troca de operação');
  assert(ids(filtrarDashboardPedidos(PEDIDOS)) === '1,2', 'admin na Apex: só Caio e Giovanna — achou ' + ids(filtrarDashboardPedidos(PEDIDOS)));
  operacaoSelecionada = 'campinas';
  assert(ids(filtrarDashboardPedidos(PEDIDOS)) === '3,4,5,6', 'admin em Campinas: os 4 de Campinas — achou ' + ids(filtrarDashboardPedidos(PEDIDOS)));
  assert(ids(filtrarDashboardPedidos(PEDIDOS, 'apex')) === '1,2', 'operação explícita vence o seletor');
  const EQUIPE = ['CAIO COSTA SANTANA', 'Juan de Melo Fernandes', 'BEATRIZ CRISTINA GERMANIA SILVA', 'VITOR QUEIROZ CAVALCANTE'];
  assert(JSON.stringify(filtrarDashboardEquipe(EQUIPE)) === JSON.stringify(['Juan de Melo Fernandes', 'BEATRIZ CRISTINA GERMANIA SILVA']), 'equipe ("quem zerou") de Campinas');
  assert(JSON.stringify(filtrarDashboardEquipe(EQUIPE, 'apex')) === JSON.stringify(['CAIO COSTA SANTANA']), 'equipe da Apex');
  const PERD = [{ usuario: 'Caio Costa Santana' }, { usuario: 'Juan de Melo Fernandes' }];
  assert(filtrarDashboardPerdidas(PERD).length === 1 && filtrarDashboardPerdidas(PERD)[0].usuario === 'Juan de Melo Fernandes', 'vendas perdidas seguem a operação');
  assert(filtrarDashboardPerdidas(null) === null, 'vendas perdidas com erro (null) continuam null');
  assert(veAbasDaApex(), 'admin vê Mesa, Boletim, Digital e Usuários');
  assert(canSeeMesa() && canSeeBoletim() && canSeeConversao() && canSeeMonitoramentoLeads(), 'admin: abas da Apex liberadas');

  // supervisor de Campinas (Jaime): sem seletor, preso em Campinas, sem as abas só da Apex
  currentUser = { id: 's1', role: 'supervisor', operacao: 'campinas' };
  operacaoSelecionada = 'apex'; // mesmo que alguém mexa no estado, não-admin ignora o seletor
  assert(!podeTrocarOperacao(), 'supervisor não troca de operação');
  assert(operacaoAtiva() === 'campinas', 'supervisor de Campinas vê Campinas');
  assert(ids(filtrarDashboardPedidos(PEDIDOS)) === '3,4,5,6', 'Jaime: só os 4 de Campinas');
  assert(!veAbasDaApex(), 'Jaime não vê as abas só da Apex');
  assert(!canSeeMesa() && !canSeeBoletim() && !canSeeConversao() && !canSeeMonitoramentoLeads(), 'Jaime: sem Mesa, Boletim, Digital e Monitoramento');
  trocarOperacao('apex');
  assert(operacaoAtiva() === 'campinas', 'trocarOperacao não faz nada para não-admin');

  // consultor de Campinas: ranking só de Campinas
  currentUser = { id: 'c1', role: 'consultor', operacao: 'campinas' };
  assert(ids(filtrarDashboardPedidos(PEDIDOS)) === '3,4,5,6', 'consultor de Campinas: só Campinas');
  assert(!canSeeConversao(), 'consultor de Campinas sem Digital');
  // consultor/supervisor da Apex: igual a hoje
  currentUser = { id: 'c2', role: 'consultor', operacao: 'apex' };
  assert(ids(filtrarDashboardPedidos(PEDIDOS)) === '1,2', 'consultor da Apex: só Apex');
  assert(canSeeConversao(), 'consultor da Apex continua com Digital');
  currentUser = { id: 's2', role: 'supervisor' }; // perfil sem a coluna (banco antigo) = Apex
  assert(operacaoAtiva() === 'apex' && canSeeMesa() && canSeeBoletim(), 'perfil sem operação = Apex, como hoje');

  // Boletim da Manhã: sempre Apex, qualquer que seja o seletor
  currentUser = { id: 'a1', role: 'admin', operacao: 'apex' };
  operacaoSelecionada = 'campinas';
  assert(bmFora('JUAN DE MELO FERNANDES'), 'boletim: vendedor de Campinas fica fora');
  assert(bmFora('VITOR QUEIROZ CAVALCANTE') && bmFora('ISABELLY FONSECA BATISTA DA SILVA'), 'boletim: quem já estava fora continua fora');
  assert(!bmFora('CAIO COSTA SANTANA') && !bmFora('GIOVANNA FIRMINA GONÇALVES'), 'boletim: Apex (com ou sem vínculo) entra');

  // funil: supervisor vê só propostas de consultores da operação dele; admin vê tudo
  const PERFIS = { p1: { id: 'p1', operacao: 'apex' }, p2: { id: 'p2', operacao: 'campinas' }, p3: { id: 'p3' } };
  const PROPS = [{ id: 1, consultor_id: 'p1' }, { id: 2, consultor_id: 'p2' }, { id: 3, consultor_id: 'p3' }, { id: 4, consultor_id: 'sumiu' }];
  currentUser = { id: 's1', role: 'supervisor', operacao: 'campinas' };
  assert(JSON.stringify(funilDaOperacao(PROPS, PERFIS).map(p => p.id)) === '[2]', 'Jaime: só a proposta do consultor de Campinas');
  currentUser = { id: 's2', role: 'supervisor', operacao: 'apex' };
  assert(JSON.stringify(funilDaOperacao(PROPS, PERFIS).map(p => p.id)) === '[1,3,4]', 'supervisor da Apex: Apex + perfil sem operação + consultor apagado');
  currentUser = { id: 'a1', role: 'admin', operacao: 'apex' };
  assert(funilDaOperacao(PROPS, PERFIS).length === 4, 'admin: funil inteiro');

  // seletor na tela: no topo do Dashboard e do Fechamento, só para admin
  const selDash = document.querySelector('#panel-producao [data-operacao-seletor]');
  const selFech = document.querySelector('#panel-fechamento [data-operacao-seletor]');
  assert(!!selDash && !!selFech, 'seletor existe no Dashboard e no Fechamento');
  assert(selDash && selDash.querySelectorAll('button[data-operacao]').length === 2, 'duas opções');
  assert(selDash && /Operação Apex/.test(selDash.textContent) && /Operação Campinas/.test(selDash.textContent), 'rótulos "Operação Apex" e "Operação Campinas"');

  let chamadas = [];
  loadProducaoDashboard = async () => { chamadas.push('dash:' + operacaoAtiva()); };
  loadFechamento = async () => { chamadas.push('fech:' + operacaoAtiva()); };
  currentUser = { id: 'a1', role: 'admin', operacao: 'apex' };
  operacaoSelecionada = 'apex';
  opAtualizarSeletores();
  document.getElementById('panel-fechamento').classList.add('active'); // Fechamento na tela
  assert(selDash.style.display !== 'none' && selFech.style.display !== 'none', 'admin vê o seletor');
  assert(selDash.querySelector('button[data-operacao="apex"]').classList.contains('active'), 'Apex marcada');
  selDash.querySelector('button[data-operacao="campinas"]').click();
  await new Promise(r => setTimeout(r, 0));
  assert(operacaoSelecionada === 'campinas', 'clique troca para Campinas');
  assert(selFech.querySelector('button[data-operacao="campinas"]').classList.contains('active'), 'o seletor do Fechamento acompanha');
  assert(chamadas.indexOf('dash:campinas') >= 0, 'recarrega o Dashboard em Campinas — chamadas: ' + chamadas.join(','));
  assert(chamadas.indexOf('fech:campinas') >= 0, 'recarrega o Fechamento em Campinas');
  chamadas = [];
  selDash.querySelector('button[data-operacao="campinas"]').click();
  await new Promise(r => setTimeout(r, 0));
  assert(chamadas.length === 0, 'clicar na operação que já está não recarrega');

  currentUser = { id: 's1', role: 'supervisor', operacao: 'campinas' };
  opAtualizarSeletores();
  assert(selDash.style.display === 'none' && selFech.style.display === 'none', 'não-admin não vê o seletor');

  // carga do mapa: falha no banco não quebra (todo mundo vira Apex) e avisa
  let avisos = [];
  const avisoOriginal = mostrarAviso;
  mostrarAviso = (m, t) => avisos.push(t);
  sb.rpc = async () => ({ data: null, error: { message: 'x' } });
  await carregarVendedoresOperacao();
  assert(operacaoDoVendedor('JUAN DE MELO FERNANDES') === 'apex' && avisos.indexOf('erro') >= 0, 'falha no mapa: todo mundo Apex + aviso de erro');
  sb.rpc = async (nome) => ({ data: nome === 'vendedores_operacao' ? [{ nome: 'JUAN DE MELO FERNANDES', operacao: 'campinas' }] : [], error: null });
  await carregarVendedoresOperacao();
  assert(operacaoDoVendedor('JUAN DE MELO FERNANDES') === 'campinas', 'mapa recarregado do banco');
  mostrarAviso = avisoOriginal;

  console.log('\\n--- RESULTADO: ' + ok + ' passaram, ' + fail + ' falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.error('ERRO NO TESTE:', e);
  window.__testResult = 'FAIL';
}
})();
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK'){ console.log('resultado:', window.__testResult); process.exitCode = 1; }
}, 300);
