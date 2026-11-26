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
  const cli = { razao_social: 'CLIENTE 10 LINHAS LTDA', cnpj: '11.222.333/0001-44', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 10, valor_contrato: 1500, arpu: 150, cep_cabeado: '01000-000' };

  openProposal(cli, {});
  // (o Claro Monitor por linha é do §168 e tem teste próprio; aqui só Solução digital e Conectividade)
  assert(!!document.getElementById('propMonitorModo'), 'a opção de Claro Monitor por linha (§168) continua na tela');

  // --- Solução digital e Conectividade em Outras ofertas ---
  document.getElementById('propIncluirExtras').click();
  document.querySelector('.btnAddExtraCat[data-cat="Solução digital"]').click();
  document.querySelector('.btnAddExtraCat[data-cat="Conectividade"]').click();
  assert(proposalState.extras.map(e => e.categoria).join(',') === 'Solução digital,Conectividade', 'botões adicionam a categoria certa');
  const sel0 = document.querySelector('.propExtraCategoria[data-idx="0"]');
  assert(!!sel0 && sel0.value === 'Solução digital', 'linha mostra a categoria escolhida');
  document.querySelector('.propExtraDescricao[data-idx="0"]').value = 'Claro Segurança'; document.querySelector('.propExtraDescricao[data-idx="0"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('.propExtraValorUnit[data-idx="0"]').value = '30'; document.querySelector('.propExtraValorUnit[data-idx="0"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('.propExtraDescricao[data-idx="1"]').value = 'Link dedicado'; document.querySelector('.propExtraDescricao[data-idx="1"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('.propExtraValorUnit[data-idx="1"]').value = '500'; document.querySelector('.propExtraValorUnit[data-idx="1"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  const m2 = buildPropostaDocModel();
  const itens = m2.novaProposta.itens.map(it => it.item);
  assert(itens.includes('Solução digital — Claro Segurança') && itens.includes('Conectividade — Link dedicado'), 'documento: itens aparecem com a categoria (' + itens.join(' | ') + ')');
  const trocar = document.querySelector('.propExtraCategoria[data-idx="1"]'); trocar.value = 'Outro'; trocar.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(buildPropostaDocModel().novaProposta.itens.some(it => it.item === 'Link dedicado'), 'categoria Outro mostra só o nome do produto');
  // --- modo manual: novas categorias ---
  assert(MODO_MANUAL_CATEGORIAS.includes('Solução digital') && MODO_MANUAL_CATEGORIAS.includes('Conectividade'), 'modo manual tem Solução digital e Conectividade');

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
