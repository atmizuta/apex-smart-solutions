// test_renovacao_multiplano.js (23/09/2026, troca PDF->DOCX): generateProposalPDF() foi removida.
// O bloco 8, que antes lia texto renderizado no PDF, agora chama buildPropostaDocModel() direto e
// confere os itens de "Renovação" no modelo puro.
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

  const cliente30linhas = { razao_social: 'CLIENTE 30 LINHAS LTDA', cnpj: '11.222.333/0001-44', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 30, valor_contrato: 4500, arpu: 150, cep_cabeado: '01000-000' };

  // --- 1) por padrão, a renovação nasce ligada com 1 grupo já sugerido (auto), qtd = linhas_voz do cliente ---
  openProposal(cliente30linhas, {});
  assert(proposalState.incluirRenovacao === true, 'renovação nasce ligada (ação principal da proposta)');
  assert(Array.isArray(proposalState.renewGrupos) && proposalState.renewGrupos.length === 1, 'renewGrupos nasce com 1 grupo sugerido automaticamente');
  assert(proposalState.renewGrupos[0].qtd === 30, 'o grupo automático já vem com a quantidade total de linhas do cliente (' + proposalState.renewGrupos[0].qtd + ')');

  const qtdInput0 = document.querySelector('.propRenovGrupoQtd[data-idx="0"]');
  assert(qtdInput0 !== null, 'input de quantidade aparece pro grupo de renovação');
  assert(qtdInput0.value === '30', 'input de quantidade reflete o total de linhas');

  // --- 2) "+ Adicionar plano de renovação" divide as linhas em múltiplos planos ---
  document.getElementById('btnAddRenovGrupo').click();
  assert(proposalState.renewGrupos.length === 2, 'adicionar plano de renovação cria um segundo grupo');
  assert(proposalState.renewGrupos[1].qtd === 1, 'novo grupo de renovação nasce com qtd 1');

  // --- 3) montar o cenário: 10 linhas de 20GB + 20 linhas de 40GB (dividindo as 30 linhas da base) ---
  const oferta20gb = OFFERS_MOBILE.find(o => o.gb === 20 && (o.tipos||[]).includes('renovacao')) || OFFERS_MOBILE.find(o => (o.tipos||[]).includes('renovacao'));
  const oferta40gb = OFFERS_MOBILE.find(o => o.gb === 40 && (o.tipos||[]).includes('renovacao')) || OFFERS_MOBILE.filter(o => (o.tipos||[]).includes('renovacao'))[1];
  proposalState.renewGrupos = [
    { qtd: 10, offerId: oferta20gb.id },
    { qtd: 20, offerId: oferta40gb.id },
  ];
  renderProposalBody();

  const qtdInputs = document.querySelectorAll('.propRenovGrupoQtd');
  assert(qtdInputs.length === 2, 'aparece um campo de quantidade por grupo de renovação (' + qtdInputs.length + ')');
  assert(qtdInputs[0].value === '10' && qtdInputs[1].value === '20', 'os campos de quantidade refletem o valor de cada grupo');
  assert(document.querySelectorAll('.btnRemoveRenovGrupo').length === 2, 'botão remover aparece quando há mais de um grupo');

  let r = computeProposal();
  const esperado = (oferta20gb.valor * 10) + (oferta40gb.valor * 20);
  assert(r.baseGrupos.length === 2, 'baseGrupos preserva os 2 grupos de renovação');
  assert(Math.abs(r.baseGrupos.reduce((s,g)=>s+g.offer.valor*g.qtd,0) - esperado) < 0.001, 'valor total soma valor×quantidade de cada plano de renovação');

  // --- 4) editar a quantidade pelo input dispara a atualização do estado ---
  qtdInputs[0].value = '15';
  qtdInputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(proposalState.renewGrupos[0].qtd === 15, 'editar o input de quantidade atualiza proposalState (' + proposalState.renewGrupos[0].qtd + ')');

  // --- 5) trocar a oferta de um grupo pelo select dispara a atualização do estado ---
  const ofertaSelects = document.querySelectorAll('.propRenovGrupoOferta');
  const outraOferta = OFFERS_MOBILE.find(o => (o.tipos||[]).includes('renovacao') && o.id !== proposalState.renewGrupos[1].offerId);
  if(outraOferta){
    ofertaSelects[1].value = outraOferta.id;
    ofertaSelects[1].dispatchEvent(new window.Event('change', { bubbles: true }));
    assert(proposalState.renewGrupos[1].offerId === outraOferta.id, 'trocar a oferta pelo select atualiza proposalState');
  }

  // --- 6) remover um grupo funciona e some da tela ---
  document.querySelector('.btnRemoveRenovGrupo[data-idx="1"]').click();
  assert(proposalState.renewGrupos.length === 1, 'remover grupo de renovação funciona');
  assert(document.querySelectorAll('.propRenovGrupoQtd').length === 1, 'input do grupo removido some da tela');

  // --- 7) resumo (updateProposalPreview) descreve "X linha(s) × YGB" por plano de renovação, não linha a linha ---
  proposalState.renewGrupos = [
    { qtd: 10, offerId: oferta20gb.id },
    { qtd: 20, offerId: oferta40gb.id },
  ];
  updateProposalPreview();
  const previewHtml = document.getElementById('proposalPreview').innerHTML;
  assert(previewHtml.includes('10 linha(s) × ' + oferta20gb.gb + 'GB'), 'preview mostra "10 linha(s) × XGB" pro primeiro plano de renovação');
  assert(previewHtml.includes('20 linha(s) × ' + oferta40gb.gb + 'GB'), 'preview mostra "20 linha(s) × XGB" pro segundo plano de renovação');

  // --- 8) modelo do documento: item por plano de renovação mostra "qtd× GB — valor/linha", não um
  // item por linha ---
  const modelo = buildPropostaDocModel();
  const itensRenovacao = modelo.novaProposta.itens.filter(it => it.item === 'Renovação');
  assert(itensRenovacao.length === 2, 'modelo mostra 1 item "Renovação" por plano — achou ' + itensRenovacao.length + ' pros 2 planos');
  assert(itensRenovacao.some(it => it.desc.includes('10× ' + oferta20gb.gb + 'GB')), 'modelo mostra o primeiro plano de renovação agrupado com a quantidade (10×)');
  assert(itensRenovacao.some(it => it.desc.includes('20× ' + oferta40gb.gb + 'GB')), 'modelo mostra o segundo plano de renovação agrupado (20×)');

  // --- 9) desligar a renovação zera os grupos ---
  document.getElementById('propIncluirRenovacao').click();
  assert(proposalState.incluirRenovacao === false, 'desligar o interruptor desliga a renovação');
  assert(proposalState.renewGrupos.length === 0, 'desligar a renovação zera renewGrupos');

  // --- 10) religar a renovação sugere de novo um grupo automático ---
  document.getElementById('propIncluirRenovacao').click();
  assert(proposalState.incluirRenovacao === true, 'religar o interruptor liga a renovação de novo');
  assert(proposalState.renewGrupos.length === 1, 'religar a renovação sugere de novo um grupo automático');

  // --- 11) combo de convergência aplicado na renovação ajusta a oferta do primeiro grupo, sem apagar os demais ---
  proposalState.renewGrupos = [
    { qtd: 10, offerId: oferta20gb.id },
    { qtd: 20, offerId: oferta40gb.id },
  ];
  proposalState.usarConvergenciaPreset = true;
  renderProposalBody();
  proposalState.convergenciaPresetId = 'conv-800mega-12gb';
  document.getElementById('btnAplicarConvergencia').click();
  assert(proposalState.renewGrupos[0].offerId === 'p57-12', 'aplicar combo de convergência ajusta a oferta do primeiro grupo de renovação (' + proposalState.renewGrupos[0].offerId + ')');
  assert(proposalState.renewGrupos.length === 2, 'aplicar combo de convergência preserva os demais planos de renovação já configurados');

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
