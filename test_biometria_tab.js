// Testa a aba "Biometria" (06/10/2026, ver REGRAS_NEGOCIO.md seção 19.11): o consultor digita só o
// nome do cliente, a imagem é desenhada num <canvas> (preview ao vivo) e baixada como PNG
// personalizado. O campo de link da Claro e o fluxo do link/WhatsApp foram removidos da aba.
// jsdom não tem canvas: o teste injeta um contexto 2D falso que registra o que foi desenhado.
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

  // --- helpers puros ---
  assert(bioNormalizarNome('  João   da  Silva ') === 'João da Silva', 'normaliza espaços do nome');
  assert(bioNormalizarNome(null) === '', 'nome nulo vira string vazia');
  assert(bioNomeArquivo('João da Silva') === 'biometria-joao-da-silva.png', 'nome do arquivo sem acento e com hífens');
  assert(bioNomeArquivo('  ') === 'biometria-cliente.png', 'nome do arquivo cai pra "cliente" quando vazio');
  assert(bioNomeArquivo('Açaí & Cia/Ltda.').startsWith('biometria-acai-cia-ltda'), 'nome do arquivo remove símbolos');

  // --- aba visível a todos os perfis ---
  assert(document.getElementById('tabBtnBiometria') !== null, 'botão da aba Biometria existe no menu');
  assert(document.getElementById('tabBtnBiometria').style.display !== 'none', 'aba Biometria visível a todos os perfis');

  // --- o campo de link e o fluxo do link saíram da aba ---
  ['bioLink','btnGerarBiometria','bioLinkGerado','btnCopiarBiometria','btnWhatsappBiometria','bioResultado'].forEach(function(id){
    assert(document.getElementById(id) === null, 'elemento removido da aba: ' + id);
  });
  assert(document.getElementById('bioNome') !== null, 'campo Nome do cliente continua na aba');
  const canvas = document.getElementById('bioCanvas');
  assert(canvas !== null && canvas.width === 1080 && canvas.height === 1080, 'preview é um canvas 1080x1080');

  // --- desenho: contexto 2D falso grava os textos desenhados ---
  function ctxFalso(){
    const c = { textos: [], retangulos: 0, imagens: 0, alphas: [] , globalAlpha: 1, font: '' };
    ['beginPath','moveTo','arcTo','closePath','fill','arc','fillRect'].forEach(function(m){ c[m] = function(){ if(m === 'fillRect') c.retangulos++; }; });
    c.createLinearGradient = function(){ return { addColorStop(){} }; };
    c.measureText = function(t){ const tam = parseInt(c.font.match(/(\\d+)px/)[1], 10); return { width: t.length * tam * 0.55 }; };
    c.fillText = function(t, x, y){ c.textos.push({ t, x, y, font: c.font, alpha: c.globalAlpha }); };
    c.drawImage = function(){ c.imagens++; };
    return c;
  }
  let ctxAtual = null;
  canvas.getContext = function(){ return ctxAtual; };

  ctxAtual = ctxFalso();
  assert(desenharImagemBiometria(canvas, 'Maria Souza') === true, 'desenha com contexto disponível');
  const dito = ctxAtual.textos.map(function(x){ return x.t; });
  ['Confirme sua identidade e','finalize seu pedido','Sua contratação Claro empresas está quase pronta.','Falta só a validação biométrica.',
   'Fazer minha validação biométrica','Validação por Serasa Experian, em nome da Claro','Ambiente seguro',
   'Enviado por Apex Smart Solutions \u2014 Agente Autorizado Claro'].forEach(function(t){
    assert(dito.includes(t), 'imagem contém o texto fixo: ' + t);
  });
  const txtNome = ctxAtual.textos.find(function(x){ return x.t === 'Maria Souza'; });
  assert(!!txtNome, 'imagem contém o nome do cliente');
  assert(txtNome && txtNome.alpha === 1, 'nome preenchido é desenhado opaco');
  assert(!dito.includes('Nome do cliente'), 'com nome preenchido, não aparece o texto-guia');

  ctxAtual = ctxFalso();
  desenharImagemBiometria(canvas, '   ');
  const guia = ctxAtual.textos.find(function(x){ return x.t === 'Nome do cliente'; });
  assert(!!guia && guia.alpha < 1, 'sem nome, o preview mostra um texto-guia apagado');

  ctxAtual = ctxFalso();
  const nomeGigante = 'Empresa de Telecomunicações e Serviços Digitais Integrados do Brasil Sociedade Limitada ME';
  desenharImagemBiometria(canvas, nomeGigante);
  const longo = ctxAtual.textos.find(function(x){ return x.t.startsWith('Empresa de'); });
  assert(!!longo && longo.t.endsWith('…') && longo.t.length < nomeGigante.length, 'nome muito longo é cortado com reticências');
  assert(longo && parseInt(longo.font.match(/(\\d+)px/)[1], 10) >= 32, 'nome longo não encolhe abaixo do tamanho mínimo');

  canvas.getContext = function(){ return null; };
  assert(desenharImagemBiometria(canvas, 'X') === false, 'sem suporte a canvas, retorna false sem quebrar');

  // --- preview ao vivo: digitar redesenha ---
  ctxAtual = ctxFalso();
  canvas.getContext = function(){ return ctxAtual; };
  const inp = document.getElementById('bioNome');
  inp.value = 'Carlos Lima';
  inp.dispatchEvent(new window.Event('input'));
  assert(ctxAtual.textos.some(function(x){ return x.t === 'Carlos Lima'; }), 'digitar o nome redesenha o preview na hora');

  // --- botão Baixar imagem ---
  const btn = document.getElementById('btnBaixarImagemBiometria');
  assert(btn !== null && btn.tagName === 'BUTTON', 'botão "Baixar imagem" existe');
  let baixado = null;
  canvas.toBlob = function(cb){ cb(new window.Blob(['png'], { type: 'image/png' })); };
  window.URL.createObjectURL = function(){ return 'blob:teste'; };
  window.URL.revokeObjectURL = function(){};
  window.HTMLAnchorElement.prototype.click = function(){ baixado = { href: this.href, download: this.download }; };

  const avisos = [];
  window.alert = function(m){ avisos.push(m); };
  inp.value = '';
  btn.click();
  assert(baixado === null, 'sem nome, não baixa a imagem');
  assert(avisos.some(function(m){ return m.includes('Informe o nome do cliente'); }) || document.querySelector('#apexToasts .apxToast.erro'), 'sem nome, avisa o consultor');

  inp.value = 'João da Silva';
  btn.click();
  assert(baixado && baixado.download === 'biometria-joao-da-silva.png', 'com nome, baixa PNG personalizado com o nome do cliente no arquivo');
  assert(baixado && baixado.href === 'blob:teste', 'download usa o blob gerado no próprio navegador (nada é enviado pra fora)');

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
