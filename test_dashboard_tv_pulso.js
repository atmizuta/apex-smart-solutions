// test_dashboard_tv_pulso.js (25/09/2026): no Modo TV do Dashboard de Produção, o número que muda
// na atualização automática pulsa. Roda só o script de movimento do dashboard num DOM mínimo, com
// userAgent de navegador (o script se desliga em jsdom de propósito).
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const b64 = html.match(/const PRODUCAO_DASHBOARD_TPL_B64 = "([A-Za-z0-9+/=]+)"/)[1];
const dash = Buffer.from(b64, 'base64').toString('utf8');
const ini = dash.indexOf('// movimento (25/09/2026)');
const fim = dash.indexOf('})();', ini) + 5;
const scriptMovimento = dash.slice(ini, fim);

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

const dom = new JSDOM(`<!DOCTYPE html><body class="tv-mode">
  <div class="cards" id="cards">
    <div class="card"><div class="label">Valor total</div><div class="value" id="kpiTotal">R$ 10,00</div></div>
  </div>
  <div id="diaria"><div class="card"><div class="label">Contratos</div><div class="value">3</div></div></div>
</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
Object.defineProperty(w.navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Windows NT 10.0) Chrome/140' });
w.matchMedia = () => ({ matches: false, addEventListener(){}, addListener(){} });

(async () => {
  assert(scriptMovimento.length > 200, 'script de movimento encontrado no template do dashboard');
  w.eval(scriptMovimento);
  const d = w.document;
  assert(d.documentElement.classList.contains('motion'), 'movimento liga fora do jsdom');
  await new Promise(r => setTimeout(r, 1100)); // contagem inicial termina
  const kpi = d.getElementById('kpiTotal');
  assert(kpi.textContent === 'R$ 10,00', 'contagem inicial termina no texto original');

  // atualização automática troca o texto no MESMO elemento (renderKPIs usa textContent)
  kpi.textContent = 'R$ 20,00';
  await new Promise(r => setTimeout(r, 50));
  assert(kpi.classList.contains('apxPulse'), 'número que mudou no mesmo elemento pulsa no Modo TV');

  // Visão Diária recria os cards com innerHTML: o valor novo pulsa em vez de recontar do zero
  d.getElementById('diaria').innerHTML = '<div class="card"><div class="label">Contratos</div><div class="value">5</div></div>';
  await new Promise(r => setTimeout(r, 50));
  const novo = d.querySelector('#diaria .value');
  assert(novo.classList.contains('apxPulse'), 'card recriado com valor diferente pulsa');
  assert(novo.textContent === '5', 'card recriado mostra o valor novo direto (sem recontar do zero)');

  console.log(`--- RESULTADO: ${ok} passaram, ${fail} falharam ---`);
  if(fail) process.exitCode = 1;
})().catch(e => { console.log('ERRO FATAL:', e.stack); process.exitCode = 1; });
