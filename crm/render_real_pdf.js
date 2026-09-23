const fs = require('fs');
const { JSDOM } = require('jsdom');
const { jsPDF } = require('jspdf');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (m) => console.log('ALERT', m);
window.confirm = () => true;
window.jspdf = { jsPDF };

const testScript = `
currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
const clienteBase = {
  razao_social: 'CLIENTE BASE TESTE LTDA', cnpj: '11.222.333/0001-44', cidade: 'São Paulo', ddd: '11',
  linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000',
};
openProposal(clienteBase, {});
proposalState.incrementos = OFFERS_MOBILE.filter(o => (o.tipos||[]).includes('incremento')).slice(0,2).map(o=>o.id);
proposalState.incluirFixa = true;
generateProposalPDF();
`;
window.eval(jsCode + testScript);
