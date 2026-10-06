// Testa a aba "Biometria" (06/10/2026, redesign a pedido do usuário): virou só "nome do cliente ->
// baixar imagem personalizada" — o fluxo antigo de link de biometria da Claro + "Enviar no
// WhatsApp"/"Copiar link" foi removido (ver REGRAS_NEGOCIO.md seção 19.12). Testa que os elementos
// do fluxo antigo sumiram, que o botão "Baixar imagem" exige nome antes de baixar, e que a imagem
// base aponta pro arquivo publicado em apexsmart.com.br.
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
  from: () => ({ select: function(){return this;}, then: (resolve) => resolve({ data: [], error: null }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;
window.navigator.clipboard = { writeText: async () => {} };

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // --- fluxo de UI: aba sempre visível (todos os perfis) ---
  assert(document.getElementById('tabBtnBiometria') !== null, 'botão da aba Biometria existe no menu');
  assert(document.getElementById('tabBtnBiometria').style.display !== 'none', 'botão da aba Biometria não fica escondido por padrão (visível a todos os perfis)');

  // --- redesign 06/10/2026: campo de link e o fluxo de WhatsApp/copiar link sumiram ---
  assert(document.getElementById('bioLink') === null, 'campo "Link de biometria (da Claro)" não existe mais');
  assert(document.getElementById('bioLinkGerado') === null, 'campo de link gerado não existe mais');
  assert(document.getElementById('btnWhatsappBiometria') === null, 'botão "Enviar no WhatsApp" não existe mais');
  assert(document.getElementById('btnCopiarBiometria') === null, 'botão "Copiar link" não existe mais');
  assert(document.getElementById('bioResultado') === null, 'bloco de resultado antigo (link + botões) não existe mais');
  assert(typeof validarLinkBiometria === 'undefined', 'validarLinkBiometria foi removida (sem uso)');
  assert(typeof montarLinkBiometria === 'undefined', 'montarLinkBiometria foi removida (sem uso)');
  assert(typeof montarMensagemWhatsapp === 'undefined', 'montarMensagemWhatsapp foi removida (sem uso)');

  // --- campo "Nome do cliente" e preview continuam existindo ---
  assert(document.getElementById('bioNome') !== null, 'campo "Nome do cliente" existe');
  const preview = document.getElementById('bioImgPreview');
  assert(preview !== null, 'imagem de preview existe');
  assert(preview.getAttribute('src') === 'https://apexsmart.com.br/biometria_preview.png', 'preview começa apontando pra imagem publicada em apexsmart.com.br');

  // --- botão "Baixar imagem" (renomeado de "Gerar link", 06/10/2026) ---
  const btnBaixar = document.getElementById('btnBaixarImagemBiometria');
  assert(btnBaixar !== null, 'botão "Baixar imagem" existe');
  assert(btnBaixar.textContent.trim() === 'Baixar imagem', 'botão mostra o texto "Baixar imagem" (não mais "Gerar link")');
  assert(btnBaixar.getAttribute('href') === 'https://apexsmart.com.br/biometria_preview.png', 'botão "Baixar imagem" começa apontando pra imagem publicada em apexsmart.com.br (até o canvas gerar a versão personalizada)');
  assert(btnBaixar.hasAttribute('download'), 'botão "Baixar imagem" usa atributo download');
  assert(document.getElementById('btnGerarBiometria') === null, 'botão "Gerar link" não existe mais');

  // --- fluxo de UI: clicar em "Baixar imagem" sem nome mostra erro e não deixa baixar ---
  document.getElementById('bioNome').value = '';
  const evtSemNome = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  btnBaixar.dispatchEvent(evtSemNome);
  assert(document.getElementById('bioErr').style.display === 'block', 'mostra erro quando falta o nome do cliente');
  assert(document.getElementById('bioErr').textContent.includes('nome'), 'mensagem de erro pede o nome do cliente');
  assert(evtSemNome.defaultPrevented === true, 'clique é cancelado (preventDefault) quando falta o nome, pra não baixar a imagem sem personalizar');

  // --- fluxo de UI: com nome preenchido, o clique não é bloqueado e o erro some ---
  document.getElementById('bioNome').value = 'Cliente Teste';
  const evtComNome = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  btnBaixar.dispatchEvent(evtComNome);
  assert(document.getElementById('bioErr').style.display === 'none', 'erro some quando o nome está preenchido');
  assert(evtComNome.defaultPrevented === false, 'clique não é cancelado quando o nome está preenchido (deixa o navegador baixar)');

  console.log(\`\\n--- RESULTADO: \${ok} passaram, \${fail} falharam ---\`);
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.error('ERRO NO TESTE:', e);
  window.__testResult = 'FAIL';
}
})();
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 50);
