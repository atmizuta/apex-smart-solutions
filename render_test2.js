const fs = require('fs');
const { JSDOM } = require('jsdom');
const { jsPDF } = require('jspdf');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {} },
  from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (m) => console.log('ALERT', m);
window.confirm = () => true;
window.jspdf = { jsPDF };

const testScript = `
currentUser = { id:'u1', nome:'Consultor Teste', username:'consultor', role:'consultor' };
const cliente = { razao_social:'PROSPECT TESTE LTDA', cnpj:'', cidade:'Rio de Janeiro', ddd:'21', linhas_atuais:3, valor_contrato:450, arpu:150, cep_cabeado:'' };
openProposal(cliente, { avulsa:true, tipoAvulsa:'concorrencia', operadoraAtual:'Vivo' });
const o150 = OFFERS_MOBILE.find(o=>o.id==='p57-150');
const o60_25 = OFFERS_MOBILE.find(o=>o.id==='p60-25');
proposalState.linhaGrupos = [{ tipo:'portabilidade', qtd:3, offerId:o150.id }];
proposalState.incrementos = [o60_25.id];
generateProposalPDF();
`;
window.eval(jsCode + testScript);
