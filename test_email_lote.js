// test_email_lote.js — Notificar clientes por e-mail (em lote) (28/09/2026, pedido do usuário:
// "crie uma opcao agora por email e deixe a opcao de cada usuário conectar o seu email do
// hostinger com a plataforma e façoa o envio automatico. utilize o modelo anexo mas com o padrão
// da Claro e da APEX" — esclarecido via 2 perguntas: um único botão "Enviar para todos" dispara
// pra todos os destinatários de uma vez (diferente do WhatsApp em lote, que é um botão por linha,
// porque e-mail não carrega o mesmo risco de banimento por disparo em sequência); a tela de conectar
// o e-mail (Hostinger) fica numa aba própria "Configurações" no menu lateral, não no perfil do usuário).
//
// Cobre: aba "Configurações" existe no menu e abre o painel certo; carregar a aba sem e-mail
// conectado mostra status "não conectado"; salvar sem senha na primeira vez dá erro; salvar com
// e-mail+senha válidos faz upsert em user_email_config e depois mostra status "Conectado"; abrir o
// modal de e-mail em lote sem conta conectada mostra aviso e desabilita "Enviar para todos"; com
// conta conectada, o modal nasce com 1 linha e assunto/corpo padrão (com nome do consultor no
// corpo); "+ Adicionar destinatário" soma linhas até o teto de 10; remover linha tira a linha
// certa; "Enviar para todos" valida e-mail obrigatório e formato, e só então chama
// sb.functions.invoke('send-email-lote', ...) com o payload esperado (destinatários, assunto,
// corpoHtml, nomeConsultor); resultado por destinatário é exibido após a resposta da function.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// estado simulado da tabela user_email_config: começa sem nenhuma linha (usuário não conectou)
let emailConfigRow = null;
let upsertChamadas = [];
let updateChamadas = [];
let functionsInvokeChamadas = [];
let functionsInvokeResposta = { data: { resultados: [] }, error: null };

window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {} },
  from: (table) => {
    if(table === 'user_email_config'){
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: emailConfigRow, error: null }),
          }),
        }),
        upsert: (payload) => { upsertChamadas.push(payload); emailConfigRow = { ...(emailConfigRow||{}), ...payload }; return Promise.resolve({ error: null }); },
        update: (payload) => ({
          eq: () => { updateChamadas.push(payload); if(emailConfigRow) emailConfigRow = { ...emailConfigRow, ...payload }; return Promise.resolve({ error: null }); },
        }),
      };
    }
    return { select: () => ({ order: () => ({ then: () => {} }) }) };
  },
  functions: { invoke: async (nome, opts) => { functionsInvokeChamadas.push({ nome, opts }); return functionsInvokeResposta; } },
}) };
window.alert = () => {};
window.confirm = () => true;
window.jspdf = { jsPDF: function(){ return {}; } };
window.open = () => ({});

