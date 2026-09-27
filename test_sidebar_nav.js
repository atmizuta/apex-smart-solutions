// test_sidebar_nav.js — menu lateral (27/09/2026, pedido do usuário: "havia uma versao do painel de
// dash em que as abas estavam em um menu na esquerda, efetuar a alteração deixando mais amigavel e
// usual, usar a melhores praticas de mercado"). Troca do nav horizontal (topo) por um menu vertical
// fixo à esquerda (nav.sidebar), com grupos (Visão geral/Vendas/Ferramentas/Administração), estado
// ativo e comportamento de gaveta (drawer) em telas estreitas via hamburguer (#btnNavToggle) + scrim.
//
// Cobre: a troca de aba continua funcionando (mesma lógica data-tab/.panel.active, só trocou o
// contêiner); classe "active" migra corretamente entre os botões da nav; grupos (navGroupLabel)
// presentes e não interferem no clique; abrir/fechar a gaveta mobile via hamburguer, scrim, Esc e
// automaticamente ao escolher uma aba; estrutura do appShell/sidebar/scrim presente no HTML.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const document = window.document;

window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {} },
  from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = () => {};
window.confirm = () => true;
window.jspdf = { jsPDF: function(){ return {}; } };

const testScript = `
let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// ===== 1) Estrutura básica: appShell / sidebar / scrim / hamburguer presentes =====
assert(document.querySelector('.appShell') !== null, 'contêiner .appShell existe, envolvendo nav+main');
const sidebar = document.getElementById('tabsNav');
assert(sidebar !== null, 'nav (id=tabsNav) existe');
assert(sidebar.classList.contains('sidebar'), 'nav tem a classe "sidebar" (não mais "tabs")');
assert(document.getElementById('sidebarScrim') !== null, 'scrim (#sidebarScrim) existe');
assert(document.getElementById('btnNavToggle') !== null, 'botão hamburguer (#btnNavToggle) existe');
assert(document.querySelectorAll('.navGroupLabel').length >= 4, 'nav tem pelo menos 4 grupos (Visão geral/Vendas/Ferramentas/Administração)');

// ===== 2) Troca de aba continua funcionando (mesma lógica data-tab/.panel.active) =====
currentUser = { id: 'u1', nome: 'Teste', username: 'teste', role: 'admin' };
const btnBusca = document.querySelector('#tabsNav button[data-tab="busca"]');
const btnProducao = document.querySelector('#tabsNav button[data-tab="producao"]');
assert(btnProducao.classList.contains('active'), 'Dashboard (producao) começa como aba ativa');
btnBusca.click();
assert(btnBusca.classList.contains('active'), 'clicar em Buscar Clientes marca o botão como ativo');
assert(!btnProducao.classList.contains('active'), 'Dashboard perde o estado ativo ao trocar de aba');
assert(document.getElementById('panel-busca').classList.contains('active'), 'painel de busca fica visível (.active)');
assert(!document.getElementById('panel-producao').classList.contains('active'), 'painel de produção deixa de ficar visível');

// ===== 3) Gaveta mobile: abrir/fechar via hamburguer =====
const nav = document.getElementById('tabsNav');
const scrim = document.getElementById('sidebarScrim');
const toggle = document.getElementById('btnNavToggle');
assert(!nav.classList.contains('open'), 'sidebar começa fechada (sem classe "open")');
toggle.click();
assert(nav.classList.contains('open'), 'clicar no hamburguer abre a sidebar (classe "open")');
assert(scrim.classList.contains('open'), 'scrim também fica visível quando a sidebar abre');
assert(toggle.getAttribute('aria-expanded') === 'true', 'aria-expanded vira "true" com a sidebar aberta');
toggle.click();
assert(!nav.classList.contains('open'), 'clicar de novo no hamburguer fecha a sidebar');
assert(toggle.getAttribute('aria-expanded') === 'false', 'aria-expanded volta pra "false" ao fechar');

// ===== 4) Fecha ao clicar no scrim =====
toggle.click();
assert(nav.classList.contains('open'), 'sidebar aberta de novo, pra testar o fechamento pelo scrim');
scrim.click();
assert(!nav.classList.contains('open'), 'clicar no scrim fecha a sidebar');

// ===== 5) Fecha com Esc =====
toggle.click();
assert(nav.classList.contains('open'), 'sidebar aberta de novo, pra testar o fechamento por Esc');
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
assert(!nav.classList.contains('open'), 'pressionar Esc fecha a sidebar');

// ===== 6) Escolher uma aba fecha a gaveta automaticamente (útil no mobile) =====
// (usa Biometria, não Dashboard — a aba "producao" dispara loadProducaoDashboard(), que faz chamadas
// assíncronas ao Supabase incompatíveis com o mock mínimo deste teste; a lógica de fechar a gaveta é
// a mesma pra qualquer aba, então testar com uma aba "leve" já cobre o comportamento.)
const btnBiometria = document.querySelector('#tabsNav button[data-tab="biometria"]');
toggle.click();
assert(nav.classList.contains('open'), 'sidebar aberta de novo, pra testar o fechamento ao trocar de aba');
btnBiometria.click();
assert(!nav.classList.contains('open'), 'clicar numa aba fecha a sidebar automaticamente');
assert(btnBiometria.classList.contains('active'), 'a troca de aba em si continua funcionando após reabrir a sidebar');

console.log('OK:', ok, 'FAIL:', fail);
if(fail > 0) process.exit(1);
`;

dom.window.eval(jsCode + testScript);
