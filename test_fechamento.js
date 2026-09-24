// Testa a aba "Fechamento" (18/09/2026) — relatório de ativações pra comissionamento do consultor,
// só admin. Ver REGRAS_NEGOCIO.md seção 16.14. Mesma técnica dos outros testes do script principal
// (test_conversao_vendas.js): decodifica o <script> real de _template.html, mocka o Supabase (sb) e
// roda dentro de um jsdom, checando funções puras e o DOM renderizado de verdade.
const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// --- fixture: producao_pedidos como viria do Supabase (colunas do select de loadFechamento) ---
function ped(over){
  return Object.assign({
    numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'Caio', etapa: 'CONCLUIDO (NEOCRM)',
    produto: 'Plano X', cliente: 'Cliente X', cnpj: '11222333000144', valor: 0,
    data_portabilidade: null, data_instalacao: null,
  }, over);
}
window.__mockProducaoPedidos = [
  // Caio: 1 contrato de voz (2 linhas, mesmo numero_pedido — não pode contar como 2) + 1 banda larga.
  // Valores (18/09/2026, receita pedida pelo usuário): 50 + 700 (C1) + 100 (C2) + 300 (C3) = 1150.
  ped({ numero_pedido: 'C1', usuario: 'Caio', grupo: 'VOZ - Portabilidade', produto: 'Chip',       valor: 50,  data_portabilidade: '2026-08-15T10:00:00-03:00' }),
  ped({ numero_pedido: 'C1', usuario: 'Caio', grupo: 'VOZ - Portabilidade', produto: 'Aparelho X',  valor: 700, data_portabilidade: '2026-08-15T10:00:00-03:00' }),
  ped({ numero_pedido: 'C2', usuario: 'Caio', grupo: 'BANDA LARGA - Novo',                          valor: 100, data_instalacao:   '2026-08-20T09:00:00-03:00' }),
  // Giovanna: 1 contrato de voz "Renovação" (não portabilidade numérica, mas usa a mesma coluna) dentro do período
  ped({ numero_pedido: 'G1', usuario: 'Giovanna', grupo: 'VOZ - Renovação', valor: 80, data_portabilidade: '2026-09-01T14:00:00-03:00' }),
  // fora do período (antes de 01/08 — nem deveria existir de verdade, mas testa o piso mesmo assim).
  // Valor alto de propósito (999) — se entrasse na soma por engano, os testes de receita pegariam.
  ped({ numero_pedido: 'G0', usuario: 'Giovanna', grupo: 'VOZ - Novo', valor: 999, data_portabilidade: '2026-07-20T10:00:00-03:00' }),
  // etapa perdida/devolvida com data preenchida — não deve contar (não gera comissão)
  ped({ numero_pedido: 'G2', usuario: 'Giovanna', grupo: 'VOZ - Novo', etapa: 'VENDA PERDIDA (NEOCRM)', valor: 999, data_portabilidade: '2026-08-10T10:00:00-03:00' }),
  // Aparelho avulso SEM nenhuma data preenchida — não deve contar (não tem como saber quando ativou)
  ped({ numero_pedido: 'A1', usuario: 'Caio', grupo: 'APARELHO', valor: 999 }),
  // Aparelho avulso COM data_portabilidade preenchida (18/09/2026: "todo e qualquer produto que
  // estiver na data de portabilidade constará como ativação" — não é restrito a grupos VOZ - *)
  // — DEVE contar, mesmo não sendo um produto de voz.
  ped({ numero_pedido: 'C3', usuario: 'Caio', grupo: 'APARELHO', produto: 'Aparelho avulso', valor: 300, data_portabilidade: '2026-08-18T16:00:00-03:00' }),
  // banda larga sem data de instalação preenchida ainda — não deve contar
  ped({ numero_pedido: 'BL2', usuario: 'Caio', grupo: 'BANDA LARGA - Novo', valor: 999 }),
];

