// test_sidebar_nav.js — menu lateral.
// 27/09/2026 (Anderson): menu vertical à esquerda com grupos (Visão geral/Vendas/Ferramentas/Administração)
// e gaveta com hambúrguer no celular.
// 28/09/2026 (Rafael): o menu passou a ser o do redesign "Sinal de Ápice" (aside.sidebar bordô, nav#tabsNav
// com indicador, recolhível; no celular fica só com ícones em vez da gaveta). Os grupos foram mantidos.
// Este teste continua cobrindo o que vale nos dois: troca de aba, estado ativo e grupos que não atrapalham
// o clique. (Menu recolhido, indicador e cabeçalho de página: test_redesign_shell.js.)
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });

dom.window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {} },
  from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
dom.window.alert = () => {};
dom.window.confirm = () => true;
dom.window.jspdf = { jsPDF: function(){ return {}; } };

const testScript = `
let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// ===== 1) Estrutura: menu lateral com grupos =====
const nav = document.getElementById('tabsNav');
assert(nav !== null, 'nav (id=tabsNav) existe');
assert(!!nav.closest('aside.sidebar'), 'nav fica dentro do menu lateral (aside.sidebar)');
assert(document.querySelectorAll('#tabsNav .navGroupLabel').length >= 4, 'menu tem pelo menos 4 grupos (Visão geral/Vendas/Ferramentas/Administração)');
const rotulos = Array.from(document.querySelectorAll('#tabsNav .navGroupLabel')).map(g => g.textContent.trim());
assert(['Visão geral', 'Vendas', 'Ferramentas', 'Administração'].every(r => rotulos.includes(r)), 'grupos com os nomes certos (' + rotulos.join(', ') + ')');

// ===== 2) Troca de aba continua funcionando (data-tab / .panel.active) =====
const btnProducao = document.querySelector('#tabsNav button[data-tab="producao"]');
const btnBusca = document.querySelector('#tabsNav button[data-tab="busca"]');
const btnBiometria = document.querySelector('#tabsNav button[data-tab="biometria"]');
assert(btnProducao.classList.contains('active'), 'Dashboard (producao) começa como aba ativa');
btnBusca.click();
assert(btnBusca.classList.contains('active'), 'clicar em Buscar Clientes marca o botão como ativo');
assert(!btnProducao.classList.contains('active'), 'Dashboard perde o estado ativo ao trocar de aba');
assert(document.getElementById('panel-busca').classList.contains('active'), 'painel de busca fica visível (.active)');
assert(!document.getElementById('panel-producao').classList.contains('active'), 'painel de produção deixa de ficar visível');

// ===== 3) Clicar num rótulo de grupo não troca de aba =====
document.querySelector('#tabsNav .navGroupLabel').click();
assert(btnBusca.classList.contains('active') && document.getElementById('panel-busca').classList.contains('active'), 'clicar no rótulo de grupo não muda a aba');
btnBiometria.click();
assert(btnBiometria.classList.contains('active') && document.getElementById('panel-biometria').classList.contains('active'), 'troca para Biometria funciona');

console.log('OK:', ok, 'FAIL:', fail);
if(fail > 0) process.exit(1);
`;

dom.window.eval(jsCode + testScript);
