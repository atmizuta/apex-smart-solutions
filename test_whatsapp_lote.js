// test_whatsapp_lote.js — Notificar clientes em lote (WhatsApp) (27/09/2026, pedido do usuário na
// tela "Gerar Proposta" avulsa: "nesta tela dar a opção também de enviar mensagens em lote somente
// notificando o cliente pelo whatsapp da gestão da conta dele, ou seja, inserir o número do whatsapp
// do cliente e o nome, sugerir mensagem aleatoria conforme modelos com a opcao de escolha para cada
// número, deixar no maximo 10 numeros e alertar para o risco de banimento no whatsapp" — esclarecido
// via AskUserQuestion: cada contato tem seu próprio botão "Enviar" (envio um de cada vez), sem botão
// único que abra todos, justamente pra reduzir o padrão de disparo automatizado / risco de banimento).
//
// Cobre: card + modal existem na tela de proposta avulsa; abrir o modal nasce com 1 linha e mensagem
// já preenchida (modelo aleatório, mas sempre com o nome do consultor substituído); "+ Adicionar
// número" soma linhas até o teto de 10 (botão some ao chegar no limite); trocar o modelo de uma linha
// recalcula só a mensagem daquela linha; editar nome/número não reescreve retroativamente uma
// mensagem já preenchida; "Remover" tira a linha certa; "Enviar" com número inválido mostra erro
// nessa linha sem chamar window.open; "Enviar" válido chama window.open com a URL wa.me correta pra
// aquela linha; o aviso de risco de banimento está sempre presente no modal.
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

// abre a proposta avulsa (o card "Notificar clientes" fica na tela de proposta avulsa)
const clienteAvulsa = { razao_social: '', cnpj: '', cidade: 'Sao Paulo', ddd: '11', linhas_atuais: 5, valor_contrato: 800, arpu: 160, cep_cabeado: '' };
openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'novo' });

// ===== 1) card + modal existem =====
const btnAbrir = document.getElementById('btnAbrirWhatsLote');
assert(btnAbrir !== null, 'botão "Notificar em lote" existe na tela de proposta avulsa');
const whatsLoteOverlayCheck = document.getElementById('whatsLoteOverlay');
assert(whatsLoteOverlayCheck !== null, 'modal whatsLoteOverlay existe');
assert(document.querySelector('.whatsLoteWarning') !== null, 'aviso de risco de banimento está presente no modal');
assert(document.querySelector('.whatsLoteWarning').textContent.toLowerCase().includes('bani'), 'texto do aviso menciona banimento');

// ===== 2) abrir o modal nasce com 1 linha, mensagem já preenchida com o nome do consultor =====
btnAbrir.click();
assert(whatsLoteOverlayCheck.classList.contains('active'), 'clicar em "Notificar em lote" abre o modal');
let linhas = document.querySelectorAll('.whatsLoteRow');
assert(linhas.length === 1, 'modal nasce com exatamente 1 linha (atual: ' + linhas.length + ')');
let msg0 = linhas[0].querySelector('.wLoteMensagem').value;
assert(msg0.includes('Fernanda Souza'), 'mensagem inicial da linha já traz o nome do consultor logado');
assert(msg0.trim().length > 0, 'mensagem inicial não está vazia');

// ===== 3) "+ Adicionar número" soma linhas até 10, botão some no limite =====
const btnAdd = document.getElementById('btnWhatsLoteAdd');
for(let i = 0; i < 9; i++) btnAdd.click();
linhas = document.querySelectorAll('.whatsLoteRow');
assert(linhas.length === 10, 'depois de adicionar, chega a 10 linhas (atual: ' + linhas.length + ')');
assert(btnAdd.style.display === 'none', 'botão "+ Adicionar número" some ao atingir o limite de 10');
assert(document.getElementById('whatsLoteContagem').textContent.includes('10'), 'contador mostra 10 de 10');
btnAdd.click(); // clique extra não deve quebrar nem passar de 10
linhas = document.querySelectorAll('.whatsLoteRow');
assert(linhas.length === 10, 'clicar em adicionar além do limite não cria uma 11ª linha');

// remove 9 linhas de volta pra sobrar só a primeira, simplificando os próximos testes
for(let i = 0; i < 9; i++){
  document.querySelector('.whatsLoteRow:last-child .wLoteRemover').click();
}
linhas = document.querySelectorAll('.whatsLoteRow');
assert(linhas.length === 1, 'depois de remover 9, sobra 1 linha (atual: ' + linhas.length + ')');
assert(btnAdd.style.display !== 'none', 'botão "+ Adicionar número" volta a aparecer abaixo do limite');