function mockQueryBuilder(table){
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: null }),
    then: (resolve) => resolve(table === 'producao_pedidos' ? { data: window.__mockProducaoPedidos, error: null } : { data: [], error: null }),
  };
  return builder;
}
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => mockQueryBuilder(table),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: async () => ({ data: { total: 0, ganho: 0, perdido: 0, andamento: 0, semPedido: 0, pedidosGanho: [], pedidosPerdido: [], pedidosAndamento: [] }, error: null }),
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;
window.Chart = function(ctx, cfg){ this.config = cfg; this.destroy = function(){}; return this; };
// enterApp() sempre clica na aba "producao" (Dashboard de Produção é a home pós-login) e essa aba
// também lê producao_pedidos — como o mock devolve dados não-vazios (precisamos disso pro
// Fechamento), o iframe do Dashapex tenta renderizar de verdade e usa TextDecoder (ausente no jsdom
// por padrão). Não é o que este teste quer exercitar, só precisa não quebrar — usa o TextDecoder de
// verdade do Node.
window.TextDecoder = TextDecoder;
window.process = process; // pra poder forcar process.exit() de dentro do testScript (ver nota abaixo)

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // --- 1) canSeeFechamento() e visibilidade da aba: só admin ---
  currentUser = { id:'u1', nome:'Consultor', username:'consultor', role:'consultor' };
  assert(canSeeFechamento() === false, 'consultor não vê Fechamento');
  currentUser = { id:'u2', nome:'Supervisor', username:'supervisor', role:'supervisor' };
  assert(canSeeFechamento() === false, 'supervisor não vê Fechamento (só admin, é dado de comissão/pagamento)');
  currentUser = { id:'u3', nome:'Admin', username:'admin', role:'admin' };
  assert(canSeeFechamento() === true, 'admin vê Fechamento');

  currentUser = { id:'u1', nome:'Consultor', username:'consultor', role:'consultor' };
  enterApp();
  assert(document.getElementById('tabBtnFechamento').style.display === 'none', 'botão da aba Fechamento escondido pro consultor após login');
  currentUser = { id:'u2', nome:'Supervisor', username:'supervisor', role:'supervisor' };
  enterApp();
  assert(document.getElementById('tabBtnFechamento').style.display === 'none', 'botão da aba Fechamento escondido pro supervisor após login');
  currentUser = { id:'u3', nome:'Admin', username:'admin', role:'admin' };
  enterApp();
  assert(document.getElementById('tabBtnFechamento').style.display === 'inline-block', 'botão da aba Fechamento visível pro admin após login');

  // --- 2) dataAtivacaoFechamento(): 18/09/2026 — QUALQUER produto com data_portabilidade
  // preenchida conta como ativação, não só VOZ - *. BANDA LARGA sem data_portabilidade cai no
  // fallback de data_instalacao. Sem nenhuma das duas, não há data de ativação.
  assert(dataAtivacaoFechamento({ grupo: 'VOZ - Portabilidade', data_portabilidade: 'X', data_instalacao: 'Y' }) === 'X', 'VOZ - * usa data_portabilidade');
  assert(dataAtivacaoFechamento({ grupo: 'VOZ - Renovação', data_portabilidade: 'X' }) === 'X', 'VOZ - Renovação também usa data_portabilidade (mesma coluna cobre todo tipo de ativação de linha)');
  assert(dataAtivacaoFechamento({ grupo: 'APARELHO', data_portabilidade: 'X' }) === 'X', 'Aparelho COM data_portabilidade preenchida conta como ativação (qualquer produto, não só voz)');
  assert(dataAtivacaoFechamento({ grupo: 'SVA FIXA', data_portabilidade: 'X' }) === 'X', 'SVA Fixa COM data_portabilidade preenchida também conta');
  assert(dataAtivacaoFechamento({ grupo: 'BANDA LARGA - Novo', data_instalacao: 'Y' }) === 'Y', 'BANDA LARGA sem data_portabilidade usa data_instalacao (fallback)');
  assert(dataAtivacaoFechamento({ grupo: 'BANDA LARGA - Novo', data_portabilidade: 'X', data_instalacao: 'Y' }) === 'X', 'BANDA LARGA COM data_portabilidade preenchida usa ela (prioridade sobre data_instalacao)');
  assert(dataAtivacaoFechamento({ grupo: 'APARELHO' }) === null, 'produto sem nenhuma das duas datas preenchidas retorna null');
  assert(dataAtivacaoFechamento({ grupo: 'VOZ - Novo', data_portabilidade: null }) === null, 'VOZ sem data_portabilidade preenchida retorna null (não é banda larga, não tem fallback)');

  // --- 3) filtrarRegistrosFechamento(): piso 01/08, só etapa ganho, só produtos com data de ativação ---
  const todos = window.__mockProducaoPedidos;
  const filtradoAgosto = filtrarRegistrosFechamento(todos, '2026-08-01', '2026-08-31');
  assert(filtradoAgosto.length === 4, 'agosto inteiro: 4 linhas qualificadas (2 do pedido C1 + C2 + C3, o Aparelho com portabilidade) — achou ' + filtradoAgosto.length);
  assert(filtradoAgosto.filter(r => r.numero_pedido === 'C1').length === 2, 'as 2 linhas do pedido C1 (mesma venda) aparecem no filtro');
  assert(filtradoAgosto.some(r => r.numero_pedido === 'C3'), 'C3 (Aparelho avulso com data_portabilidade preenchida) entra no filtro');
  assert(!filtradoAgosto.some(r => r.numero_pedido === 'G0'), 'pedido de julho (G0) não entra mesmo com "de" não informado (piso 01/08 sempre se aplica)');
  assert(!filtradoAgosto.some(r => r.numero_pedido === 'G2'), 'pedido com etapa Venda Perdida não entra mesmo com data preenchida');
  assert(!filtradoAgosto.some(r => r.numero_pedido === 'A1'), 'Aparelho sem nenhuma data preenchida não entra');
  assert(!filtradoAgosto.some(r => r.numero_pedido === 'BL2'), 'banda larga sem data_portabilidade nem data_instalacao preenchida não entra');

  const filtradoComDeAntesDoPiso = filtrarRegistrosFechamento(todos, '2026-06-01', '2026-12-31');
  assert(!filtradoComDeAntesDoPiso.some(r => r.numero_pedido === 'G0'), 'mesmo pedindo "de" 01/06, o piso de 01/08 continua valendo (G0, de julho, não entra)');

  const filtradoSetembro = filtrarRegistrosFechamento(todos, '2026-09-01', '2026-09-30');
  assert(filtradoSetembro.length === 1 && filtradoSetembro[0].numero_pedido === 'G1', 'setembro: só o pedido G1 (Giovanna, Renovação)');

  const filtradoSemLimites = filtrarRegistrosFechamento(todos, null, null);
  assert(filtradoSemLimites.length === 5, 'sem "de"/"até": ainda respeita o piso de 01/08 (C1x2 + C2 + C3 + G1 = 5) — achou ' + filtradoSemLimites.length);

  // --- 4) agruparFechamentoPorConsultor(): CONTRATOS distintos (numero_pedido), não linhas, com
  // balde "outros" pros produtos que não são VOZ nem BANDA LARGA (ex.: C3, o Aparelho avulso) ---
  const resumo = agruparFechamentoPorConsultor(filtradoAgosto);
  const caio = resumo.find(r => r.usuario === 'Caio');
  const giovanna = resumo.find(r => r.usuario === 'Giovanna');
  assert(!!caio, 'resumo tem uma entrada pro Caio');
  assert(caio.voz === 1, 'Caio tem 1 contrato de voz (as 2 linhas do pedido C1 contam como 1 só) — achou ' + caio.voz);
  assert(caio.bandaLarga === 1, 'Caio tem 1 contrato de banda larga (C2)');
  assert(caio.outros === 1, 'Caio tem 1 contrato "outros" (C3, Aparelho avulso com portabilidade preenchida) — achou ' + caio.outros);
  assert(caio.total === 3, 'Caio tem 3 contratos no total (1 voz + 1 banda larga + 1 outros) — achou ' + caio.total);
  assert(!giovanna, 'Giovanna não aparece no resumo de agosto (G0 é de julho, G2 é perdido)');

  // --- 4.1) receita (18/09/2026, a pedido do usuário): soma TODA linha qualificada, não deduplicada
  // por pedido — Caio: 50 (Chip) + 700 (Aparelho X) + 100 (banda larga C2) + 300 (Aparelho C3) = 1150.
  // Os valores 999 de G0/G2/A1/BL2 (excluídos do filtro) não podem vazar pra essa soma.
  assert(caio.valor === 1150, 'receita do Caio em agosto é R$1150 (50+700+100+300) — achou ' + caio.valor);

  // --- 5) fluxo completo: loadFechamento() busca do Supabase e renderiza os cards ---
  currentUser = { id:'u3', nome:'Admin', username:'admin', role:'admin' };
  enterApp();
  document.querySelector('#tabsNav button[data-tab="fechamento"]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('fechamentoDe').value = '2026-08-01';
  document.getElementById('fechamentoAte').value = '2026-08-31';
  document.getElementById('btnFechamentoBuscar').click();

  // NOTA: comparações de valor em R$ usam .textContent (não .innerHTML) — fmtBRL() usa um espaço
  // NBSP de verdade entre "R$" e o número, e o innerHTML do jsdom serializa esse caractere de volta
  // pra entidade "&nbsp;" (texto literal), o que faria o .includes(fmtBRL(...)) falhar mesmo com o
  // valor certo na tela. .textContent decodifica a entidade de volta pro mesmo caractere que fmtBRL() gera.
  const resumoHtml = document.getElementById('fechamentoResumoCards').innerHTML;
  const resumoText = document.getElementById('fechamentoResumoCards').textContent;
  assert(resumoHtml.includes('Caio'), 'card do Caio aparece no resumo renderizado');
  assert(resumoHtml.includes('outros'), 'card do Caio menciona o balde "outros" (C3, Aparelho com portabilidade preenchida)');
  assert(resumoText.includes(fmtBRL(1150)), 'card do Caio mostra a receita formatada (R$1150) — achou: ' + resumoText);
  assert(!resumoHtml.includes('Giovanna'), 'Giovanna não aparece (sem ativação qualificada em agosto)');
  assert(document.getElementById('fechamentoResumoCard').style.display === 'block', 'card de resumo fica visível quando há dados');
  assert(document.getElementById('fechamentoEmptyCard').style.display === 'none', 'card de "vazio" fica escondido quando há dados');
  const receitaTotalText = document.getElementById('fechamentoReceitaTotal').textContent;
  assert(receitaTotalText.includes(fmtBRL(1150)), '"Receita total no período" mostra R$1150 (só o Caio qualificou em agosto) — ' + receitaTotalText);

  // --- 6) drilldown: clicar no card do Caio mostra as 4 linhas (2 de C1 + C2 + C3) ---
  const caioCard = Array.from(document.querySelectorAll('#fechamentoResumoCards [data-usuario]')).find(el => el.dataset.usuario === 'Caio');
  assert(!!caioCard, 'card clicável do Caio existe (data-usuario="Caio")');
  caioCard.click();
  assert(document.getElementById('fechamentoDrilldownOverlay').classList.contains('active'), 'clicar no card abre o modal de drilldown');
  assert(document.getElementById('fechamentoDrilldownTitulo').textContent === 'Caio', 'título do drilldown mostra o nome do consultor');
  const linhasDrilldown = document.getElementById('fechamentoDrilldownTbody').querySelectorAll('tr');
  assert(linhasDrilldown.length === 4, 'drilldown do Caio mostra 4 linhas (Chip + Aparelho X do C1, banda larga do C2, aparelho avulso C3) — achou ' + linhasDrilldown.length);
  const drilldownTbodyText = document.getElementById('fechamentoDrilldownTbody').textContent;
  assert(drilldownTbodyText.includes(fmtBRL(700)), 'drilldown mostra o valor de cada linha individualmente (ex.: R$700 do Aparelho X) — não só o total');
  assert(document.getElementById('fechamentoDrilldownSub').textContent.includes(fmtBRL(1150)), 'subtítulo do drilldown mostra a receita total do consultor (R$1150)');
  document.getElementById('fechamentoDrilldownClose').click();
  assert(!document.getElementById('fechamentoDrilldownOverlay').classList.contains('active'), 'X fecha o modal de drilldown');

  // --- 7) período sem nenhum resultado mostra o card de vazio (16-17/08: entre C1 15/08, C3 18/08 e C2 20/08) ---
  document.getElementById('fechamentoDe').value = '2026-08-16';
  document.getElementById('fechamentoAte').value = '2026-08-17';
  document.getElementById('btnFechamentoBuscar').click();
  assert(document.getElementById('fechamentoEmptyCard').style.display === 'block', 'período sem nenhuma ativação qualificada mostra o card de "vazio"');
  assert(document.getElementById('fechamentoResumoCard').style.display === 'none', 'card de resumo some quando não há dados');

  // --- 8) aviso quando "De" é anterior ao piso de dados (01/08/2026) ---
  document.getElementById('fechamentoDe').value = '2026-06-01';
  document.getElementById('fechamentoAte').value = '2026-08-31';
  document.getElementById('btnFechamentoBuscar').click();
  assert(document.getElementById('fechamentoInfo').textContent.includes('01/08/2026'), 'aviso explica que o relatório só considera a partir de 01/08/2026 quando "De" é anterior a isso');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0); // loadProducaoDashboard (aba "producao", que enterApp() sempre abre) arma um setInterval de auto-atualização (ver producaoAutoRefreshTimer) que mantém o processo vivo — força a saída aqui.
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
