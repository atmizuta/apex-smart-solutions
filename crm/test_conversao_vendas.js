const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__mockLeads = [];
window.__mockConfig = null;
window.__lastSyncInvoked = false;
window.__syncResult = { data: { ok: true, total: 0, atualizado_em: '25/08/2026 10:00' }, error: null };
function mockQueryBuilder(table){
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    in: () => builder,   // usado por buscarVendasOrigemLead (producao_pedidos) — ver test_venda_origem_lead.js
    gte: () => builder,  // idem
    lt: () => builder,   // idem
    maybeSingle: async () => (table === 'config' ? { data: window.__mockConfig } : { data: null }),
    then: (resolve) => resolve(table === 'leads' ? { data: window.__mockLeads, error: null } : { data: [], error: null }),
  };
  return builder;
}
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => mockQueryBuilder(table),
  functions: { invoke: async (name) => { window.__lastSyncInvoked = name; return window.__syncResult; } },
  // usado por renderReconciliacaoNeoCRM quando quem está logado NÃO é admin/supervisor (ver
  // test_venda_origem_lead.js pro teste de verdade do card/drilldown) — aqui só evita
  // "sb.rpc is not a function" caso loadConversaoVendas() rode como consultor neste arquivo.
  rpc: async () => ({ data: { total: 0, ganho: 0, perdido: 0, andamento: 0, semPedido: 0, pedidosGanho: [], pedidosPerdido: [], pedidosAndamento: [] }, error: null }),
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;
// jsdom não tem canvas/Chart.js de verdade — mesmo mock usado em test_movimentacao.js, só pra
// garantir que o código chama `new Chart(...)` sem quebrar (o teste visual em si fica por conta
// de conferir os dados que alimentam o gráfico, não o desenho do canvas).
window.Chart = function(ctx, cfg){ this.config = cfg; this.destroy = function(){}; return this; };

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  function lead(overrides){
    return Object.assign({ consultor: 'Caio', status: 'EM NEGOCIAÇÂO', categoria: 'andamento', converteu: false, receita: 0 }, overrides);
  }

  // --- 1) controle de visibilidade (01/09/2026: consultor também passou a ver a aba "Digital") ---
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  assert(canSeeConversao() === true, 'consultor vê a aba Digital (liberado em 01/09/2026)');
  currentUser = { id: 'u2', nome: 'Supervisor Teste', username: 'supervisor', role: 'supervisor' };
  assert(canSeeConversao() === true, 'supervisor vê a aba Digital');
  currentUser = { id: 'u3', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  assert(canSeeConversao() === true, 'admin vê a aba Digital');
  enterApp();
  assert(document.getElementById('tabBtnConversao').style.display === 'inline-block', 'botão da aba fica visível pro admin depois do login');
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  enterApp();
  assert(document.getElementById('tabBtnConversao').style.display === 'inline-block', 'botão da aba Digital também fica visível pro consultor depois do login');
  assert(document.getElementById('tabBtnConsultores').style.display === 'none', 'botão da aba Usuários continua escondido pro consultor');
  assert(document.getElementById('tabBtnBaseDados').style.display === 'none', 'botão da aba Upload Base continua escondido pro consultor');
  assert(document.getElementById('tabBtnMovimentacao').style.display === 'none', 'botão da aba Upload Dash continua escondido pro consultor');
  // ver os dados x sincronizar são permissões diferentes: o botão "Atualizar agora" continua só
  // pra admin/supervisor, mesmo com a aba liberada pro consultor (a Edge Function já recusa 403)
  assert(canSyncConversao() === false, 'consultor não pode disparar a sincronização (canSyncConversao)');
  assert(document.getElementById('btnConversaoSync').style.display === 'none', 'botão "Atualizar agora" fica escondido pro consultor');
  currentUser = { id: 'u2', nome: 'Supervisor Teste', username: 'supervisor', role: 'supervisor' };
  enterApp();
  assert(canSyncConversao() === true, 'supervisor pode disparar a sincronização (canSyncConversao)');
  assert(document.getElementById('btnConversaoSync').style.display === 'inline-block', 'botão "Atualizar agora" fica visível pro supervisor');
  currentUser = { id: 'u3', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  enterApp();
  assert(canSyncConversao() === true, 'admin pode disparar a sincronização (canSyncConversao)');
  assert(document.getElementById('btnConversaoSync').style.display === 'inline-block', 'botão "Atualizar agora" fica visível pro admin');

  // --- 2) sem leads ainda: mostra estado vazio ---
  window.__mockLeads = [];
  window.__mockConfig = null;
  await loadConversaoVendas();
  assert(document.getElementById('conversaoEmptyCard').style.display === 'block', 'sem leads, mostra o card de estado vazio');
  assert(document.getElementById('conversaoWrap').style.display === 'none', 'sem leads, esconde os cards de resumo/tabelas');
  assert(document.getElementById('conversaoSyncStatus').textContent.includes('Nunca sincronizado'), 'sem config de sincronização, avisa que nunca sincronizou');

  // --- 3) com leads: KPIs, por consultor e funil por status ---
  window.__mockLeads = [
    lead({ consultor: 'Caio', status: 'PEDIDO CONCLUIDO (VENDA)', categoria: 'convertido', converteu: true, receita: 39.99 }),
    lead({ consultor: 'Caio', status: 'CLIENTE NÃO RESPONDE', categoria: 'perdido', converteu: false, receita: 0 }),
    lead({ consultor: 'Giovanna', status: 'PEDIDO CONCLUIDO (VENDA)', categoria: 'convertido', converteu: true, receita: 74.99 }),
    lead({ consultor: 'Giovanna', status: 'EM NEGOCIAÇÂO', categoria: 'andamento', converteu: false, receita: 0 }),
    lead({ consultor: null, status: '', categoria: 'sem_contato', converteu: false, receita: 0 }),
  ];
  window.__mockConfig = { valor: '25/08/2026 14:00' };
  await loadConversaoVendas();

  assert(document.getElementById('conversaoEmptyCard').style.display === 'none', 'com leads, esconde o card de estado vazio');
  assert(document.getElementById('conversaoWrap').style.display === 'block', 'com leads, mostra os cards de resumo/tabelas');
  assert(document.getElementById('conversaoSyncStatus').textContent.includes('25/08/2026 14:00'), 'mostra a data da última sincronização vinda do config');

  const resumoHtml = document.getElementById('conversaoResumoCards').innerHTML;
  assert((resumoHtml.match(/class="kpiCard"/g) || []).length === 4, 'resumo mostra 4 cards modernos (kpiCard): leads, convertidos, taxa, receita');
  assert(resumoHtml.includes('kpiValue">5<'), 'KPI de total de leads mostra 5 (' + resumoHtml + ')');
  assert(resumoHtml.includes('kpiValue">2<'), 'KPI de convertidos mostra 2');
  assert(resumoHtml.includes('40,0%'), 'KPI de taxa de conversão geral mostra 40,0% (2 de 5)');
  assert(resumoHtml.includes('114,98') || resumoHtml.includes('114,99'), 'KPI de receita soma os valores dos leads convertidos (39,99 + 74,99)');
  assert(resumoHtml.includes('kpiBarTrack') && resumoHtml.includes('kpiBarFill'), 'KPI de taxa de conversão tem barra de progresso visual');
  assert(resumoHtml.includes('ticket médio'), 'KPI de receita mostra o ticket médio como contexto adicional');

  // gráfico doughnut + legenda do funil por categoria
  assert(conversaoFunilChartInstance && conversaoFunilChartInstance.config && conversaoFunilChartInstance.config.type === 'doughnut', 'gráfico doughnut do funil por categoria foi criado com o tipo certo');
  const somaGrafico = conversaoFunilChartInstance.config.data.datasets[0].data.reduce((a,b)=>a+b,0);
  assert(somaGrafico === 5, 'os dados do gráfico doughnut somam o total de leads mockados (5), soma real: ' + somaGrafico);
  assert(conversaoFunilChartInstance.config.data.labels.join(',') === 'Convertido,Perdido,Em andamento,Sem contato', 'gráfico usa os rótulos amigáveis das 4 categorias, na ordem certa');
  const legendHtml = document.getElementById('conversaoFunilLegend').innerHTML;
  assert(legendHtml.includes('Convertido') && legendHtml.includes('Perdido') && legendHtml.includes('Em andamento') && legendHtml.includes('Sem contato'), 'legenda do funil lista as 4 categorias');
  assert((legendHtml.match(/legendDot/g) || []).length === 4, 'legenda tem uma bolinha colorida por categoria');

  const consultorHtml = document.getElementById('conversaoConsultorTbody').innerHTML;
  const idxCaio = consultorHtml.indexOf('Caio');
  const idxGiovanna = consultorHtml.indexOf('Giovanna');
  const idxSemConsultor = consultorHtml.indexOf('(Sem consultor)');
  assert(idxCaio > -1 && idxGiovanna > -1, 'tabela por consultor lista Caio e Giovanna');
  assert(idxSemConsultor > idxCaio && idxSemConsultor > idxGiovanna, 'lead sem consultor aparece por último na tabela, como "(Sem consultor)"');
  assert(consultorHtml.includes('50,0%'), 'taxa de conversão do Caio (1 de 2) aparece como 50,0%');
  assert((consultorHtml.match(/miniBarCell/g) || []).length === 3, 'cada linha da tabela de consultor mostra a barra visual de conversão (miniBarCell)');

  const statusHtml = document.getElementById('conversaoStatusTbody').innerHTML;
  assert(statusHtml.includes('PEDIDO CONCLUIDO (VENDA)'), 'funil por status lista PEDIDO CONCLUIDO (VENDA)');
  assert(statusHtml.includes('Convertido'), 'funil por status mostra o rótulo amigável da categoria (Convertido, não "convertido")');
  assert(statusHtml.includes('(Sem status)'), 'lead sem status aparece como "(Sem status)" no funil');
  assert(statusHtml.includes('catBadge convertido') && statusHtml.includes('catBadge perdido'), 'funil por status usa badges coloridos por categoria');
  assert((statusHtml.match(/miniBarCell/g) || []).length > 0, 'funil por status mostra barra visual do percentual, não só o número');

  // --- 4) botão "Atualizar agora" chama a Edge Function sync-leads e recarrega os dados ---
  // a config "leads_atualizado_em" também é atualizada de fato pela Edge Function no banco real,
  // então simulamos isso aqui pra o loadConversaoVendas() disparado em seguida já buscar o valor novo.
  window.__syncResult = { data: { ok: true, total: 87, atualizado_em: '25/08/2026 15:30' }, error: null };
  window.__mockConfig = { valor: '25/08/2026 15:30' };
  document.getElementById('btnConversaoSync').click();
  await new Promise(r => setTimeout(r, 20));
  assert(window.__lastSyncInvoked === 'sync-leads', 'botão Atualizar chama a Edge Function "sync-leads"');
  assert(document.getElementById('conversaoSyncStatus').textContent.includes('15:30'), 'depois de sincronizar, o status reflete a nova data de sincronização (' + document.getElementById('conversaoSyncStatus').textContent + ')');

  // --- 5) erro na sincronização é exibido sem travar a tela ---
  window.__syncResult = { data: { error: 'Você não tem permissão para sincronizar os leads.' }, error: null };
  document.getElementById('btnConversaoSync').click();
  await new Promise(r => setTimeout(r, 20));
  assert(document.getElementById('conversaoSyncStatus').textContent.includes('permissão'), 'erro de permissão da Edge Function aparece pro usuário (' + document.getElementById('conversaoSyncStatus').textContent + ')');

  // --- 6) erro "non-2xx" do supabase-js (04/09/2026): a mensagem real vem de error.context (Response),
  // não de error.message (que é sempre genérica) — o painel precisa ler o corpo JSON pra mostrar o
  // motivo de verdade, em vez de "Edge Function returned a non-2xx status code".
  window.__syncResult = {
    data: null,
    error: {
      message: 'Edge Function returned a non-2xx status code',
      context: { json: async () => ({ error: 'Erro ao gravar leads: duplicate key value violates unique constraint' }) },
    },
  };
  document.getElementById('btnConversaoSync').click();
  await new Promise(r => setTimeout(r, 20));
  assert(document.getElementById('conversaoSyncStatus').textContent.includes('duplicate key'), 'mensagem real do erro (lida de error.context) aparece pro usuário, não o texto genérico do supabase-js (' + document.getElementById('conversaoSyncStatus').textContent + ')');
  assert(!document.getElementById('conversaoSyncStatus').textContent.includes('non-2xx'), 'texto genérico "non-2xx status code" NÃO aparece mais pro usuário');

  // erro sem context.json (ex.: falha de rede) continua caindo pra mensagem genérica, sem quebrar
  window.__syncResult = { data: null, error: { message: 'Failed to fetch' } };
  document.getElementById('btnConversaoSync').click();
  await new Promise(r => setTimeout(r, 20));
  assert(document.getElementById('conversaoSyncStatus').textContent.includes('Failed to fetch'), 'sem context.json, cai pra mensagem genérica do erro (sem travar) — ' + document.getElementById('conversaoSyncStatus').textContent);

  // --- 7) filtro de período (09/09/2026): pílulas de atalho (Tudo/Hoje/7 dias/Este mês) + campos
  // De/Até manuais. Datas relativas ao "hoje" calculado por hojeSP() (não datas fixas) pra o teste
  // não depender de quando ele é rodado.
  const hoje = hojeSP();
  const ontem = somaDiasStr(hoje, -1);
  const ha10dias = somaDiasStr(hoje, -10);
  const primeiroDoMes = hoje.slice(0, 8) + '01';
  window.__mockLeads = [
    lead({ consultor: 'Caio', criado_em_lead: hoje + 'T09:00:00-03:00', receita: 10 }),
    lead({ consultor: 'Giovanna', criado_em_lead: ontem + 'T09:00:00-03:00', receita: 20 }),
    lead({ consultor: 'Rafael', criado_em_lead: ha10dias + 'T09:00:00-03:00', receita: 30 }),
    lead({ consultor: 'Vitor', criado_em_lead: primeiroDoMes + 'T09:00:00-03:00', receita: 40 }),
    lead({ consultor: null, criado_em_lead: null, receita: 50 }), // sem data conhecida (some do funil quando um período específico é escolhido)
  ];
  window.__mockConfig = { valor: '09/09/2026 08:00' };
  await loadConversaoVendas();

  // "Tudo" é o padrão: os 5 leads contam, inclusive o sem data
  let infoTxt = document.getElementById('conversaoPeriodoInfo').textContent;
  assert(infoTxt.includes('5 leads no total'), 'sem filtro de período (Tudo), mostra o total de leads, inclusive o sem data (' + infoTxt + ')');
  assert(document.getElementById('conversaoResumoCards').innerHTML.includes('kpiValue">5<'), 'sem filtro, KPI de leads mostra 5');
  assert(document.querySelector('#conversaoPeriodoPills [data-periodo="tudo"]').classList.contains('active'), 'pílula "Tudo" começa ativa');

  // pílula "Hoje": só o lead criado hoje (exclui inclusive o sem data)
  document.querySelector('#conversaoPeriodoPills [data-periodo="hoje"]').click();
  assert(document.getElementById('conversaoPeriodoDe').value === hoje, 'pílula "Hoje" preenche o campo De com a data de hoje');
  assert(document.getElementById('conversaoPeriodoAte').value === hoje, 'pílula "Hoje" preenche De e Até com a MESMA data — é assim que o filtro de um dia só funciona');
  assert(document.getElementById('conversaoResumoCards').innerHTML.includes('kpiValue">1<'), 'pílula "Hoje" filtra pra só o lead criado hoje (1 de 5)');
  infoTxt = document.getElementById('conversaoPeriodoInfo').textContent;
  assert(infoTxt.includes('1 de 5 leads no período'), 'texto do período mostra "1 de 5" com a pílula Hoje ativa (' + infoTxt + ')');
  assert(document.querySelector('#conversaoPeriodoPills [data-periodo="hoje"]').classList.contains('active'), 'pílula "Hoje" fica marcada como ativa ao ser clicada');
  assert(!document.querySelector('#conversaoPeriodoPills [data-periodo="tudo"]').classList.contains('active'), 'pílula "Tudo" perde o estado ativo quando outra é escolhida');

  // volta pra "Tudo"
  document.querySelector('#conversaoPeriodoPills [data-periodo="tudo"]').click();
  assert(document.getElementById('conversaoPeriodoDe').value === '', 'pílula "Tudo" limpa o campo De');
  assert(document.getElementById('conversaoPeriodoAte').value === '', 'pílula "Tudo" limpa o campo Até');
  assert(document.getElementById('conversaoResumoCards').innerHTML.includes('kpiValue">5<'), 'pílula "Tudo" volta a mostrar todos os 5 leads');

  // "Últimos 7 dias": hoje + ontem entram, o de 10 dias atrás fica de fora
  document.querySelector('#conversaoPeriodoPills [data-periodo="7dias"]').click();
  assert(document.getElementById('conversaoResumoCards').innerHTML.includes('kpiValue">2<'), '"Últimos 7 dias" inclui hoje e ontem, mas não o lead de 10 dias atrás nem o sem data (2 de 5)');

  // "Este mês": hoje e o lead do 1º dia do mês sempre caem dentro (garantido pela própria construção
  // das datas de teste); "ontem" também entra a menos que hoje seja dia 1 — por isso aceita 2 ou 3.
  document.querySelector('#conversaoPeriodoPills [data-periodo="mes"]').click();
  const kpiMesHtml = document.getElementById('conversaoResumoCards').innerHTML;
  assert(kpiMesHtml.includes('kpiValue">2<') || kpiMesHtml.includes('kpiValue">3<'), '"Este mês" inclui pelo menos hoje e o lead do 1º dia do mês (2 ou 3, a depender se ontem cai no mesmo mês) — ' + kpiMesHtml);

  // campos De/Até manuais (digitados, não por pílula): intervalo cobrindo "10 dias atrás" até "ontem"
  document.getElementById('conversaoPeriodoDe').value = ha10dias;
  document.getElementById('conversaoPeriodoDe').dispatchEvent(new window.Event('change'));
  document.getElementById('conversaoPeriodoAte').value = ontem;
  document.getElementById('conversaoPeriodoAte').dispatchEvent(new window.Event('change'));
  assert(!document.querySelector('#conversaoPeriodoPills .filterPill.active'), 'editar os campos De/Até manualmente desativa todas as pílulas de atalho');
  const consultorHtmlCustom = document.getElementById('conversaoConsultorTbody').innerHTML;
  assert(consultorHtmlCustom.includes('Rafael'), 'filtro De/Até manual inclui o lead de 10 dias atrás (Rafael)');
  assert(consultorHtmlCustom.includes('Giovanna'), 'filtro De/Até manual inclui o lead de ontem (Giovanna)');
  assert(!consultorHtmlCustom.includes('Caio'), 'filtro De/Até manual exclui o lead de hoje, fora do intervalo (até ontem)');

  // leadDateSP/somaDiasStr: sanidade das funções puras de data usadas pelo filtro
  assert(leadDateSP(hoje + 'T23:50:00-03:00') === hoje, 'leadDateSP extrai a data certa (fuso de SP) de um horário perto da meia-noite');
  assert(leadDateSP(null) === null, 'leadDateSP retorna null pra data ausente');
  assert(leadDateSP('data-invalida') === null, 'leadDateSP retorna null pra data inválida, sem quebrar');
  assert(somaDiasStr('2026-09-01', -1) === '2026-08-31', 'somaDiasStr cruza a virada do mês corretamente');
  assert(somaDiasStr('2026-12-31', 1) === '2027-01-01', 'somaDiasStr cruza a virada do ano corretamente');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
})();
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 500);
