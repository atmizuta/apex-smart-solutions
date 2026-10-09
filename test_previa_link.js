// Prévia do link do painel no WhatsApp e afins (09/10/2026, seção 79): tags Open Graph no <head> e a imagem
// painel_preview.png (1200x630, logo dupla Apex | Claro empresas da identidade visual).
const fs = require('fs');
const { JSDOM } = require('jsdom');

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

for(const arq of ['_template.html', 'painel_clientes_apex.html']){
  const doc = new JSDOM(fs.readFileSync(arq, 'utf8')).window.document;
  const meta = p => { const el = doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`); return el ? el.getAttribute('content') : null; };
  assert(/^https:\/\/apexsmart\.com\.br\/painel_preview\.png\?v=\d+$/.test(meta('og:image') || ''), arq + ': og:image com endereço completo e versão — achou ' + meta('og:image'));
  assert(meta('og:image:width') === '1200' && meta('og:image:height') === '630', arq + ': tamanho da imagem declarado');
  assert(!!meta('og:title') && !!meta('og:description'), arq + ': título e descrição da prévia');
  assert(meta('og:type') === 'website', arq + ': og:type');
  assert(meta('twitter:card') === 'summary_large_image', arq + ': twitter:card com imagem grande');
  // a prévia é pública (qualquer um com o link vê): nada de dado de cliente nem da operação
  assert(!/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test((meta('og:title') || '') + (meta('og:description') || '')), arq + ': prévia sem CNPJ');
}

const png = fs.readFileSync('painel_preview.png');
assert(png.slice(1, 4).toString() === 'PNG', 'painel_preview.png é PNG');
assert(png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, 'imagem 1200x630 — achou ' + png.readUInt32BE(16) + 'x' + png.readUInt32BE(20));
assert(png.length < 300 * 1024, 'imagem abaixo de 300 KB (limite do WhatsApp para a prévia grande) — tem ' + png.length);

console.log(`\n--- RESULTADO: ${ok} passaram, ${fail} falharam ---`);
if(fail > 0) process.exitCode = 1;
