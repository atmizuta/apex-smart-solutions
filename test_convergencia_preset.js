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

const jsPdfStubDef = `
window.__testPdfCalls = [];
window.jspdf = { jsPDF: function(){ return {
  setFillColor(){}, setDrawColor(){}, setTextColor(){}, setFontSize(){}, setLineWidth(){}, setFont(){},
  rect(){}, roundedRect(){}, line(){}, text(){}, addImage(){}, addPage(){}, setPage(){},
  getTextWidth(t){ return String(t).length * 1.8; }, save(){},
  internal: { getNumberOfPages: () => 1 },
}; } };
`;

const testScript = `
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // --- 1) só 3 combos vendáveis (o de DDD fora da área RSC/RSI foi removido) ---
  assert(CONVERGENCIA_OFERTAS.length === 3, 'CONVERGENCIA_OFERTAS tem exatamente 3 combos (' + CONVERGENCIA_OFERTAS.length + ')');
  assert(!CONVERGENCIA_OFERTAS.find(o => o.mobileOfferId === 'p57-30reg'), 'combo do grupo RMG/RPS/RBS/RNE (30GB) não existe — não vendável pela Apex');

  const clienteDentro = { razao_social: 'CLIENTE DDD16 LTDA', cnpj: '11.222.333/0001-44', cidade: 'Sao Jose dos Campos', ddd: '16', linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000' };
  const clienteFora = { razao_social: 'CLIENTE DDD21 LTDA', cnpj: '22.333.444/0001-55', cidade: 'Rio de Janeiro', ddd: '21', linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000' };

  // --- 2) combo regional (fibra 1GIGA + pós 15GB) só aplicável dentro de DDD 12-19 ---
  let listaDentro = convergenciaOfferList(clienteDentro);
  let listaFora = convergenciaOfferList(clienteFora);
  const comboRegionalDentro = listaDentro.find(o => o.id === 'conv-1giga-15gb');
  const comboRegionalFora = listaFora.find(o => o.id === 'conv-1giga-15gb');
  assert(comboRegionalDentro.aplicavel === true, 'combo regional aplicável pra DDD 16 (dentro de RSC/RSI)');
  assert(comboRegionalFora.aplicavel === false, 'combo regional NÃO aplicável pra DDD 21 (fora de RSC/RSI)');

  // --- 3) combos nacionais (800MEGA + 12GB / 800MEGA + 40GB) sempre aplicáveis, DDD não importa ---
  assert(listaFora.find(o => o.id === 'conv-800mega-12gb').aplicavel === true, 'combo nacional 800MEGA+12GB aplicável fora da área (não é regional)');
  assert(listaFora.find(o => o.id === 'conv-800mega-40gb').aplicavel === true, 'combo nacional 800MEGA+40GB aplicável fora da área (não é regional)');

  // --- 4) aplicar combo em cliente-da-base com renovação ativa ---
  openProposal(clienteDentro, {});
  proposalState.usarConvergenciaPreset = true;
  renderProposalBody();
  proposalState.convergenciaPresetId = 'conv-800mega-40gb';
  document.getElementById('btnAplicarConvergencia').click();
  assert(proposalState.incluirFixa === true, 'aplicar combo liga a fibra');
  assert(proposalState.fibraMega === '800MEGA', 'aplicar combo ajusta a velocidade da fibra pro valor do combo (' + proposalState.fibraMega + ')');
  assert(proposalState.renewGrupos[0].offerId === 'p57-40', 'aplicar combo ajusta a oferta de renovação pro plano móvel do combo (' + proposalState.renewGrupos[0].offerId + ')');
  let r = computeProposal();
  const p57_40 = OFFERS_MOBILE.find(o => o.id === 'p57-40');
  const esperadoRenovacao = p57_40.valor * clienteDentro.linhas_voz;
  assert(Math.abs(r.baseGrupos[0].offer.valor * clienteDentro.linhas_voz - esperadoRenovacao) < 0.001, 'valor final continua calculado pela quantidade real de linhas do cliente, não trava no preço fixo do book');
  assert(r.convergenciaAtiva === true, 'combo aplicado ativa o badge geral de Oferta de Convergência');

  // --- 5) aplicar combo quando renovação está desligada -> vira incremento ---
  openProposal(clienteDentro, {});
  proposalState.incluirRenovacao = false;
  proposalState.usarConvergenciaPreset = true;
  renderProposalBody();
  proposalState.convergenciaPresetId = 'conv-800mega-12gb';
  document.getElementById('btnAplicarConvergencia').click();
  assert(proposalState.incluirIncremento === true, 'sem renovação, aplicar combo liga o incremento');
  assert(proposalState.incrementos.some(g => g.offerId === 'p57-12'), 'sem renovação, aplicar combo seta o incremento pro plano móvel do combo');
  assert(proposalState.fibraMega === '800MEGA', 'fibra ajustada mesmo no caminho de incremento');

  // --- 6) proposta avulsa: aplicar combo ajusta a oferta do primeiro grupo de linhas ---
  const clienteAvulsa = { razao_social: 'PROSPECT AVULSO LTDA', cnpj: '', cidade: 'Rio de Janeiro', ddd: '16', linhas_atuais: 2, valor_contrato: 300, arpu: 150, cep_cabeado: '' };
  openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'portabilidade', operadoraAtual: 'Vivo' });
  proposalState.usarConvergenciaPreset = true;
  renderProposalBody();
  proposalState.convergenciaPresetId = 'conv-800mega-40gb';
  document.getElementById('btnAplicarConvergencia').click();
  assert(proposalState.linhaGrupos[0].offerId === 'p57-40', 'avulsa: aplicar combo ajusta a oferta do primeiro grupo de linhas (' + proposalState.linhaGrupos[0].offerId + ')');
  assert(proposalState.incluirFixa === true, 'avulsa: aplicar combo também liga a fibra');

  // --- 7) toggle desligado não mostra o select nem o botão ---
  openProposal(clienteDentro, {});
  assert(document.getElementById('propConvergenciaOferta') === null, 'select de combo escondido quando o toggle está desligado (padrão)');
  assert(document.getElementById('btnAplicarConvergencia') === null, 'botão aplicar escondido quando o toggle está desligado (padrão)');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
`;

window.eval(jsPdfStubDef + jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 2000);
