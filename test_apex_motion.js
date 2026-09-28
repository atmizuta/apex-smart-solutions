// test_apex_motion.js (25/09/2026): módulo de animação do redesign.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
const alerts = [];
w.alert = (m) => alerts.push(m);
const b = new Proxy({}, { get: (_, p) => p === 'then' ? (res) => res({ data: [], error: null }) : () => b });
w.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} }, from: () => b, rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({}) } }) };
w.eval(jsCode);
const d = w.document;
const M = w.ApexMotion;

(async () => {
  assert(!!M, 'ApexMotion exposto em window');
  if(!M){ console.log(`--- RESULTADO: ${ok} passaram, ${fail} falharam ---`); process.exitCode = 1; return; }
  assert(M.enabled === false, 'ApexMotion desligado em jsdom (testes leem o HTML final na hora)');

  // parseNumero: formatos pt-BR
  const casos = [['R$ 1.234,56', 1234.56], ['31%', 31], ['1.007', 1007], ['R$ 0,00', 0], ['128', 128], ['12,5%', 12.5]];
  casos.forEach(([txt, v]) => {
    const p = M.parseNumero(txt);
    assert(p && Math.abs(p.valor - v) < 1e-9, `parseNumero("${txt}") = ${v} (deu ${p && p.valor})`);
    assert(p && p.formatar(p.valor) === txt, `formatar devolve exatamente "${txt}" (deu "${p && p.formatar(p.valor)}")`);
  });
  ['—', 'Sem dados', '', '14:32', '25/09/2026'].forEach(txt => assert(M.parseNumero(txt) === null, `parseNumero("${txt}") = null (texto não numérico não é tocado)`));

  // countUp com motion ligado termina no texto original
  M.enabled = true;
  const el = d.createElement('div'); el.className = 'kpiValue'; el.textContent = 'R$ 48.320,15'; d.body.appendChild(el);
  M.countUp(el);
  await new Promise(r => setTimeout(r, 1300));
  assert(el.textContent === 'R$ 48.320,15', 'countUp termina com o texto idêntico ao original (' + el.textContent + ')');

  // cascata só nas 20 primeiras linhas
  const tb = d.createElement('table'); tb.className = 'tbl'; tb.innerHTML = '<tbody>' + Array.from({ length: 60 }, (_, i) => `<tr><td>${i}</td></tr>`).join('') + '</tbody>';
  const root = d.createElement('div'); root.appendChild(tb); d.body.appendChild(root);
  M.enter(root);
  const rows = tb.querySelectorAll('tbody tr');
  assert(rows[0].classList.contains('apxIn') && rows[19].classList.contains('apxIn'), 'linhas 1–20 entram em cascata');
  assert(!rows[20].classList.contains('apxIn') && !rows[59].classList.contains('apxIn'), 'linhas depois da 20ª aparecem direto');

  // teto do atraso da cascata: 60 cartões não podem deixar o 40º invisível por segundos
  const lista = d.createElement('div');
  lista.innerHTML = Array.from({ length: 60 }, (_, i) => `<div class="kanbanCard">c${i}</div>`).join('');
  d.body.appendChild(lista);
  M.enter(lista);
  const indices = [...lista.querySelectorAll('.kanbanCard')].map(c => Number(c.style.getPropertyValue('--i') || 0));
  assert(Math.max(...indices) <= 8, 'atraso da cascata tem teto (maior --i = ' + Math.max(...indices) + ')');
  assert(lista.querySelectorAll('.kanbanCard.apxIn').length === 60, 'todos os cartões entram (nenhum fica de fora da cascata)');

  // a animação de entrada não pode travar hover/arrastar depois de terminar (fill-mode backwards)
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const regraIn = (css.match(/\.motion \.apxIn\{[^}]*\}/) || [''])[0];
  assert(/backwards/.test(regraIn) && !/\bboth\b/.test(regraIn), 'cascata usa fill-mode backwards (não both) — ' + regraIn);

  // reduced-motion desliga
  const mmOriginal = w.matchMedia;
  w.matchMedia = () => ({ matches: true, addEventListener(){}, addListener(){} });
  assert(M.detectarHabilitado() === false, 'prefers-reduced-motion: reduce desliga as animações');
  w.matchMedia = mmOriginal;

  // carregador
  M.loader.show('Enviando base...');
  const ld = d.getElementById('apexLoader');
  assert(ld && ld.classList.contains('on') && ld.textContent.includes('Enviando base...'), 'loader aparece com a mensagem');
  M.loader.hide();
  assert(ld && !ld.classList.contains('on'), 'loader some');
  let terminou = false;
  await M.comCarregador('X', async () => { throw new Error('falhou'); }).catch(() => { terminou = true; });
  assert(terminou && !ld.classList.contains('on'), 'comCarregador esconde o loader mesmo quando a operação falha');

  // esqueletos
  const alvo = d.createElement('div'); alvo.innerHTML = '<p>conteúdo</p>'; d.body.appendChild(alvo);
  M.enabled = false; M.skeleton(alvo, 'kpis');
  assert(alvo.innerHTML === '<p>conteúdo</p>', 'skeleton não mexe em nada com o movimento desligado (testes)');
  M.enabled = true; M.skeleton(alvo, 'kpis');
  assert(alvo.querySelectorAll('.apxSkel').length >= 4 && alvo.getAttribute('aria-busy') === 'true', 'skeleton de KPIs desenha os blocos e marca aria-busy');
  M.skeleton(alvo, 'tabela');
  assert(alvo.querySelectorAll('.apxSkel').length >= 6, 'skeleton de tabela desenha as linhas');

  // avisos: em jsdom caem no alert (comportamento antigo)
  M.enabled = false;
  w.mostrarAviso('Senha redefinida com sucesso.', 'ok');
  assert(alerts.includes('Senha redefinida com sucesso.'), 'mostrarAviso usa alert quando o movimento está desligado');
  M.enabled = true;
  w.mostrarAviso('Proposta salva', 'ok');
  assert(!!d.querySelector('#apexToasts .apxToast'), 'mostrarAviso cria um toast quando o movimento está ligado');

  // fecharOverlay: sem movimento fecha na hora
  const ov = d.createElement('div'); ov.className = 'overlay active'; d.body.appendChild(ov);
  M.enabled = false; w.fecharOverlay(ov);
  assert(!ov.classList.contains('active'), 'fecharOverlay fecha na hora com o movimento desligado');

  // alert() só no fallback do mostrarAviso e no aviso de monitoramento (esse precisa bloquear)
  const alertsNoCodigo = (jsCode.match(/\balert\(/g) || []).length;
  assert(alertsNoCodigo === 2, 'alert() só no fallback e no aviso de monitoramento (achou ' + alertsNoCodigo + ')');
  assert(/window\.alert\('Aviso: o uso desta plataforma é monitorado/.test(jsCode), 'aviso "uso monitorado" continua bloqueante (alert), não some num toast');

  // celular: menu vira só ícones e o botão de recolher fica visível
  const cssTodo = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const mq = (cssTodo.match(/@media \(max-width:768px\)\{[\s\S]*?\n  \}/) || [''])[0];
  assert(/--sb-w:var\(--sb-w-collapsed\)/.test(mq) && /\.sbCollapse\{display:none/.test(mq), 'em tela estreita o menu lateral fica fixo só com ícones (sem botão de recolher)');

  // esqueleto não fica preso quando a consulta dá erro; carregador da entrada não trava a tela
  const dom2 = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w2 = dom2.window;
  w2.alert = () => {};
  const comErro = new Proxy({}, { get: (_, p) => p === 'then' ? (res) => res({ data: null, error: { message: 'falha simulada' } }) : () => comErro });
  w2.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} }, from: () => comErro, rpc: async () => ({ data: null, error: { message: 'x' } }), functions: { invoke: async () => ({}) } }) };
  w2.console.error = () => {};
  w2.eval(jsCode + `
    ;window.__rodarErros = async function(){
      currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
      ApexMotion.enabled = true;
      await loadConversaoVendas();
      await loadFechamento();
      let lancou = false;
      currentUser = null;
      try { enterApp(); } catch(e){ lancou = true; }
      return lancou;
    };`);
  const lancou = await w2.__rodarErros();
  const d2 = w2.document;
  ['conversaoResumoCards', 'fechamentoResumoCards'].forEach(id => {
    const el = d2.getElementById(id);
    assert(el && !el.querySelector('.apxSkel') && el.getAttribute('aria-busy') !== 'true', `esqueleto de #${id} some quando a consulta falha`);
  });
  assert(lancou && !d2.getElementById('apexLoader').classList.contains('on'), 'erro dentro de enterApp não deixa o carregador de tela cheia travado');

  console.log(`--- RESULTADO: ${ok} passaram, ${fail} falharam ---`);
  if(fail) process.exitCode = 1;
})().catch(e => { console.log('ERRO FATAL:', e.stack); process.exitCode = 1; });
