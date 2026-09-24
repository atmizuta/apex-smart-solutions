// Testa a página-ponte estática biometria.html (10/09/2026 — substituiu a Edge Function
// biometria-preview depois de descobrir que o Supabase reescreve GET text/html para text/plain,
// ver REGRAS_NEGOCIO.md seção 19). Roda o HTML de verdade num jsdom e simula diferentes
// querystrings.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('biometria.html', 'utf8');

function montarDom(search){
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://apexsmart.com.br/biometria.html' + search });
  return dom.window.document;
}

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// --- tags Open Graph são estáticas (independem de qualquer parâmetro) ---
const docBase = montarDom('');
assert(docBase.querySelector('meta[property="og:image"]').content === 'https://apexsmart.com.br/biometria_preview.png', 'og:image aponta pra imagem única/compartilhada');
assert(docBase.querySelector('meta[property="og:title"]').content.includes('Claro Empresas'), 'og:title menciona Claro Empresas');
assert(docBase.querySelector('meta[property="og:description"]') !== null, 'og:description está presente');
assert(docBase.contentType !== 'text/plain', 'documento não é servido como text/plain (sanity check do jsdom)');

// --- com nome + link válidos ---
const docOk = montarDom('?nome=Jo%C3%A3o%20da%20Silva&link=https%3A%2F%2Fclaro.com.br%2Fbio%2Fabc123');
assert(docOk.getElementById('bioSaudacao').textContent === 'Olá, João da Silva!', 'saudação personalizada com o nome do cliente');
assert(docOk.getElementById('bioBotao').getAttribute('href') === 'https://claro.com.br/bio/abc123', 'botão aponta pro link real do cliente');
assert(docOk.getElementById('bioErro').style.display === 'none', 'sem mensagem de erro quando o link é válido');

// --- sem nome (cai pra saudação genérica) ---
const docSemNome = montarDom('?link=https%3A%2F%2Fclaro.com.br%2Fbio%2Fxyz');
assert(docSemNome.getElementById('bioSaudacao').textContent === 'Olá!', 'saudação genérica quando não há nome');

// --- nome com HTML/script embutido: não deve virar HTML de verdade (textContent, sem XSS) ---
const docXss = montarDom('?nome=%3Cscript%3Ealert(1)%3C%2Fscript%3E&link=https%3A%2F%2Fclaro.com.br%2Fbio%2Fabc');
assert(docXss.getElementById('bioSaudacao').textContent.includes('<script>'), 'nome malicioso fica só como texto literal (textContent), não é interpretado como tag');
assert(docXss.querySelectorAll('script').length === 1, 'nenhuma tag <script> extra foi injetada no DOM (só a original da página)');

// --- link inválido: esconde botão e mostra erro, não deixa href perigoso ---
const docLinkRuim = montarDom('?nome=Cliente&link=javascript%3Aalert(1)');
assert(docLinkRuim.getElementById('bioBotao').style.display === 'none', 'botão fica escondido quando o link é um esquema perigoso (javascript:)');
assert(docLinkRuim.getElementById('bioErro').style.display === 'block', 'mostra mensagem de erro quando o link é inválido');
assert(!docLinkRuim.getElementById('bioBotao').getAttribute('href').startsWith('javascript:'), 'href do botão nunca fica com esquema javascript: (continua o "#" original)');

// --- sem link nenhum ---
const docSemLink = montarDom('?nome=Cliente');
assert(docSemLink.getElementById('bioErro').style.display === 'block', 'mostra erro quando não há link nenhum');

// --- nome muito longo é truncado em 100 caracteres ---
const nomeLongo = 'A'.repeat(200);
const docNomeLongo = montarDom('?nome=' + encodeURIComponent(nomeLongo) + '&link=https%3A%2F%2Fclaro.com.br%2Fbio%2Fabc');
const saudacaoLonga = docNomeLongo.getElementById('bioSaudacao').textContent;
assert(saudacaoLonga.length < 115, 'nome muito longo é truncado (saudação não cresce sem limite): ' + saudacaoLonga.length + ' chars');

console.log(`\n--- RESULTADO: ${ok} passaram, ${fail} falharam ---`);
if(fail > 0) process.exitCode = 1;
