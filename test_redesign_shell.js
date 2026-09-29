// test_redesign_shell.js (25/09/2026): shell do redesign — Cobertura removida, menu lateral,
// cabeçalho de página, logos. Roda contra o painel gerado (bash run_tests.sh).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

function montar(role){
  const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {};
  const vazio = { data: [], error: null };
  const builder = () => {
    const b = new Proxy({}, { get: (_, p) => p === 'then' ? (res) => res(vazio) : (p === 'single' || p === 'maybeSingle') ? () => ({ then: (res) => res({ data: null, error: null }) }) : () => b });
    return b;
  };
  w.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signOut: async () => ({}) },
    from: builder, rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({ data: null, error: null }) },
  }) };
  // mesmo eval: currentUser é `let` no script do painel e não é visível de outro eval
  w.eval(jsCode + `
;currentUser = { id: 'u1', nome: 'Rafael Teste', username: 'rafael', role: '${role}' }; enterApp();`);
  return w;
}

(async () => {
  // --- Cobertura removida (Task 2) ---
  const w = montar('admin');
  const d = w.document;
  assert(!d.getElementById('tabBtnCobertura'), 'botão da aba Cobertura não existe mais');
  assert(!d.getElementById('panel-cobertura'), 'painel da aba Cobertura não existe mais');
  assert(!d.getElementById('covMapaContainer'), 'mapa de cobertura não existe mais');
  assert(w.eval('typeof initMapaCobertura') === 'undefined', 'initMapaCobertura foi removida');
  assert(w.eval('typeof verificarCobertura') === 'function', 'verificarCobertura continua (usada na proposta)');
  assert(w.eval('typeof geocodeEndereco') === 'function', 'geocodeEndereco continua (usada na proposta)');
  assert(w.eval('typeof renderCoberturaTable') === 'function', 'renderCoberturaTable continua (upload de KMZ na Base de Dados)');
  assert(!!d.getElementById('googleApiKeyInput'), 'campo da chave do Google continua na Base de Dados');
  assert(!/maps\/api\/js/.test(html), 'o painel não carrega mais o script do mapa do Google (a geocodificação da proposta continua)');

  // --- Shell (Task 3) ---
  assert(!!d.querySelector('aside.sidebar#sidebar nav.tabs#tabsNav'), 'abas moraram pro menu lateral (aside.sidebar > nav#tabsNav)');
  assert(!d.querySelector('header.topbar'), 'cabeçalho antigo (header.topbar) saiu');
  assert(!!d.querySelector('#sidebar .userbox #ubName') && !!d.getElementById('btnLogout'), 'usuário e Sair ficam no rodapé do menu');
  assert(d.getElementById('ubName').textContent === 'Rafael Teste', 'nome do usuário aparece no menu');

  const btnFunil = d.querySelector('#tabsNav button[data-tab="funil"]');
  btnFunil.click();
  assert(d.getElementById('pageTitle') && d.getElementById('pageTitle').textContent === 'Funil', 'título da página acompanha a aba clicada');
  assert(d.getElementById('pageSub') && d.getElementById('pageSub').textContent.length > 5, 'subtítulo da página preenchido');
  assert(d.getElementById('sbIndicator') && d.getElementById('sbIndicator').dataset.tab === 'funil', 'indicador vermelho foi pra aba clicada');

  // logos: PDF/Word/dashboard leem daqui
  let apexSrc = '', claroSrc = '';
  try { apexSrc = w.eval('getApexLogoSrc()'); claroSrc = w.eval('getClaroLogoSrc()'); } catch(e){}
  assert(/^data:image\/png;base64,/.test(apexSrc), 'getApexLogoSrc devolve o data URI do logo Apex');
  assert(/^data:image\/jpeg;base64,/.test(claroSrc), 'getClaroLogoSrc devolve o data URI do logo Claro');
  assert(!/header\.topbar \.logoChip/.test(jsCode), 'nenhum código lê mais o logo do cabeçalho antigo');

  // recolher menu, inclusive sem localStorage
  let r1, r2;
  try { r1 = w.eval('alternarMenuRecolhido(true)'); } catch(e){}
  assert(r1 === true && d.body.classList.contains('sbCollapsed'), 'menu recolhe');
  try { r2 = w.eval('alternarMenuRecolhido(false)'); } catch(e){}
  assert(r2 === false && !d.body.classList.contains('sbCollapsed'), 'menu expande');
  w.eval(`Object.defineProperty(window, 'localStorage', { configurable: true, get(){ throw new Error('bloqueado'); } });`);
  let semErro = true; try { w.eval('alternarMenuRecolhido()'); } catch(e){ semErro = false; }
  assert(semErro, 'recolher o menu com localStorage bloqueado não quebra');

  // perfil consultor: abas de admin escondidas e indicador nunca numa aba escondida
  const wc = montar('consultor');
  const dc = wc.document;
  ['tabBtnBaseDados', 'tabBtnMovimentacao', 'tabBtnConsultores', 'tabBtnFechamento'].forEach(id => {
    assert(dc.getElementById(id).style.display === 'none', `consultor não vê ${id}`);
  });
  const ativo = dc.querySelector('#tabsNav button.active');
  const ind = dc.getElementById('sbIndicator');
  assert(ativo && ativo.style.display !== 'none' && ind && ind.dataset.tab === ativo.dataset.tab, 'indicador fica na aba ativa visível do consultor');

  // --- Componentes (Task 4) ---
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  assert(!/IDENTIDADE VISUAL "SINAL DE ÁPICE" \(24\/09\/2026\)/.test(css), 'camada antiga de identidade (24/09) saiu do CSS');
  assert(!/border-radius:(10|12|14)px/.test(css), 'nenhum componente com os cantos arredondados antigos (10–14px)');
  assert(/\/\* ---------- 5\. COMPONENTES ---------- \*\//.test(css) && /\/\* ---------- 6\. TELAS ---------- \*\//.test(css), 'CSS novo tem as seções de componentes e telas');
  // cores de status soltas nas telas (fora dos geradores de PDF/Word, que não mudam)
  // 29/09/2026: emailLoteMontarHtml() entrou na mesma exceção dos geradores de PDF/Word — monta HTML
  // de e-mail que sai do painel (cliente de e-mail não lê var(--token) do CSS), então usa cores
  // literais de propósito, como os outros geradores de documento externo.
  const semDocs = jsCode.replace(/function (montarPdfProposta|montarPdfPropostaCliente|montarDocxProposta|generateFaturaAnalisePDF|emailLoteMontarHtml)\b[\s\S]*?\n}\n/g, '');
  const soltas = (semDocs + htmlNoScript.replace(/<style>[\s\S]*?<\/style>/, '')).match(/#(fee2e2|dcfce7|16a34a|dc2626|9ca3af|6b7280|111827|f3f4f6|fafafa|f1f2f4|eef0f2|d97706|fef3c7|b45309|15803d|b91c1c|fdf2f2)\b/gi) || [];
  assert(soltas.length === 0, 'cores de status viraram tokens (sobraram: ' + [...new Set(soltas)].join(', ') + ')');
  assert(w.eval('typeof corToken') === 'function', 'corToken existe (cores pro Chart.js)');
  assert(!!d.querySelector('.spinnerNote.isLoading') || /spinnerNote isLoading/.test(html), 'carregamentos usam o mini carregador (.spinnerNote.isLoading)');
  assert(!/⚠ \$\{estouradas/.test(jsCode), 'alerta do funil sem o ⚠ (ícone vem do CSS)');

  // --- Dashboard de Produção (Task 6) ---
  const dashB64 = (jsCode.match(/const PRODUCAO_DASHBOARD_TPL_B64 = "([A-Za-z0-9+/=]+)"/) || [])[1] || '';
  const dash = Buffer.from(dashB64, 'base64').toString('utf8');
  assert(/--accent:#E30613/.test(dash), 'dashboard usa o Vermelho Sinal do manual');
  assert(/family=Barlow\+Condensed/.test(dash), 'dashboard carrega as fontes Barlow');
  assert(/Sinal de Ápice \(redesign 25\/09\/2026\)/.test(dash), 'dashboard tem a camada da marca');
  assert(/\/jsdom\/i\.test\(navigator\.userAgent/.test(dash) && /prefers-reduced-motion/.test(dash), 'movimento do dashboard desliga em jsdom e com reduced-motion');
  assert(!/#16a34a|#dc2626|#eab308|#f97316/i.test(dash), 'dashboard sem as cores de status antigas');

  console.log(`--- RESULTADO: ${ok} passaram, ${fail} falharam ---`);
  if(fail) process.exitCode = 1;
})().catch(e => { console.log('ERRO FATAL:', e.stack); process.exitCode = 1; });
