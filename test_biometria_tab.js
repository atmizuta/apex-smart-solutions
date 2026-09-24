// Testa a aba "Biometria": validação de link, montagem do link a enviar (10/09/2026 v4, decisão
// final: link real da Claro direto, sem página-ponte — a imagem vai separada, como foto, ver
// REGRAS_NEGOCIO.md seção 19.9), montagem da mensagem do WhatsApp, e o fluxo de UI (clicar em
// "Gerar link" preenche o campo de resultado; erros de validação aparecem/desaparecem
// corretamente).
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

  // --- validarLinkBiometria (pura) ---
  assert(validarLinkBiometria('https://claro.com.br/bio/abc123') === true, 'link https válido é aceito');
  assert(validarLinkBiometria('http://claro.com.br/bio/abc123') === true, 'link http válido é aceito');
  assert(validarLinkBiometria('  https://claro.com.br/bio/abc  ') === true, 'link com espaço nas pontas é aceito (trim)');
  assert(validarLinkBiometria('claro.com.br/bio/abc') === false, 'link sem esquema (http/https) é rejeitado');
  assert(validarLinkBiometria('javascript:alert(1)') === false, 'esquema javascript: é rejeitado');
  assert(validarLinkBiometria('') === false, 'string vazia é rejeitada');
  assert(validarLinkBiometria('   ') === false, 'string só com espaços é rejeitada');

  // --- montarLinkBiometria (pura) ---
  // 10/09/2026 (v4, decisão final): sem página-ponte, o link gerado é o próprio link real da
  // Claro (só normalizado) — ver REGRAS_NEGOCIO.md seção 19.9.
  const linkGerado = montarLinkBiometria('João da Silva', 'https://claro.com.br/bio/abc123');
  assert(linkGerado === 'https://claro.com.br/bio/abc123', 'link gerado é o próprio link real da Claro, direto (sem página-ponte)');
  const linkComEspaco = montarLinkBiometria('Cliente', '  https://claro.com.br/bio/xyz  ');
  assert(linkComEspaco === 'https://claro.com.br/bio/xyz', 'link gerado remove espaços nas pontas do link informado');

  // --- montarMensagemWhatsapp (pura) ---
  // 10/09/2026: reforçada com boas práticas de mercado (identificação do consultor + reforço de
  // que o link é oficial), ver REGRAS_NEGOCIO.md seção 19.10.
  const msgComNome = montarMensagemWhatsapp('Maria', 'https://exemplo.com/x', 'Anderson');
  assert(msgComNome.startsWith('https://wa.me/?text='), 'mensagem do WhatsApp usa wa.me com texto pré-preenchido');
  assert(decodeURIComponent(msgComNome).includes('Olá, Maria!'), 'mensagem personaliza a saudação com o nome do cliente');
  assert(decodeURIComponent(msgComNome).includes('https://exemplo.com/x'), 'mensagem inclui o link gerado');
  assert(decodeURIComponent(msgComNome).includes('Aqui é Anderson, consultor(a) da Claro Empresas'), 'mensagem se apresenta com o nome do consultor logado (evita parecer disparo anônimo)');
  assert(decodeURIComponent(msgComNome).includes('link oficial gerado pelo sistema da Claro'), 'mensagem reforça que o link é oficial (boa prática contra desconfiança/phishing)');
  const msgSemNome = montarMensagemWhatsapp('', 'https://exemplo.com/y', 'Anderson');
  assert(decodeURIComponent(msgSemNome).includes('Olá! '), 'mensagem cai pra saudação genérica quando não há nome do cliente');
  const msgSemConsultor = montarMensagemWhatsapp('Maria', 'https://exemplo.com/z', '');
  assert(decodeURIComponent(msgSemConsultor).includes('Aqui é seu(sua) consultor(a) da Claro Empresas'), 'mensagem cai pra apresentação genérica quando não há nome do consultor (ex: não logado)');

  // --- fluxo de UI: aba sempre visível (todos os perfis) ---
  assert(document.getElementById('tabBtnBiometria') !== null, 'botão da aba Biometria existe no menu');
  assert(document.getElementById('tabBtnBiometria').style.display !== 'none', 'botão da aba Biometria não fica escondido por padrão (visível a todos os perfis)');

  // --- fluxo de UI: erro quando falta nome ---
  document.getElementById('bioNome').value = '';
  document.getElementById('bioLink').value = 'https://claro.com.br/bio/abc';
  document.getElementById('btnGerarBiometria').click();
  assert(document.getElementById('bioErr').style.display === 'block', 'mostra erro quando falta o nome do cliente');
  assert(document.getElementById('bioResultado').style.display !== 'block', 'não mostra o resultado quando há erro de validação');

  // --- fluxo de UI: erro quando link é inválido ---
  document.getElementById('bioNome').value = 'Cliente Teste';
  document.getElementById('bioLink').value = 'não é um link';
  document.getElementById('btnGerarBiometria').click();
  assert(document.getElementById('bioErr').style.display === 'block', 'mostra erro quando o link é inválido');
  assert(document.getElementById('bioErr').textContent.includes('válido'), 'mensagem de erro explica que o link precisa ser válido');

  // --- fluxo de UI: geração com sucesso ---
  document.getElementById('bioNome').value = 'Cliente Teste';
  document.getElementById('bioLink').value = 'https://claro.com.br/bio/real-123';
  document.getElementById('btnGerarBiometria').click();
  assert(document.getElementById('bioErr').style.display === 'none', 'erro some quando a geração dá certo');
  assert(document.getElementById('bioResultado').style.display === 'block', 'mostra o resultado quando a geração dá certo');
  const campoGerado = document.getElementById('bioLinkGerado').value;
  assert(campoGerado === 'https://claro.com.br/bio/real-123', 'campo de resultado mostra o próprio link real do cliente, direto (sem página-ponte)');
  const hrefWhats = document.getElementById('btnWhatsappBiometria').getAttribute('href');
  assert(hrefWhats.startsWith('https://wa.me/?text='), 'botão do WhatsApp fica com o link wa.me pronto');

  // --- botão "Baixar imagem" (10/09/2026 v4, decisão final: imagem enviada como foto separada,
  // já que o preview de link do WhatsApp sempre reduz a imagem a uma miniatura pequena) ---
  const btnBaixar = document.getElementById('btnBaixarImagemBiometria');
  assert(btnBaixar !== null, 'botão "Baixar imagem" existe');
  assert(btnBaixar.getAttribute('href') === 'https://apexsmart.com.br/biometria_preview.png', 'botão "Baixar imagem" aponta pra imagem publicada em apexsmart.com.br');
  assert(btnBaixar.hasAttribute('download'), 'botão "Baixar imagem" usa atributo download');

  // --- fluxo de UI: copiar não quebra (clipboard mockado) ---
  document.getElementById('btnCopiarBiometria').click();
  assert(document.getElementById('bioCopiadoMsg').style.display === 'block', 'mostra confirmação "Link copiado." ao clicar em copiar');

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
