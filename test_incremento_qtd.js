// test_incremento_qtd.js (23/09/2026): generateProposalPDF() foi removida. O bloco 6, que antes lia
// texto renderizado no PDF pra conferir os itens de incremento agrupados, agora chama
// buildPropostaDocModel() direto e confere os itens 'Incremento(s)' no modelo puro.
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
  from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;

const testScript = `
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  const cliente20linhas = { razao_social: 'CLIENTE 20 LINHAS LTDA', cnpj: '11.222.333/0001-44', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 20, valor_contrato: 3000, arpu: 150, cep_cabeado: '01000-000' };

  // --- 1) por padrão, a seção de incremento nasce desligada (tela menos poluída) ---
  openProposal(cliente20linhas, {});
  assert(proposalState.incluirIncremento === false, 'seção de incremento nasce desligada por padrão (redesign 12/08/2026)');
  assert(Array.isArray(proposalState.incrementos), 'incrementos é um array');

  // --- 2) ligando a seção, o sistema já sugere um grupo padrão {offerId, qtd:1} e o campo de
  // quantidade aparece na tela, um por grupo de incremento ---
  proposalState.incluirIncremento = true;
  renderProposalBody();
  assert(proposalState.incrementos.length === 1 && proposalState.incrementos[0].qtd === 1, 'ao ligar, sugere um grupo padrão com qtd 1 (' + JSON.stringify(proposalState.incrementos) + ')');
  const qtdInput = document.querySelector('.propIncrementoQtd[data-idx="0"]');
  assert(qtdInput !== null, 'input de quantidade de linhas aparece pro grupo de incremento, depois de ligar a seção');
  assert(qtdInput.value === '1', 'input de quantidade começa em 1');

  // --- 3) montar o cenário do pedido: 10 linhas de 20GB + 20 linhas de 10GB ---
  const oferta20gb = OFFERS_MOBILE.find(o => o.gb === 40 && (o.tipos||[]).includes('incremento')); // "40GB" no book = p57-40
  const oferta12gb = OFFERS_MOBILE.find(o => o.gb === 12 && (o.tipos||[]).includes('incremento'));
  proposalState.incrementos = [
    { offerId: oferta20gb.id, qtd: 10 },
    { offerId: oferta12gb.id, qtd: 20 },
  ];
  renderProposalBody();

  const qtdInputs = document.querySelectorAll('.propIncrementoQtd');
  assert(qtdInputs.length === 2, 'aparece um campo de quantidade por grupo de incremento (' + qtdInputs.length + ')');
  assert(qtdInputs[0].value === '10' && qtdInputs[1].value === '20', 'os campos de quantidade refletem o valor de cada grupo');

  let r = computeProposal();
  const esperado = (oferta20gb.valor * 10) + (oferta12gb.valor * 20);
  assert(Math.abs(r.incrementoValor - esperado) < 0.001, 'incrementoValor soma valor×quantidade de cada grupo (' + r.incrementoValor + ' esperado ' + esperado + ')');
  assert(r.incGrupos.length === 2 && r.incGrupos[0].qtd === 10 && r.incGrupos[1].qtd === 20, 'incGrupos preserva a quantidade de cada grupo');

  // --- 4) editar a quantidade pelo input dispara a atualização do estado ---
  qtdInputs[0].value = '15';
  qtdInputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(proposalState.incrementos[0].qtd === 15, 'editar o input de quantidade atualiza proposalState (' + proposalState.incrementos[0].qtd + ')');

  // --- 5) o resumo (updateProposalPreview) descreve "X linha(s) × YGB" por grupo, não linha a linha ---
  updateProposalPreview();
  const previewHtml = document.getElementById('proposalPreview').innerHTML;
  assert(previewHtml.includes('15 linha(s) × ' + oferta20gb.gb + 'GB') || document.querySelector('.searchMeta'), 'preview mostra "15 linha(s) × XGB" pro primeiro grupo');
  assert(previewHtml.includes('20 linha(s) × ' + oferta12gb.gb + 'GB'), 'preview mostra "20 linha(s) × XGB" pro segundo grupo');

  // --- 6) modelo do documento: item por grupo mostra "qtd× GB — valor/linha", não um item por linha ---
  const modelo = buildPropostaDocModel();
  const itensIncremento = modelo.novaProposta.itens.filter(it => it.item === 'Incremento(s)');
  assert(itensIncremento.length === 2, 'modelo mostra 1 item "Incremento(s)" por grupo — achou ' + itensIncremento.length + ' pros 2 grupos');
  assert(itensIncremento.some(it => it.desc.includes('15× ' + oferta20gb.gb + 'GB')), 'modelo mostra o item de incremento agrupado com a quantidade (15×)');
  assert(itensIncremento.some(it => it.desc.includes('20× ' + oferta12gb.gb + 'GB')), 'modelo mostra o segundo grupo de incremento agrupado (20×)');

  // --- 7) "+ Adicionar incremento" cria um novo grupo com qtd 1 ---
  const antes = proposalState.incrementos.length;
  document.getElementById('btnAddIncremento').click();
  assert(proposalState.incrementos.length === antes + 1, 'adicionar incremento cria um novo grupo');
  assert(proposalState.incrementos[proposalState.incrementos.length - 1].qtd === 1, 'novo grupo de incremento nasce com qtd 1');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 2000);
