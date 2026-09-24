// test_convergencia.js (23/09/2026): generateProposalPDF() foi removida. As duas asserções que
// antes liam o texto renderizado no PDF ("(Convergência)" no item da fibra + nota de rodapé) agora
// checam direto o modelo puro retornado por buildPropostaDocModel(): o item "Claro Fibra" tem
// "(Convergência)" na descrição, e novaProposta.notaFibra vira true. O resto do arquivo (preview via
// updateProposalPreview/computeProposal) não muda.
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

  const clienteBase = {
    razao_social: 'CLIENTE BASE TESTE LTDA', cnpj: '11.222.333/0001-44', cidade: 'São Paulo', ddd: '11',
    linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000',
  };

  // --- 1) fibra + renovação (cliente da base) -> convergência ativa ---
  openProposal(clienteBase, {});
  proposalState.incluirFixa = true;
  updateProposalPreview();
  let r = computeProposal();
  assert(r.convergenciaAtiva === true, 'fibra + renovação ativa a convergência');
  let previewHtml = document.getElementById('proposalPreview').innerHTML;
  assert(previewHtml.includes('Oferta de Convergência'), 'preview mostra o badge de Oferta de Convergência');

  // --- 2) fibra sozinha, sem renovação e sem incremento -> convergência NÃO ativa ---
  proposalState.incluirRenovacao = false;
  proposalState.incluirIncremento = false;
  updateProposalPreview();
  r = computeProposal();
  assert(r.convergenciaAtiva === false, 'fibra sem nenhuma linha móvel não ativa convergência (' + r.convergenciaAtiva + ')');
  previewHtml = document.getElementById('proposalPreview').innerHTML;
  assert(!previewHtml.includes('Oferta de Convergência'), 'preview NÃO mostra o badge de convergência quando não há linha móvel');
  assert(previewHtml.includes('bônus de convergência não se aplica'), 'preview avisa que o bônus não se aplica (fibra sem linha móvel)');

  // --- 3) fibra + SÓ incremento (sem renovação) -> convergência ativa (incremento conta) ---
  openProposal(clienteBase, {});
  proposalState.incluirFixa = true;
  proposalState.incluirRenovacao = false;
  proposalState.incluirIncremento = true;
  proposalState.incrementos = OFFERS_MOBILE.filter(o => (o.tipos||[]).includes('incremento')).slice(0,1).map(o=>({offerId:o.id, qtd:1}));
  updateProposalPreview();
  r = computeProposal();
  assert(r.convergenciaAtiva === true, 'fibra + incremento (sem renovação) também ativa a convergência (' + r.convergenciaAtiva + ')');

  // --- 4) sem fibra nenhuma -> nenhuma linha de convergência aparece (nem positiva nem negativa) ---
  openProposal(clienteBase, {});
  proposalState.incluirFixa = false;
  updateProposalPreview();
  r = computeProposal();
  assert(r.convergenciaAtiva === false, 'sem fibra, convergência sempre falsa');
  previewHtml = document.getElementById('proposalPreview').innerHTML;
  assert(!previewHtml.includes('Convergência'), 'sem fibra selecionada, nem aparece linha de convergência no preview (nem positiva nem negativa)');

  // --- 5) proposta avulsa de PORTABILIDADE + fibra -> convergência também ativa ---
  const clienteAvulsa = {
    razao_social: 'PROSPECT AVULSO LTDA', cnpj: '', cidade: 'Rio de Janeiro', ddd: '21',
    linhas_atuais: 3, valor_contrato: 450, arpu: 150, cep_cabeado: '',
  };
  openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'portabilidade', operadoraAtual: 'Vivo' });
  const ofertaPort = grupoOfferList(clienteAvulsa, 'portabilidade').find(o => o.aplicavel);
  proposalState.linhaGrupos = [{ tipo: 'portabilidade', qtd: 2, offerId: ofertaPort ? ofertaPort.id : null }];
  proposalState.incluirFixa = true;
  updateProposalPreview();
  r = computeProposal();
  assert(r.convergenciaAtiva === true, 'proposta avulsa de portabilidade + fibra também ativa a Oferta de Convergência (' + r.convergenciaAtiva + ')');
  previewHtml = document.getElementById('proposalPreview').innerHTML;
  assert(previewHtml.includes('Oferta de Convergência'), 'preview mostra convergência também no fluxo avulsa de portabilidade');

  // --- 6) modelo do documento: convergência ativa -> item da fibra com "(Convergência)" + notaFibra true ---
  let modelo = buildPropostaDocModel();
  const itemFibra = modelo.novaProposta.itens.find(it => it.item === 'Claro Fibra');
  assert(!!itemFibra, 'modelo: item Claro Fibra presente');
  assert(itemFibra.desc.includes('(Convergência)'), 'modelo: descrição da fibra marcada com "(Convergência)" quando ativa');
  assert(modelo.novaProposta.notaFibra === true, 'modelo: notaFibra true quando convergência ativa (explica o bônus de 30GB)');

  // --- 7) modelo: fibra sem linha móvel -> SEM marca de convergência nenhuma ---
  openProposal(clienteBase, {});
  proposalState.incluirFixa = true;
  proposalState.incluirRenovacao = false;
  proposalState.incluirIncremento = false;
  modelo = buildPropostaDocModel();
  const itemFibra2 = modelo.novaProposta.itens.find(it => it.item === 'Claro Fibra');
  assert(!!itemFibra2 && !itemFibra2.desc.includes('(Convergência)'), 'modelo: NÃO marca "(Convergência)" quando fibra está sozinha, sem linha móvel');
  assert(modelo.novaProposta.notaFibra === false, 'modelo: notaFibra false quando não há linha móvel junto');

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
