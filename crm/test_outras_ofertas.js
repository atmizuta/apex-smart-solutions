// test_outras_ofertas.js (23/09/2026, troca PDF->DOCX + Claro Monitor como beneficio): generateProposalPDF()
// foi removida. Alem disso, Claro Monitor deixou de ser um item itemizado da Nova Proposta — seu valor
// agora entra direto no total (novaProposta.valorMonitor) e ele passa a aparecer como badge de beneficio
// (junto com Ligacoes/WhatsApp/Waze), a pedido do usuario ("incluir no valor total da linha o claro
// monitor e mencionar ao lado de beneficios"). Itens manuais (nao-monitor) continuam itemizados como
// sempre. O bloco 8 (antes lia texto do PDF) foi reescrito pra conferir isso no modelo puro.
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

  const cliente10linhas = { razao_social: 'CLIENTE 10 LINHAS LTDA', cnpj: '11.222.333/0001-44', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 10, valor_contrato: 1500, arpu: 150, cep_cabeado: '01000-000' };

  // --- 1) por padrão, a seção "Outras ofertas" nasce desligada e fechada ---
  openProposal(cliente10linhas, {});
  assert(proposalState.incluirExtras === false, 'Outras ofertas nasce desligada por padrão');
  assert(Array.isArray(proposalState.extras) && proposalState.extras.length === 0, 'extras nasce vazio');
  assert(document.getElementById('btnAddClaroMonitor') === null, 'botões de outras ofertas escondidos quando o toggle está desligado');

  // --- 2) ligar o toggle abre a seção e mostra os botões de adicionar ---
  document.getElementById('propIncluirExtras').click();
  assert(proposalState.incluirExtras === true, 'ligar o interruptor liga Outras ofertas');
  assert(document.getElementById('btnAddClaroMonitor') !== null, 'botão + Adicionar Claro Monitor aparece');
  assert(document.getElementById('btnAddExtraManual') !== null, 'botão + Adicionar oferta manual aparece');

  // --- 3) adicionar Claro Monitor: nasce com valor fixo R$5,00/licença e qtd = linhas_voz do cliente ---
  document.getElementById('btnAddClaroMonitor').click();
  assert(proposalState.extras.length === 1, 'Claro Monitor foi adicionado');
  assert(proposalState.extras[0].tipo === 'monitor', 'item adicionado é do tipo monitor');
  assert(proposalState.extras[0].valorUnit === 5, 'Claro Monitor tem valor fixo de R$5,00/licença (' + proposalState.extras[0].valorUnit + ')');
  assert(proposalState.extras[0].qtd === 10, 'Claro Monitor sugere qtd = linhas_voz do cliente (' + proposalState.extras[0].qtd + ')');
  const qtdMonitorInput = document.querySelector('.propExtraQtd[data-idx="0"]');
  assert(qtdMonitorInput !== null && qtdMonitorInput.value === '10', 'input de quantidade do Claro Monitor aparece com o valor certo');

  // --- 4) adicionar oferta manual: nasce vazia (descrição em branco, valor 0, qtd 1) ---
  document.getElementById('btnAddExtraManual').click();
  assert(proposalState.extras.length === 2, 'oferta manual foi adicionada');
  assert(proposalState.extras[1].tipo === 'manual', 'segundo item é do tipo manual');
  assert(proposalState.extras[1].descricao === '' && proposalState.extras[1].valorUnit === 0 && proposalState.extras[1].qtd === 1, 'oferta manual nasce em branco (descrição/valor) com qtd 1');
  assert(document.querySelector('.propExtraDescricao[data-idx="1"]') !== null, 'campo de descrição aparece pra oferta manual');
  assert(document.querySelector('.propExtraValorUnit[data-idx="1"]') !== null, 'campo de valor unitário aparece pra oferta manual');

  // --- 5) preencher a oferta manual (produto + valor unitário) dispara a atualização do estado ---
  const descInput = document.querySelector('.propExtraDescricao[data-idx="1"]');
  descInput.value = 'Instalação de rack dedicado';
  descInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(proposalState.extras[1].descricao === 'Instalação de rack dedicado', 'editar a descrição atualiza proposalState');

  const valorInput = document.querySelector('.propExtraValorUnit[data-idx="1"]');
  valorInput.value = '350';
  valorInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(proposalState.extras[1].valorUnit === 350, 'editar o valor unitário atualiza proposalState (' + proposalState.extras[1].valorUnit + ')');

  const qtdManualInput = document.querySelector('.propExtraQtd[data-idx="1"]');
  qtdManualInput.value = '2';
  qtdManualInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(proposalState.extras[1].qtd === 2, 'editar a quantidade da oferta manual atualiza proposalState');

  // --- 6) computeProposal soma Claro Monitor + oferta manual em extrasValor, e no novoTotal ---
  let r = computeProposal();
  const esperadoExtras = (5 * 10) + (350 * 2);
  assert(Math.abs(r.extrasValor - esperadoExtras) < 0.001, 'extrasValor soma valor unitário × quantidade de cada item (' + r.extrasValor + ' esperado ' + esperadoExtras + ')');

  // --- 7) resumo (updateProposalPreview) mostra os itens e o total de outras ofertas ---
  updateProposalPreview();
  const previewHtml = document.getElementById('proposalPreview').innerHTML;
  assert(previewHtml.includes('Claro Monitor: 10 ×'), 'preview mostra o item do Claro Monitor');
  assert(previewHtml.includes('Instalação de rack dedicado: 2 ×'), 'preview mostra o item manual pela descrição digitada');
  assert(previewHtml.includes('Total de outras ofertas'), 'preview mostra o total de outras ofertas');

  // --- 8) modelo do documento: Claro Monitor SAI da lista de itens (vira valorMonitor + badge de
  // benefício); item manual continua itemizado normalmente ---
  const modelo = buildPropostaDocModel();
  assert(!modelo.novaProposta.itens.some(it => it.item === 'Claro Monitor'), 'modelo: Claro Monitor NÃO aparece como item da Nova Proposta');
  assert(Math.abs(modelo.novaProposta.valorMonitor - 50) < 0.001, 'modelo: valorMonitor = 5,00 × 10 licenças = 50,00 (' + modelo.novaProposta.valorMonitor + ')');
  const itemManual = modelo.novaProposta.itens.find(it => it.item === 'Instalação de rack dedicado');
  assert(!!itemManual, 'modelo: item manual continua itemizado na Nova Proposta');
  assert(Math.abs(itemManual.subtotal - 700) < 0.001, 'modelo: subtotal do item manual = 350 × 2 = 700 (' + itemManual.subtotal + ')');
  const badgeMonitor = modelo.beneficios.badges.find(b => b.label === 'Claro Monitor');
  assert(!!badgeMonitor, 'modelo: badge de benefício "Claro Monitor" aparece quando valorMonitor > 0');
  // total continua consistente: soma dos itens visiveis + valorMonitor = total da nova proposta
  const somaItens = modelo.novaProposta.itens.reduce((s, it) => s + (it.subtotal || 0), 0);
  assert(Math.abs(somaItens + modelo.novaProposta.valorMonitor - modelo.novaProposta.total) < 0.001, 'modelo: total = soma dos itens visiveis + valorMonitor');

  // --- 9) remover um item funciona e some da tela ---
  document.querySelector('.btnRemoveExtra[data-idx="1"]').click();
  assert(proposalState.extras.length === 1, 'remover a oferta manual funciona');
  assert(document.querySelectorAll('.propExtraQtd').length === 1, 'input do item removido some da tela');

  // --- 10) desligar Outras ofertas NÃO reseta a lista (preserva o que o consultor já configurou, igual ao incremento) ---
  document.getElementById('propIncluirExtras').click();
  assert(proposalState.incluirExtras === false, 'desligar o interruptor desliga Outras ofertas');
  assert(proposalState.extras.length === 1, 'desligar Outras ofertas preserva os itens já configurados');
  r = computeProposal();
  assert(r.extrasValor === 0, 'com o toggle desligado, extrasValor não entra no total, mesmo com itens configurados');
  // com o toggle desligado, o modelo também não deve trazer valorMonitor nem a badge (sem extras incluídos)
  const modeloDesligado = buildPropostaDocModel();
  assert(modeloDesligado.novaProposta.valorMonitor === 0, 'modelo: com toggle desligado, valorMonitor zerado');
  assert(!modeloDesligado.beneficios.badges.some(b => b.label === 'Claro Monitor'), 'modelo: com toggle desligado, badge do Claro Monitor não aparece');

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
