// test_whatsapp_apresentacao.js — mensagem de apresentação via WhatsApp (27/09/2026, pedido do
// usuário: "em gerar proposta ... deixar a opção do consultor enviar uma mensagem para o cliente
// pelo whatsapp se apresentando ... crie diversas mensagens personalizadas de apresentação que sejam
// editáveis e crie um link onde o consultor clique em um botão chamado 'Gerar Mensagem' e
// automaticamente uma mensagem padrão se apresentando como o novo gestor da carteira abrirá
// automaticamente no whatsapp web ... poderá ser utilizado um número da nossa base de clientes ou
// será digitado manualmente" — esclarecido via 3 perguntas ao usuário: botão dentro da tela de
// proposta; dropdown de modelos; auto-preencher número quando existir).
//
// Cobre: seção aparece na tela de proposta (avulsa e cliente-da-base); dropdown de modelos preenche
// a mensagem com os placeholders substituídos; auto-preenchimento do número pra cliente da base (1 e
// 2+ números cadastrados) vs avulsa (campo nasce com o DDD); opção "Digitar outro número" limpa o
// campo; normalização whatsappNumeroParaLink (com/sem 55, número curto rejeitado); clique em "Gerar
// Mensagem" chama window.open com a URL wa.me correta; número inválido mostra erro em vez de abrir.
const fs = require('fs');
const { JSDOM } = require('jsdom');

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
window.alert = () => {};
window.confirm = () => true;
window.jspdf = { jsPDF: function(){ return {}; } };

let openedUrls = [];
window.open = (url) => { openedUrls.push(url); return {}; };

const testScript = `
let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

currentUser = { id: 'u1', nome: 'Fernanda Souza', username: 'fernanda', role: 'consultor' };

// ===== 1) Cliente da base com 1 número cadastrado: auto-preenche, sem seletor de número =====
const clienteUmNumero = { razao_social: 'CLIENTE UM NUMERO LTDA', cnpj: '11.111.111/0001-11', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 8, valor_contrato: 1200, arpu: 150, cep_cabeado: '', tempo_contrato_voz: 20, telefone_contato: '11987654321' };
openProposal(clienteUmNumero, {});
assert(document.getElementById('btnGerarMensagemWhats') !== null, 'botão "Gerar Mensagem" aparece na tela de proposta (cliente da base)');
assert(document.getElementById('propWhatsNumeroSelect') === null, 'sem seletor de número quando só existe 1 número cadastrado');
assert(document.getElementById('propWhatsNumero').value === '11987654321', 'número auto-preenchido a partir de telefone_contato');
assert(document.getElementById('propWhatsMensagem').value.includes('Fernanda Souza'), 'mensagem inicial já traz o nome do consultor logado');
assert(document.getElementById('propWhatsMensagem').value.includes('CLIENTE UM NUMERO LTDA'), 'mensagem inicial já traz a razão social do cliente');
document.getElementById('proposalClose').click();

// ===== 2) Cliente da base com 2+ números cadastrados: mostra seletor =====
const clienteDoisNumeros = { razao_social: 'CLIENTE DOIS NUMEROS LTDA', cnpj: '22.222.222/0001-22', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 8, valor_contrato: 1200, arpu: 150, cep_cabeado: '', tempo_contrato_voz: 20, telefone_contato: '11987654321', tel1: '11911112222' };
openProposal(clienteDoisNumeros, {});
const numeroSelect = document.getElementById('propWhatsNumeroSelect');
assert(numeroSelect !== null, 'seletor de número aparece quando há 2+ números cadastrados');
assert(document.getElementById('propWhatsNumero').value === '11987654321', 'campo de número começa com o primeiro número da lista');
numeroSelect.value = '11911112222';
numeroSelect.dispatchEvent(new window.Event('change'));
assert(document.getElementById('propWhatsNumero').value === '11911112222', 'trocar o seletor atualiza o campo de número');
// "Digitar outro número" -> limpa o campo
numeroSelect.value = '';
numeroSelect.dispatchEvent(new window.Event('change'));
assert(document.getElementById('propWhatsNumero').value === '', 'opção "Digitar outro número" limpa o campo');
document.getElementById('proposalClose').click();

// ===== 3) Cliente avulsa (sem telefone cadastrado): campo nasce com o DDD, sem seletor =====
const clienteAvulsa = { razao_social: 'CLIENTE MANUAL TESTE LTDA', cnpj: '', cidade: 'Sao Paulo', ddd: '11', linhas_atuais: 5, valor_contrato: 800, arpu: 160, cep_cabeado: '' };
openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'novo' });
assert(document.getElementById('propWhatsNumeroSelect') === null, 'avulsa sem telefone cadastrado não mostra seletor');
assert(document.getElementById('propWhatsNumero').value === '11', 'campo de número da avulsa nasce só com o DDD');

// troca de modelo -> preenche a mensagem com o texto do modelo escolhido
const templateSelect = document.getElementById('propWhatsTemplate');
assert(templateSelect !== null, 'dropdown de modelos existe');
assert(templateSelect.options.length >= 3, 'existem pelo menos 3 modelos de mensagem no dropdown');
templateSelect.value = 'casual';
templateSelect.dispatchEvent(new window.Event('change'));
assert(document.getElementById('propWhatsMensagem').value.includes('Fernanda Souza'), 'mensagem do modelo "casual" também substitui o nome do consultor');
assert(document.getElementById('propWhatsMensagem').value.includes('CLIENTE MANUAL TESTE LTDA'), 'mensagem do modelo "casual" também substitui a razão social do cliente');

// ===== 4) Gerar Mensagem com número inválido (curto demais) -> mostra erro, não abre nada =====
document.getElementById('propWhatsNumero').value = '119';
document.getElementById('btnGerarMensagemWhats').click();
assert(document.getElementById('propWhatsErr').style.display === 'block', 'número inválido/curto mostra erro');
assert(window.__openedUrls.length === 0, 'nenhuma URL foi aberta com número inválido');

// ===== 5) Gerar Mensagem com número válido -> abre wa.me com número + mensagem corretos =====
document.getElementById('propWhatsNumero').value = '11987654321';
document.getElementById('propWhatsMensagem').value = 'Ola, mensagem de teste!';
document.getElementById('btnGerarMensagemWhats').click();
assert(document.getElementById('propWhatsErr').style.display === 'none', 'número válido não mostra erro');
assert(window.__openedUrls.length === 1, 'window.open foi chamado uma vez com número válido');
assert(window.__openedUrls[0].startsWith('https://wa.me/5511987654321?text='), 'URL gerada usa 55+DDD+numero e o formato wa.me esperado');
assert(window.__openedUrls[0].includes(encodeURIComponent('Ola, mensagem de teste!')), 'URL gerada inclui a mensagem (url-encoded)');
document.getElementById('proposalClose').click();

// ===== 6) whatsappNumeroParaLink: normalização direta =====
assert(whatsappNumeroParaLink('11987654321') === '5511987654321', 'sem 55 -> adiciona 55 na frente');
assert(whatsappNumeroParaLink('5511987654321') === '5511987654321', 'já com 55 -> mantém');
assert(whatsappNumeroParaLink('(11) 98765-4321') === '5511987654321', 'aceita número formatado (parênteses/traço/espaço)');
assert(whatsappNumeroParaLink('119') === null, 'número curto demais retorna null');
assert(whatsappNumeroParaLink('') === null, 'número vazio retorna null');

console.log('OK:', ok, 'FAIL:', fail);
if(fail > 0) process.exit(1);
`;

window.__openedUrls = openedUrls;
dom.window.eval(jsCode + testScript);