// ===== 4) trocar o modelo de uma linha recalcula só a mensagem daquela linha =====
btnAdd.click(); // agora 2 linhas
linhas = document.querySelectorAll('.whatsLoteRow');
assert(linhas.length === 2, 'agora há 2 linhas pros testes de template/edição isolada');
const nomeInput0 = linhas[0].querySelector('.wLoteNome');
nomeInput0.value = 'Padaria Central';
nomeInput0.dispatchEvent(new window.Event('input', { bubbles: true }));
const templateSelect0 = linhas[0].querySelector('.wLoteTemplate');
templateSelect0.value = 'casual';
templateSelect0.dispatchEvent(new window.Event('change', { bubbles: true }));
linhas = document.querySelectorAll('.whatsLoteRow'); // re-render troca os nós, precisa re-buscar
const msgCasual = linhas[0].querySelector('.wLoteMensagem').value;
assert(msgCasual.includes('Fernanda Souza'), 'mensagem recalculada do modelo "casual" ainda traz o nome do consultor');
assert(msgCasual.includes('Padaria Central'), 'mensagem recalculada do modelo "casual" traz o nome digitado nessa linha');
const msgOutraLinha = linhas[1].querySelector('.wLoteMensagem').value;
assert(!msgOutraLinha.includes('Padaria Central'), 'trocar o modelo da linha 1 não altera a mensagem da linha 2');

// ===== 5) editar nome/número depois não reescreve retroativamente a mensagem já preenchida =====
linhas = document.querySelectorAll('.whatsLoteRow');
const nomeInput0b = linhas[0].querySelector('.wLoteNome');
nomeInput0b.value = 'Outro Nome Qualquer';
nomeInput0b.dispatchEvent(new window.Event('input', { bubbles: true }));
linhas = document.querySelectorAll('.whatsLoteRow');
const msgAposEditarNome = linhas[0].querySelector('.wLoteMensagem').value;
assert(msgAposEditarNome === msgCasual, 'editar o nome depois não reescreve a mensagem já preenchida (fica igual)');
assert(msgAposEditarNome.includes('Padaria Central'), 'mensagem continua com o nome anterior (só o campo nome mudou, não a mensagem)');

// ===== 6) "Remover" tira a linha certa =====
linhas = document.querySelectorAll('.whatsLoteRow');
assert(linhas.length === 2, 'ainda com 2 linhas antes de testar a remoção específica');
linhas[0].querySelector('.wLoteRemover').click();
linhas = document.querySelectorAll('.whatsLoteRow');
assert(linhas.length === 1, 'restou 1 linha depois de remover a primeira');
assert(!linhas[0].querySelector('.wLoteMensagem').value.includes('Padaria Central'), 'a linha removida era a que tinha "Padaria Central" (sobrou a outra)');

// ===== 7) "Enviar" com número inválido: mostra erro na linha, não chama window.open =====
linhas = document.querySelectorAll('.whatsLoteRow');
const numeroInput = linhas[0].querySelector('.wLoteNumero');
numeroInput.value = '119';
numeroInput.dispatchEvent(new window.Event('input', { bubbles: true }));
linhas[0].querySelector('.wLoteEnviar').click();
linhas = document.querySelectorAll('.whatsLoteRow');
const erroEl = linhas[0].querySelector('.wLoteErr');
assert(erroEl.style.display === 'block', 'número inválido mostra erro na própria linha');
assert(window.__openedUrls.length === 0, 'nenhuma URL foi aberta com número inválido');

// ===== 8) "Enviar" com número válido: chama window.open com a URL wa.me correta =====
linhas = document.querySelectorAll('.whatsLoteRow');
const numeroInput2 = linhas[0].querySelector('.wLoteNumero');
numeroInput2.value = '11987654321';
numeroInput2.dispatchEvent(new window.Event('input', { bubbles: true }));
const mensagemInput = linhas[0].querySelector('.wLoteMensagem');
mensagemInput.value = 'Mensagem final de teste!';
mensagemInput.dispatchEvent(new window.Event('input', { bubbles: true }));
linhas[0].querySelector('.wLoteEnviar').click();
assert(window.__openedUrls.length === 1, 'window.open foi chamado uma vez com número válido');
assert(window.__openedUrls[0].startsWith('https://wa.me/5511987654321?text='), 'URL gerada usa 55+DDD+numero e o formato wa.me esperado');
assert(window.__openedUrls[0].includes(encodeURIComponent('Mensagem final de teste!')), 'URL gerada inclui a mensagem editada (url-encoded)');
linhas = document.querySelectorAll('.whatsLoteRow');
assert(linhas[0].querySelector('.wLoteErr').style.display === 'none', 'depois de um envio válido, o erro dessa linha some');

// ===== 9) fechar o modal =====
document.getElementById('whatsLoteClose').click();
assert(!whatsLoteOverlayCheck.classList.contains('active'), 'clicar no X fecha o modal');

console.log('OK:', ok, 'FAIL:', fail);
if(fail > 0) process.exit(1);
`;

window.__openedUrls = openedUrls;
dom.window.eval(jsCode + testScript);