const testScript = `
(async function(){
let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

currentUser = { id: 'u1', nome: 'Fernanda Souza', username: 'fernanda', role: 'consultor' };

// ===== 1) aba "Configurações" existe e o painel correspondente existe =====
const tabBtnConfig = document.getElementById('tabBtnConfig');
assert(tabBtnConfig !== null, 'botão de aba "Configurações" existe no menu lateral');
const panelConfig = document.getElementById('panel-config');
assert(panelConfig !== null, 'painel panel-config existe');
assert(document.getElementById('cfgEmailEndereco') !== null, 'campo de e-mail existe em Configurações');
assert(document.getElementById('cfgEmailSenha') !== null, 'campo de senha existe em Configurações');
assert(document.getElementById('btnSalvarEmailConfig') !== null, 'botão salvar existe em Configurações');

// ===== 2) carregar status sem e-mail conectado =====
await carregarEmailConfigStatus();
assert(emailConfigAtual === null, 'sem linha em user_email_config, emailConfigAtual fica null');
const statusEl = document.getElementById('cfgEmailStatus');
assert(statusEl.textContent.toLowerCase().includes('não conectou') || statusEl.textContent.toLowerCase().includes('nao conectou'), 'status mostra que o usuário ainda não conectou e-mail');

// ===== 3) salvar sem senha na primeira vez dá erro (não chama upsert nem update) =====
document.getElementById('cfgEmailEndereco').value = 'fernanda@apexsmart.com.br';
document.getElementById('cfgEmailSenha').value = '';
document.getElementById('btnSalvarEmailConfig').click();
await new Promise(r => setTimeout(r, 0));
const errEl = document.getElementById('cfgEmailErr');
assert(errEl.style.display === 'block', 'salvar sem senha na primeira conexão mostra erro');
assert(__upsertChamadas.length === 0, 'nenhum upsert foi feito sem a senha obrigatória');

// ===== 4) salvar com e-mail+senha válidos faz upsert e depois mostra "Conectado" =====
document.getElementById('cfgEmailSenha').value = 'SenhaForte123!';
document.getElementById('cfgEmailNomeExibicao').value = 'Fernanda Souza';
document.getElementById('cfgEmailTelefone').value = '(11) 98888-7777';
document.getElementById('btnSalvarEmailConfig').click();
await new Promise(r => setTimeout(r, 0));
assert(__upsertChamadas.length === 1, 'salvar com senha faz upsert em user_email_config (atual: ' + __upsertChamadas.length + ')');
assert(__upsertChamadas[0].email === 'fernanda@apexsmart.com.br', 'upsert envia o e-mail digitado');
assert(__upsertChamadas[0].smtp_pass === 'SenhaForte123!', 'upsert envia a senha digitada');
assert(__upsertChamadas[0].user_id === 'u1', 'upsert vincula ao user_id do usuário logado');
await new Promise(r => setTimeout(r, 0));
assert(emailConfigAtual !== null, 'depois de salvar, emailConfigAtual deixa de ser null');
assert(document.getElementById('cfgEmailStatus').textContent.includes('Conectado'), 'status passa a mostrar "Conectado" depois de salvar');
assert(document.getElementById('cfgEmailSenha').value === '', 'campo de senha é limpo depois de salvar com sucesso');

// ===== 5) abrir o modal de e-mail em lote com conta conectada =====
const btnAbrirEmailLote = document.getElementById('btnAbrirEmailLote');
assert(btnAbrirEmailLote !== null, 'botão "Notificar clientes por e-mail (em lote)" existe na tela de proposta');
const emailLoteOverlayCheck = document.getElementById('emailLoteOverlay');
assert(emailLoteOverlayCheck !== null, 'modal emailLoteOverlay existe');
btnAbrirEmailLote.click();
await new Promise(r => setTimeout(r, 0));
assert(emailLoteOverlayCheck.classList.contains('active'), 'clicar no botão abre o modal de e-mail em lote');
assert(document.getElementById('emailLoteSemConta').style.display === 'none', 'com conta conectada, o aviso de "sem conta" fica escondido');
assert(document.getElementById('btnEmailLoteEnviarTodos').disabled === false, 'com conta conectada, "Enviar para todos" fica habilitado');
let linhas = document.querySelectorAll('#emailLoteRowsWrap .whatsLoteRow');
assert(linhas.length === 1, 'modal nasce com exatamente 1 linha (atual: ' + linhas.length + ')');
const assuntoInicial = document.getElementById('emailLoteAssunto').value;
const corpoInicial = document.getElementById('emailLoteCorpo').value;
assert(assuntoInicial.trim().length > 0, 'assunto padrão não vem vazio');
assert(corpoInicial.includes('Fernanda Souza'), 'corpo padrão já traz o nome do consultor logado');

// ===== 6) "+ Adicionar destinatário" soma linhas até 10 =====
const btnAdd = document.getElementById('btnEmailLoteAdd');
for(let i = 0; i < 9; i++) btnAdd.click();
linhas = document.querySelectorAll('#emailLoteRowsWrap .whatsLoteRow');
assert(linhas.length === 10, 'depois de adicionar, chega a 10 linhas (atual: ' + linhas.length + ')');
assert(btnAdd.style.display === 'none', 'botão "+ Adicionar destinatário" some ao atingir o limite de 10');
btnAdd.click();
linhas = document.querySelectorAll('#emailLoteRowsWrap .whatsLoteRow');
assert(linhas.length === 10, 'clicar além do limite não cria uma 11ª linha');

// remove 9 de volta
for(let i = 0; i < 9; i++){
  document.querySelectorAll('#emailLoteRowsWrap .whatsLoteRow')[document.querySelectorAll('#emailLoteRowsWrap .whatsLoteRow').length - 1].querySelector('.eLoteRemover').click();
}
linhas = document.querySelectorAll('#emailLoteRowsWrap .whatsLoteRow');
assert(linhas.length === 1, 'depois de remover 9, sobra 1 linha (atual: ' + linhas.length + ')');

// ===== 7) "Enviar para todos" valida e-mail obrigatório =====
document.getElementById('btnEmailLoteEnviarTodos').click();
await new Promise(r => setTimeout(r, 0));
let errLote = document.getElementById('emailLoteErr');
assert(errLote.style.display === 'block', 'sem nenhum destinatário com e-mail preenchido, mostra erro');
assert(__invokeChamadas.length === 0, 'nenhuma chamada à function foi feita sem destinatários válidos');

// preenche nome mas com e-mail inválido
linhas = document.querySelectorAll('#emailLoteRowsWrap .whatsLoteRow');
const nomeInput0 = linhas[0].querySelector('.eLoteNome');
const emailInput0 = linhas[0].querySelector('.eLoteEmail');
nomeInput0.value = 'João da Padaria';
nomeInput0.dispatchEvent(new window.Event('input', { bubbles: true }));
emailInput0.value = 'nao-e-email';
emailInput0.dispatchEvent(new window.Event('input', { bubbles: true }));
document.getElementById('btnEmailLoteEnviarTodos').click();
await new Promise(r => setTimeout(r, 0));
errLote = document.getElementById('emailLoteErr');
assert(errLote.style.display === 'block', 'e-mail com formato inválido mostra erro');
assert(__invokeChamadas.length === 0, 'nenhuma chamada à function foi feita com e-mail inválido');

// ===== 8) "Enviar para todos" com dados válidos chama a Edge Function e mostra o resultado =====
linhas = document.querySelectorAll('#emailLoteRowsWrap .whatsLoteRow');
linhas[0].querySelector('.eLoteEmail').value = 'joao@padariacentral.com.br';
linhas[0].querySelector('.eLoteEmail').dispatchEvent(new window.Event('input', { bubbles: true }));
__invokeResposta.data = { resultados: [ { email: 'joao@padariacentral.com.br', ok: true } ] };
document.getElementById('btnEmailLoteEnviarTodos').click();
await new Promise(r => setTimeout(r, 0));
await new Promise(r => setTimeout(r, 0));
assert(__invokeChamadas.length === 1, 'chamou sb.functions.invoke uma vez com dados válidos (atual: ' + __invokeChamadas.length + ')');
assert(__invokeChamadas[0].nome === 'send-email-lote', 'chamou a Edge Function send-email-lote');
const bodyEnviado = __invokeChamadas[0].opts.body;
assert(Array.isArray(bodyEnviado.destinatarios) && bodyEnviado.destinatarios.length === 1, 'payload leva a lista de destinatários');
assert(bodyEnviado.destinatarios[0].email === 'joao@padariacentral.com.br', 'destinatário enviado tem o e-mail certo');
assert(typeof bodyEnviado.assunto === 'string' && bodyEnviado.assunto.length > 0, 'payload leva o assunto');
assert(typeof bodyEnviado.corpoHtml === 'string' && bodyEnviado.corpoHtml.includes('joao@padariacentral.com.br') === false, 'corpoHtml não expõe o e-mail do destinatário (é o e-mail do remetente que aparece na assinatura)');
assert(bodyEnviado.nomeConsultor === 'Fernanda Souza', 'payload leva o nome do consultor logado');
const resultadoEl = document.getElementById('emailLoteResultado');
assert(resultadoEl.innerHTML.includes('joao@padariacentral.com.br'), 'resultado exibido mostra o e-mail do destinatário processado');

// ===== 9) sem conta conectada, o modal avisa e desabilita o envio =====
emailConfigAtual = null;
btnAbrirEmailLote.click();
await new Promise(r => setTimeout(r, 0));
assert(document.getElementById('emailLoteSemConta').style.display === 'block', 'sem conta conectada, o aviso "conecte seu e-mail" aparece');
assert(document.getElementById('btnEmailLoteEnviarTodos').disabled === true, 'sem conta conectada, "Enviar para todos" fica desabilitado');

// ===== 10) fechar o modal =====
document.getElementById('emailLoteClose').click();
assert(!emailLoteOverlayCheck.classList.contains('active'), 'clicar no X fecha o modal de e-mail em lote');

console.log('OK:', ok, 'FAIL:', fail);
window.__exit(fail > 0 ? 1 : 0);
})().catch(function(e){ console.log('ERRO NO TESTE:', e && e.stack || e); window.__exit(1); });
`;

window.__exit = (code) => process.exit(code);

window.__upsertChamadas = upsertChamadas;
window.__updateChamadas = updateChamadas;
window.__invokeChamadas = functionsInvokeChamadas;
window.__invokeResposta = functionsInvokeResposta;

dom.window.eval(jsCode + testScript);
