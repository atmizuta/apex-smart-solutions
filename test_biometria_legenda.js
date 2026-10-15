// test_biometria_legenda.js — legenda do WhatsApp com link da Claro na aba Biometria (15/10/2026, §86). Requer: npm i jsdom
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const dom = new JSDOM(html.replace(/<script>[\s\S]*?<\/script>/g, ''), { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} }, from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }), functions: { invoke: async () => ({ data: {}, error: null }) } }) };
const alerts = []; window.alert = m => alerts.push(m);
let copiado = null;
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: t => { copiado = t; return Promise.resolve(); } } });
const t = `
let ok = 0, fail = 0;
function assert(c, m){ if(c) ok++; else { fail++; console.log('FALHOU:', m); } }
const nome = document.getElementById('bioNome'), link = document.getElementById('bioLegendaLink'), leg = document.getElementById('bioLegenda');
assert(nome && link && leg && document.getElementById('btnCopiarLegendaBio'), 'campos da legenda existem');
assert(leg.value.indexOf('[cole aqui o link da Claro]') >= 0 && leg.value.indexOf('Olá!') === 0, 'legenda inicial sem nome/link');
nome.value = 'ADRIANO APARECIDO NAPPI'; nome.dispatchEvent(new window.Event('input'));
assert(leg.value.indexOf('Olá, Adriano!') === 0, 'usa o primeiro nome capitalizado (' + leg.value.slice(0, 20) + ')');
link.value = 'https://exemplo.claro.com.br/bio/abc123'; link.dispatchEvent(new window.Event('input'));
assert(leg.value.indexOf('https://exemplo.claro.com.br/bio/abc123') >= 0 && leg.value.indexOf('[cole aqui') < 0, 'link entra na legenda');
assert(bioLinkValido('https://a.com/x') && bioLinkValido('http://a.com') && !bioLinkValido('a.com') && !bioLinkValido('javascript:alert(1)') && !bioLinkValido('https://a b'), 'validacao do link');
link.value = 'javascript:alert(1)'; link.dispatchEvent(new window.Event('input'));
assert(leg.value.indexOf('javascript') < 0 && leg.value.indexOf('[cole aqui') >= 0, 'link invalido nao entra na legenda');
document.getElementById('btnCopiarLegendaBio').click();
assert(document.getElementById('bioLegendaErr').style.display === 'block', 'copiar sem link valido mostra erro');
link.value = 'https://exemplo.claro.com.br/bio/abc123'; link.dispatchEvent(new window.Event('input'));
document.getElementById('btnCopiarLegendaBio').click();
assert(document.getElementById('bioLegendaErr').style.display === 'none', 'erro some com link valido');
window.__res = () => ({ ok, fail });
`;
(async () => {
  window.eval(jsCode + '\n' + t);
  await new Promise(r => setTimeout(r, 50));
  let { ok, fail } = window.__res();
  if(copiado && copiado.indexOf('https://exemplo.claro.com.br/bio/abc123') >= 0 && copiado.indexOf('Olá, Adriano!') === 0) ok++; else { fail++; console.log('FALHOU: texto copiado para a area de transferencia'); }
  console.log('RESULTADO: ' + ok + ' passaram, ' + fail + ' falharam');
  if(fail) process.exitCode = 1;
})();
