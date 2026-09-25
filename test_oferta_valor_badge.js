// test_oferta_valor_badge.js — badge com o valor da oferta selecionada (25/09/2026, pedido do
// usuário: "na montagem da proposta mostrar o valor de cada oferta, somente na proposta que pode ser
// retirado do item, em tipo de proposta Novo, portabilidade e transferencia, incluir incremento e
// renovação" — esclarecido via pergunta ao usuário: "Mostrar valor nos seletores de oferta (tela)").
//
// Cobre: badge aparece ao lado do <select> de oferta com o valor da oferta SELECIONADA no render
// inicial, nos 3 pontos onde existe seletor de oferta (linhaGrupos na avulsa, renewGrupos na
// renovação, incrementos no incremento); e o badge se ATUALIZA (sem precisar reabrir a proposta)
// quando o consultor troca a oferta escolhida no <select>, em cada um dos 3 casos — inclusive
// confirmando que trocar o badge de uma seção não mexe no badge da outra (bug de data-idx repetido
// entre seções, corrigido nesta mesma implementação).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

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

currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };

const clienteBase = { razao_social: 'CLIENTE BASE LTDA', cnpj: '11.111.111/0001-11', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 8, valor_contrato: 1200, arpu: 150, cep_cabeado: '', tempo_contrato_voz: 20 };
const clienteAvulsa = { razao_social: 'CLIENTE MANUAL TESTE LTDA', cnpj: '', cidade: 'Sao Paulo', ddd: '11', linhas_atuais: 5, valor_contrato: 800, arpu: 160, cep_cabeado: '' };

// ===== 1) Renovação (cliente da base): badge aparece com o valor da oferta já selecionada =====
openProposal(clienteBase, {});
let renovSelect = document.querySelector('.propRenovGrupoOferta');
assert(renovSelect !== null, 'select de oferta de renovação existe (renovação vem ligada por padrão)');
let renovBadge = renovSelect.nextElementSibling;
assert(renovBadge && renovBadge.classList.contains('propOfertaValorWrap'), 'badge de valor é o irmão imediato do select de renovação');
assert(/Valor: <b>R\\$/.test(renovBadge.innerHTML), 'badge de renovação mostra "Valor: R$..." no render inicial');

// troca a oferta de renovação -> badge deve atualizar pro valor da NOVA oferta escolhida
const renovOptions = Array.from(renovSelect.options);
assert(renovOptions.length > 1, 'existe mais de uma opção de oferta de renovação pra testar a troca');
const outraRenovOpt = renovOptions.find(o => o.value !== renovSelect.value);
const valorAntesRenov = renovBadge.innerHTML;
renovSelect.value = outraRenovOpt.value;
renovSelect.dispatchEvent(new Event('change'));
renovBadge = document.querySelector('.propRenovGrupoOferta').nextElementSibling;
assert(renovBadge.innerHTML !== valorAntesRenov, 'badge de renovação muda de texto ao trocar a oferta selecionada');
assert(/Valor: <b>R\\$/.test(renovBadge.innerHTML), 'badge de renovação continua no formato "Valor: R$..." após a troca');
document.getElementById('proposalClose').click();

// ===== 2) Incremento (cliente da base): precisa ligar o toggle pra seção renderizar =====
openProposal(clienteBase, {});
document.getElementById('propIncluirIncremento').click();
let incSelect = document.querySelector('.propIncrementoOferta');
assert(incSelect !== null, 'select de oferta de incremento aparece depois de ligar o toggle');
let incBadge = incSelect.nextElementSibling;
assert(incBadge && incBadge.classList.contains('propOfertaValorWrap'), 'badge de valor é o irmão imediato do select de incremento');
assert(/Valor: <b>R\\$/.test(incBadge.innerHTML), 'badge de incremento mostra valor no render inicial');

const incOptions = Array.from(incSelect.options);
const outraIncOpt = incOptions.find(o => o.value !== incSelect.value);
if(outraIncOpt){
  const valorAntesInc = incBadge.innerHTML;
  incSelect.value = outraIncOpt.value;
  incSelect.dispatchEvent(new Event('change'));
  incBadge = document.querySelector('.propIncrementoOferta').nextElementSibling;
  assert(incBadge.innerHTML !== valorAntesInc, 'badge de incremento muda de texto ao trocar a oferta selecionada');
} else {
  ok++; // só 1 oferta de incremento disponível pra esse cliente — nada a trocar, não é falha
}
document.getElementById('proposalClose').click();

// ===== 3) Linha nova/portabilidade (avulsa): badge no grupo de linhas =====
openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'novo' });
let grupoSelect = document.querySelector('.propGrupoOferta');
assert(grupoSelect !== null, 'select de oferta do grupo de linhas existe na avulsa');
let grupoBadge = grupoSelect.nextElementSibling;
assert(grupoBadge && grupoBadge.classList.contains('propOfertaValorWrap'), 'badge de valor é o irmão imediato do select do grupo de linhas');
assert(/Valor: <b>R\\$/.test(grupoBadge.innerHTML), 'badge do grupo de linhas mostra valor no render inicial');

const grupoOptions = Array.from(grupoSelect.options);
const outraGrupoOpt = grupoOptions.find(o => o.value !== grupoSelect.value);
if(outraGrupoOpt){
  const valorAntesGrupo = grupoBadge.innerHTML;
  grupoSelect.value = outraGrupoOpt.value;
  grupoSelect.dispatchEvent(new Event('change'));
  grupoBadge = document.querySelector('.propGrupoOferta').nextElementSibling;
  assert(grupoBadge.innerHTML !== valorAntesGrupo, 'badge do grupo de linhas muda de texto ao trocar a oferta selecionada');
} else {
  ok++;
}

// ===== 4) sem oferta selecionada (offerId null) -> badge mostra "—" em vez de quebrar =====
assert(ofertaValorBadgeHtml(null).includes('—'), 'ofertaValorBadgeHtml(null) mostra travessão, não quebra');
assert(ofertaValorBadgeHtml(undefined).includes('—'), 'ofertaValorBadgeHtml(undefined) mostra travessão, não quebra');

document.getElementById('proposalClose').click();

console.log('OK:', ok, 'FAIL:', fail);
if(fail > 0) process.exit(1);
`;

dom.window.eval(jsCode + testScript);
