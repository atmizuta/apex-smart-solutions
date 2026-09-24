// Testa a lógica PURA da Edge Function biometria-preview (validação de link, escape de HTML,
// montagem das páginas de erro/ponte) direto do arquivo .ts publicado — mesmo esquema usado em
// test_edge_function_sync_leads.js: remove só sintaxe TypeScript (export/tipos), roda em Node puro.
const fs = require('fs');

let src = fs.readFileSync('edge_function_biometria_preview.ts', 'utf8');

src = src
  .replace(/^export function/gm, 'function')
  .replace(/: string/g, '')
  .replace(/: boolean/g, '');

const fimTrecho = src.indexOf('Deno.serve');
const trechoPuro = src.slice(0, fimTrecho);

const sandbox = {};
new Function('sandbox', trechoPuro + `
  sandbox.escapeHtml = escapeHtml;
  sandbox.validarLink = validarLink;
  sandbox.paginaErro = paginaErro;
  sandbox.paginaBridge = paginaBridge;
  sandbox.PREVIEW_IMAGE_URL = PREVIEW_IMAGE_URL;
`)(sandbox);

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// --- escapeHtml ---
assert(sandbox.escapeHtml('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;', 'escapeHtml neutraliza tags de script');
assert(sandbox.escapeHtml('João "Silva" & Cia\'s') === 'João &quot;Silva&quot; &amp; Cia&#39;s', 'escapeHtml escapa aspas duplas, & e aspas simples');
assert(sandbox.escapeHtml('texto normal') === 'texto normal', 'escapeHtml não altera texto sem caracteres especiais');

// --- validarLink ---
assert(sandbox.validarLink('https://claro.com.br/biometria/abc123') !== null, 'link https válido é aceito');
assert(sandbox.validarLink('http://claro.com.br/biometria/abc123') !== null, 'link http válido é aceito');
assert(sandbox.validarLink('javascript:alert(1)') === null, 'esquema javascript: é rejeitado');
assert(sandbox.validarLink('data:text/html,<script>alert(1)</script>') === null, 'esquema data: é rejeitado');
assert(sandbox.validarLink('não é uma url') === null, 'texto que não é URL é rejeitado');
assert(sandbox.validarLink('') === null, 'string vazia é rejeitada');
assert(sandbox.validarLink('ftp://exemplo.com/arquivo') === null, 'esquema ftp: é rejeitado (só http/https)');

// --- paginaErro ---
const erroHtml = sandbox.paginaErro('O link informado não é uma URL válida.');
assert(erroHtml.includes('Link inválido'), 'paginaErro inclui o título "Link inválido"');
assert(erroHtml.includes('O link informado não é uma URL válida.'), 'paginaErro inclui a mensagem passada');

const erroXss = sandbox.paginaErro('<script>alert(1)</script>');
assert(!erroXss.includes('<script>alert(1)</script>'), 'paginaErro escapa a mensagem (sem XSS)');

// --- paginaBridge ---
const bridgeComNome = sandbox.paginaBridge('https://claro.com.br/bio/abc123', 'João da Silva');
assert(bridgeComNome.includes('Olá, João da Silva!'), 'paginaBridge personaliza a saudação com o nome do cliente');
assert(bridgeComNome.includes('href="https://claro.com.br/bio/abc123"'), 'paginaBridge usa o link real do cliente no botão');
assert(bridgeComNome.includes(`og:image" content="${sandbox.PREVIEW_IMAGE_URL}"`), 'paginaBridge usa a imagem de preview única/compartilhada nas tags OG');
assert(bridgeComNome.includes('og:title'), 'paginaBridge inclui og:title');
assert(bridgeComNome.includes('og:description'), 'paginaBridge inclui og:description');

const bridgeSemNome = sandbox.paginaBridge('https://claro.com.br/bio/xyz', '');
assert(bridgeSemNome.includes('Olá!</h1>') || bridgeSemNome.includes('Olá!\n'), 'paginaBridge cai para saudação genérica "Olá!" quando não há nome');

const bridgeXss = sandbox.paginaBridge('https://claro.com.br/bio/abc', '<script>alert(1)</script>');
assert(!bridgeXss.includes('<script>alert(1)</script>'), 'paginaBridge escapa o nome do cliente (sem XSS)');
assert(bridgeXss.includes('&lt;script&gt;'), 'paginaBridge mostra o nome escapado como texto literal');

const bridgeNomeLongo = sandbox.paginaBridge('https://claro.com.br/bio/abc', 'A'.repeat(200));
assert(bridgeNomeLongo.match(/A{100}/) && !bridgeNomeLongo.match(/A{101}/), 'paginaBridge trunca nomes muito longos em 100 caracteres');

console.log(`\n--- RESULTADO: ${ok} passaram, ${fail} falharam ---`);
if(fail > 0) process.exit(1);
