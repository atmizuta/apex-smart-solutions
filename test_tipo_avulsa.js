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
window.alert = (m) => { throw new Error('ALERT: ' + m); };
window.confirm = () => true;
window.jspdf = { jsPDF: function(){ return {}; } };

const testScript = `
const assert = (c,m) => { if(!c) throw new Error('FALHOU: '+m); console.log('OK:', m); };
currentUser = { id:'u1', nome:'T', username:'t', role:'consultor' };

// --- estado inicial: select "Novo" (primeira opção) e campo operadora escondido ---
const avTipoEl = document.getElementById('avTipo');
assert(avTipoEl.value === 'novo', 'opcao padrao do select e Novo');
assert(document.getElementById('avOperadoraWrap').style.display === 'none', 'campo operadora comeca escondido (Novo)');
assert(avTipoEl.options.length === 5, 'combobox tem 5 opcoes (25/09/2026: + renovacao + incremento)');
assert(Array.from(avTipoEl.options).map(o=>o.value).join(',') === 'novo,portabilidade,titularidade,renovacao,incremento', 'ordem das opcoes: novo, portabilidade, titularidade, renovacao, incremento');

// --- trocar pra Portabilidade -> mostra operadora ---
avTipoEl.value = 'portabilidade';
avTipoEl.dispatchEvent(new window.Event('change'));
assert(document.getElementById('avOperadoraWrap').style.display === '', 'campo operadora aparece em Portabilidade');

// --- trocar pra Titularidade -> esconde operadora de novo ---
avTipoEl.value = 'titularidade';
avTipoEl.dispatchEvent(new window.Event('change'));
assert(document.getElementById('avOperadoraWrap').style.display === 'none', 'campo operadora escondido em Titularidade');

// --- submeter como "Novo" sem preencher operadora -> NAO deve dar erro de operadora ---
avTipoEl.value = 'novo';
avTipoEl.dispatchEvent(new window.Event('change'));
document.getElementById('avNome').value = 'CLIENTE NOVO LTDA';
document.getElementById('avDdd').value = '11';
document.getElementById('avLinhasAtuais').value = '2';
document.getElementById('avValor').value = '';
document.getElementById('avOperadora').value = '';
document.getElementById('btnGerarPropostaAvulsa').click();
assert(document.getElementById('avulsaErr').style.display !== 'block', 'tipo Novo nao exige operadora pra gerar proposta');
assert(proposalState && proposalState.tipoAvulsa === 'novo', 'proposalState.tipoAvulsa = novo');
assert(proposalState.operadoraAtual === '', 'operadoraAtual vazia no tipo Novo');
assert(proposalState.linhaGrupos[0].tipo === 'aquisicao', 'grupo inicial do tipo Novo comeca como aquisicao');
document.getElementById('proposalClose').click();

// --- submeter como "Portabilidade" SEM operadora -> deve dar erro ---
avTipoEl.value = 'portabilidade';
avTipoEl.dispatchEvent(new window.Event('change'));
document.getElementById('avOperadora').value = '';
document.getElementById('btnGerarPropostaAvulsa').click();
assert(document.getElementById('avulsaErr').style.display === 'block', 'tipo Portabilidade sem operadora mostra erro');

// --- agora preenchendo a operadora -> deve funcionar e abrir a proposta ---
document.getElementById('avOperadora').value = 'Vivo';
document.getElementById('btnGerarPropostaAvulsa').click();
assert(document.getElementById('avulsaErr').style.display !== 'block', 'tipo Portabilidade com operadora preenchida funciona');
assert(proposalState.tipoAvulsa === 'portabilidade', 'proposalState.tipoAvulsa = portabilidade');
assert(proposalState.operadoraAtual === 'Vivo', 'operadoraAtual = Vivo');
assert(proposalState.linhaGrupos[0].tipo === 'portabilidade', 'grupo inicial do tipo Portabilidade comeca como portabilidade');
document.getElementById('proposalClose').click();

// --- Titularidade continua sem pedir operadora e forcando "Claro (Pessoa Física)" ---
avTipoEl.value = 'titularidade';
avTipoEl.dispatchEvent(new window.Event('change'));
document.getElementById('btnGerarPropostaAvulsa').click();
assert(document.getElementById('avulsaErr').style.display !== 'block', 'tipo Titularidade nao exige operadora');
assert(proposalState.operadoraAtual === 'Claro (Pessoa Física)', 'operadoraAtual fixa em Titularidade');
document.getElementById('proposalClose').click();

// ===== 25/09/2026 (pedido do usuário: "em proposta avulsa em tipo de proposta colocar tambem as
// opcoes ... renovação e incremento") =====

// --- Renovação: nao pede operadora, fixa 'Claro', abre com a secao de RENOVACAO (renewGrupos), nao
// linhaGrupos, e a secao comeca LIGADA (atalho de abertura) ---
avTipoEl.value = 'renovacao';
avTipoEl.dispatchEvent(new window.Event('change'));
assert(document.getElementById('avOperadoraWrap').style.display === 'none', 'campo operadora escondido em Renovacao');
document.getElementById('avNome').value = 'CLIENTE RENOVACAO LTDA';
document.getElementById('avDdd').value = '11';
document.getElementById('avLinhasAtuais').value = '4';
document.getElementById('avValor').value = '800';
document.getElementById('btnGerarPropostaAvulsa').click();
assert(document.getElementById('avulsaErr').style.display !== 'block', 'tipo Renovacao nao exige operadora pra gerar proposta');
assert(proposalState.tipoAvulsa === 'renovacao', 'proposalState.tipoAvulsa = renovacao');
assert(proposalState.operadoraAtual === 'Claro', 'operadoraAtual fixa em Claro na Renovacao');
assert(proposalState.incluirRenovacao === true, 'secao de linha base comeca LIGADA na Renovacao (atalho de abertura)');
assert(proposalState.incluirIncremento === false, 'incremento comeca desligado na Renovacao');
assert(Array.isArray(proposalState.renewGrupos) && proposalState.renewGrupos.length > 0, 'renewGrupos populado na avulsa tipo Renovacao (reaproveita fluxo do cliente-da-base)');
assert(document.querySelector('.propRenovGrupoOferta') !== null, 'select .propRenovGrupoOferta aparece (secao de renovacao real, nao linha nova)');
assert(document.querySelector('.propGrupoOferta') === null, 'select .propGrupoOferta (linha nova/portabilidade) NAO aparece na Renovacao');
assert(document.querySelector('.secTitle').textContent === 'Renovação das linhas existentes', 'titulo da secao vira "Renovação das linhas existentes" na avulsa tipo Renovacao');
document.getElementById('proposalClose').click();

// --- Incremento: nao pede operadora, fixa 'Claro', abre com a secao de linha base FECHADA e a de
// Incremento LIGADA (atalho de abertura) ---
avTipoEl.value = 'incremento';
avTipoEl.dispatchEvent(new window.Event('change'));
assert(document.getElementById('avOperadoraWrap').style.display === 'none', 'campo operadora escondido em Incremento');
document.getElementById('btnGerarPropostaAvulsa').click();
assert(document.getElementById('avulsaErr').style.display !== 'block', 'tipo Incremento nao exige operadora pra gerar proposta');
assert(proposalState.tipoAvulsa === 'incremento', 'proposalState.tipoAvulsa = incremento');
assert(proposalState.operadoraAtual === 'Claro', 'operadoraAtual fixa em Claro no Incremento');
assert(proposalState.incluirRenovacao === false, 'secao de linha base comeca DESLIGADA no Incremento (atalho de abertura)');
assert(proposalState.incluirIncremento === true, 'incremento comeca LIGADO no Incremento (atalho de abertura)');
assert(document.querySelector('.propIncrementoOferta') !== null, 'select de oferta de incremento ja aparece (secao aberta por padrao)');
document.getElementById('proposalClose').click();

console.log('TODOS OS TESTES DE TIPO DE PROPOSTA AVULSA PASSARAM');
`;
window.eval(jsCode + testScript);
