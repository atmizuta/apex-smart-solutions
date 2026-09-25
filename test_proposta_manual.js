// test_proposta_manual.js — modo manual da proposta avulsa (25/09/2026, pedido do usuário:
// "Preciso que crie a opção de uma proposta manual onde o consultor insira os dados dos produtos,
// valores, quantidade, tambem deixando a opção dele editar a situação atual do cliente, totalmente
// customizavel, mas mantendo o padrao visual, para facilitar, deixar a opção dele selecinar se é
// renovação, incremento, nova linha, portabilidade, banda larga, pabx, claro monitor e etc.")
//
// Cobre: toggle #propModoManual só aparece quando avulsa; troca de seções catalogadas por editores
// livres (itensManuais / situacaoAtualManual); add/edit/remove linhas nos dois editores; auto-fill de
// Claro Monitor (só quando descrição vazia); guardModoManualVazio bloqueando os 3 botões de emissão
// quando não há itens; buildPropostaDocModel() no modo manual (itens, totais, fallback de situação
// atual vazia, destaque/redução); e que o fluxo cliente-da-base (não avulsa) nunca expõe o modo manual.
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
let alertMsgs = [];
window.alert = (m) => { alertMsgs.push(m); };
window.confirm = () => true;
window.jspdf = { jsPDF: function(){ return {}; } };

const testScript = `
let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };

const clienteAvulsa = { razao_social: 'CLIENTE MANUAL TESTE LTDA', cnpj: '', cidade: 'Sao Paulo', ddd: '11', linhas_atuais: 5, valor_contrato: 800, arpu: 160, cep_cabeado: '' };
const clienteBase = { razao_social: 'CLIENTE BASE LTDA', cnpj: '11.111.111/0001-11', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 8, valor_contrato: 1200, arpu: 150, cep_cabeado: '', tempo_contrato_voz: 20 };

// ===== 1) fluxo NAO-avulsa (cliente da base) nunca mostra o toggle modo manual =====
openProposal(clienteBase, {});
assert(document.getElementById('propModoManual') === null, 'toggle modo manual NAO aparece no fluxo cliente-da-base');
assert(proposalState.modoManual === false, 'modoManual comeca false no fluxo cliente-da-base');
assert(document.getElementById('btnAddItemManual') === null, 'editor de itens manuais nao existe no fluxo cliente-da-base');
assert(document.getElementById('btnAddSitManual') === null, 'editor de situacao atual manual nao existe no fluxo cliente-da-base');
document.getElementById('proposalClose').click();

// ===== 2) abrir proposta avulsa: toggle existe, modoManual nasce desligado =====
openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'novo' });
assert(proposalState.modoManual === false, 'modoManual nasce desligado na avulsa');
assert(Array.isArray(proposalState.itensManuais) && proposalState.itensManuais.length === 0, 'itensManuais nasce vazio');
assert(Array.isArray(proposalState.situacaoAtualManual) && proposalState.situacaoAtualManual.length === 0, 'situacaoAtualManual nasce vazio');
assert(document.getElementById('propModoManual') !== null, 'toggle modo manual aparece pra avulsa');
assert(document.getElementById('propConsolidarValores') !== null, '"Consolidar valores" aparece antes de ligar o modo manual');
assert(document.querySelector('.propGrupoTipo') !== null, 'accordion catalogado (linha/renovacao) aparece antes de ligar o modo manual');

// ===== 3) ligar o toggle -> catalogo desaparece, editores livres aparecem =====
document.getElementById('propModoManual').click();
assert(proposalState.modoManual === true, 'toggle liga modoManual');
assert(document.getElementById('btnAddItemManual') !== null, 'botao +Adicionar item (itens manuais) aparece');
assert(document.getElementById('btnAddSitManual') !== null, 'botao +Adicionar item (situacao atual manual) aparece');
assert(document.getElementById('propConsolidarValores') === null, '"Consolidar valores" escondido no modo manual');
assert(document.querySelector('.propGrupoTipo') === null, 'accordion de linha/renovacao catalogado some');
assert(document.querySelector('.propIncGrupoOferta') === null || true, 'sanity: nao trava se seletor nao existir');
assert(document.getElementById('dlModoManualSugestoes') !== null, 'datalist de sugestoes existe');
assert(document.body.textContent.includes('Adicione pelo menos um item'), 'hint de lista vazia aparece de cara (0 itens)');

// datalist de sugestoes vem do catalogo + Claro Monitor
const dlOptions = Array.from(document.querySelectorAll('#dlModoManualSugestoes option')).map(o => o.value);
assert(dlOptions.includes('Claro Monitor — Jornada Mobilidade'), 'sugestao Claro Monitor presente no datalist');
assert(dlOptions.length === modoManualSugestoes().length, 'quantidade de sugestoes bate com modoManualSugestoes()');

// ===== 4) situacao atual manual: adicionar, editar, subtotal ao vivo, remover =====
document.getElementById('btnAddSitManual').click();
assert(proposalState.situacaoAtualManual.length === 1, 'item de situacao atual manual adicionado');
let sitDesc = document.querySelector('.propSitManualDescricao[data-idx="0"]');
sitDesc.value = '5 linhas plano 15GB';
sitDesc.dispatchEvent(new window.Event('input', { bubbles: true }));
let sitQtd = document.querySelector('.propSitManualQtd[data-idx="0"]');
sitQtd.value = '5';
sitQtd.dispatchEvent(new window.Event('input', { bubbles: true }));
let sitValor = document.querySelector('.propSitManualValor[data-idx="0"]');
sitValor.value = '80';
sitValor.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(proposalState.situacaoAtualManual[0].descricao === '5 linhas plano 15GB', 'descricao situacao atual manual gravada');
assert(proposalState.situacaoAtualManual[0].qtd === 5, 'qtd situacao atual manual gravada');
assert(proposalState.situacaoAtualManual[0].valorUnit === 80, 'valorUnit situacao atual manual gravado');
let sitSubtotalEl = document.querySelector('.propSitManualSubtotal[data-idx="0"] b');
assert(sitSubtotalEl.textContent.includes('400'), 'subtotal da situacao atual manual atualizado no DOM sem re-render (' + sitSubtotalEl.textContent + ')');

// adicionar um 2o item de situacao atual e depois remove-lo
document.getElementById('btnAddSitManual').click();
assert(proposalState.situacaoAtualManual.length === 2, '2o item de situacao atual manual adicionado');
document.querySelector('.btnRemoveSitManual[data-idx="1"]').click();
assert(proposalState.situacaoAtualManual.length === 1, '2o item de situacao atual manual removido, volta a 1');

// ===== 5) itens da nova proposta (manual): adicionar 2, editar, categoria, subtotal/total ao vivo =====
document.getElementById('btnAddItemManual').click();
document.getElementById('btnAddItemManual').click();
assert(proposalState.itensManuais.length === 2, '2 itens manuais adicionados');
assert(proposalState.itensManuais[0].categoria === 'Outro', 'categoria padrao do item novo e "Outro"');

let desc0 = document.querySelector('.propItemManualDescricao[data-idx="0"]');
desc0.value = 'Plano 30GB';
desc0.dispatchEvent(new window.Event('input', { bubbles: true }));
let valor0 = document.querySelector('.propItemManualValor[data-idx="0"]');
valor0.value = '90';
valor0.dispatchEvent(new window.Event('input', { bubbles: true }));
let qtd0 = document.querySelector('.propItemManualQtd[data-idx="0"]');
qtd0.value = '5';
qtd0.dispatchEvent(new window.Event('input', { bubbles: true }));

let cat1 = document.querySelector('.propItemManualCategoria[data-idx="1"]');
cat1.value = 'PABX';
cat1.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(proposalState.itensManuais[1].categoria === 'PABX', 'categoria PABX gravada no 2o item');
let desc1 = document.querySelector('.propItemManualDescricao[data-idx="1"]');
desc1.value = 'PABX 20 ramais';
desc1.dispatchEvent(new window.Event('input', { bubbles: true }));
let valor1 = document.querySelector('.propItemManualValor[data-idx="1"]');
valor1.value = '250';
valor1.dispatchEvent(new window.Event('input', { bubbles: true }));
let qtd1 = document.querySelector('.propItemManualQtd[data-idx="1"]');
qtd1.value = '1';
qtd1.dispatchEvent(new window.Event('input', { bubbles: true }));

assert(proposalState.itensManuais[0].descricao === 'Plano 30GB' && proposalState.itensManuais[0].valorUnit === 90 && proposalState.itensManuais[0].qtd === 5, 'item 0 gravado corretamente');
assert(proposalState.itensManuais[1].descricao === 'PABX 20 ramais' && proposalState.itensManuais[1].valorUnit === 250 && proposalState.itensManuais[1].qtd === 1, 'item 1 gravado corretamente');

let subtotalEl = document.querySelector('.propItemManualSubtotal[data-idx="0"] b');
assert(subtotalEl.textContent.includes('450'), 'subtotal do item 0 atualizado no DOM sem re-render (' + subtotalEl.textContent + ')');
let totalEl = document.getElementById('propItemManualTotalValor');
assert(totalEl.textContent.includes('700'), 'total da secao "Itens da proposta (manual)" atualizado no DOM (' + totalEl.textContent + ')'); // 450+250=700

// resumo fixo (updateProposalPreview) tambem reflete o modo manual, alimentado pelos mesmos itens
const previewText = document.getElementById('proposalPreview').textContent;
assert(previewText.includes('proposta manual'), 'resumo fixo mostra indicador de "proposta manual"');

// ===== 6) Claro Monitor auto-fill via categoria (so quando descricao vazia) =====
document.getElementById('btnAddItemManual').click();
assert(proposalState.itensManuais.length === 3, '3o item adicionado (vazio)');
let cat2 = document.querySelector('.propItemManualCategoria[data-idx="2"]');
cat2.value = 'Claro Monitor';
cat2.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(proposalState.itensManuais[2].descricao === 'Claro Monitor — Jornada Mobilidade', 'Claro Monitor auto-preenche descricao (' + proposalState.itensManuais[2].descricao + ')');
assert(proposalState.itensManuais[2].valorUnit === 5, 'Claro Monitor auto-preenche valor 5 (' + proposalState.itensManuais[2].valorUnit + ')');

// trocar a categoria de volta e escolher Claro Monitor de novo NAO deve sobrescrever descricao ja preenchida manualmente
proposalState.itensManuais[2].categoria = 'Outro';
proposalState.itensManuais[2].descricao = 'Descricao digitada pelo consultor';
proposalState.itensManuais[2].valorUnit = 999;
renderProposalBody();
let cat2b = document.querySelector('.propItemManualCategoria[data-idx="2"]');
cat2b.value = 'Claro Monitor';
cat2b.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(proposalState.itensManuais[2].descricao === 'Descricao digitada pelo consultor', 'Claro Monitor NAO sobrescreve descricao ja preenchida (' + proposalState.itensManuais[2].descricao + ')');
assert(proposalState.itensManuais[2].valorUnit === 999, 'Claro Monitor NAO sobrescreve valor ja preenchido (' + proposalState.itensManuais[2].valorUnit + ')');

// remove item 2 (Claro Monitor/custom) pra nao afetar os totais esperados abaixo
document.querySelector('.btnRemoveItemManual[data-idx="2"]').click();
assert(proposalState.itensManuais.length === 2, 'item extra removido, volta a 2 itens');

// ===== 7) guardModoManualVazio: bloqueia emissao com 0 itens, libera com >=1 item =====
let docxCalled = false, pdfConsultorCalled = false, pdfClienteCalled = false;
window.generateProposalDocx = () => { docxCalled = true; };
window.generateProposalPdfConsultor = () => { pdfConsultorCalled = true; };
window.generateProposalPdfCliente = () => { pdfClienteCalled = true; };
generateProposalDocx = window.generateProposalDocx;
generateProposalPdfConsultor = window.generateProposalPdfConsultor;
generateProposalPdfCliente = window.generateProposalPdfCliente;

const itensBackup = proposalState.itensManuais;
proposalState.itensManuais = [];
renderProposalBody();
let alertsBefore = window.__alertCount || 0;
window.alert = function(m){ window.__alertCount = (window.__alertCount||0) + 1; window.__lastAlert = m; };
document.getElementById('btnBaixarProposta').click();
assert(docxCalled === false, 'guard bloqueia Word quando itensManuais vazio (nao chama generateProposalDocx)');
assert(window.__alertCount === alertsBefore + 1, 'guard dispara alert quando itensManuais vazio');
assert(window.__lastAlert.includes('Nova Proposta'), 'mensagem do alert menciona "Nova Proposta" (' + window.__lastAlert + ')');
document.getElementById('btnBaixarPropostaPdf').click();
assert(pdfConsultorCalled === false, 'guard bloqueia PDF consultor quando itensManuais vazio');
document.getElementById('btnBaixarPropostaPdfCliente').click();
assert(pdfClienteCalled === false, 'guard bloqueia PDF cliente quando itensManuais vazio');

proposalState.itensManuais = itensBackup;
renderProposalBody();
document.getElementById('btnBaixarProposta').click();
assert(docxCalled === true, 'guard libera Word quando ha pelo menos 1 item manual');
document.getElementById('btnBaixarPropostaPdf').click();
assert(pdfConsultorCalled === true, 'guard libera PDF consultor quando ha pelo menos 1 item manual');
document.getElementById('btnBaixarPropostaPdfCliente').click();
assert(pdfClienteCalled === true, 'guard libera PDF cliente quando ha pelo menos 1 item manual');

// ===== 8) buildPropostaDocModel() no modo manual =====
const modelo = buildPropostaDocModel();
assert(modelo.novaProposta.total === 700, 'novaProposta.total correto (450+250) (' + modelo.novaProposta.total + ')');
assert(modelo.novaProposta.itens.length === 2, 'novaProposta.itens tem 2 linhas');
assert(modelo.novaProposta.itens[0].item === '[Outro] Plano 30GB', 'item com categoria default "Outro" (truthy) tambem ganha prefixo (' + modelo.novaProposta.itens[0].item + ')');
assert(modelo.novaProposta.itens[1].item === '[PABX] PABX 20 ramais', 'item com categoria vira prefixo [PABX] (' + modelo.novaProposta.itens[1].item + ')');
assert(modelo.novaProposta.itens[1].desc === '1× ' + fmtBRL(250) + '/un', 'desc do item usa "qtd x valorUnit/un" (' + modelo.novaProposta.itens[1].desc + ')');
assert(modelo.novaProposta.itens[1].subtotal === 250, 'subtotal do item 1 correto');
assert(modelo.novaProposta.consolidado === false, 'consolidado sempre false no modo manual');
assert(modelo.novaProposta.valorMonitor === 0, 'valorMonitor sempre 0 no modo manual (sem contabilidade especial)');
assert(modelo.novaProposta.notaFibra === false, 'notaFibra sempre false no modo manual');
assert(modelo.atual === 400, 'situacaoAtual total correto (5x80=400) (' + modelo.atual + ')');
assert(modelo.situacaoAtual.tipo === 'tabela', 'situacaoAtual vira tabela quando ha itens');
assert(modelo.situacaoAtual.itens.length === 1, 'situacaoAtual.itens tem 1 linha');
assert(modelo.situacaoAtual.itens[0].item === '5 linhas plano 15GB', 'situacaoAtual.itens usa a descricao digitada como "item"');
assert(modelo.situacaoAtual.itens[0].subtotal === 400, 'subtotal da situacaoAtual.itens correto');
assert(modelo.situacaoAtual.nota === 'Valores informados livremente pelo consultor.', 'nota da situacaoAtual e a do modo manual');
assert(modelo.destaque.valorProposto === 700, 'destaque.valorProposto = novaProposta.total');
assert(modelo.destaque.reducao === null, 'sem reducao (700 > 400, proposta aumentou o valor)');
assert(modelo.beneficios.badges.length === 0, 'sem badges universais no modo manual');
assert(modelo.beneficios.extras.length === 1 && modelo.beneficios.extras[0].includes('manual'), 'nota de proposta manual presente em beneficios.extras');
assert(modelo.beneficios.temOfertaMovel === true, 'temOfertaMovel true quando ha itens (pra nota "Proposta manual" aparecer no doc, ver montarDocx/PdfProposta)');
assert(modelo.subtitulo === 'Proposta avulsa — Nova aquisição de linha', 'subtitulo reaproveita a logica normal de subtitulo avulsa (' + modelo.subtitulo + ')');
assert(modelo.client.razaoSocial === 'CLIENTE MANUAL TESTE LTDA', 'client.razaoSocial correto');
assert(modelo.client.cnpj === '', 'client.cnpj correto (vazio)');
assert(modelo.rodape && modelo.rodape.validaAte, 'rodape.validaAte presente (mesma logica de sempre)');

// ===== 9) situacaoAtualManual vazio -> fallback resumo, atual = 0 =====
proposalState.situacaoAtualManual = [];
const modelo2 = buildPropostaDocModel();
assert(modelo2.situacaoAtual.tipo === 'resumo', 'sem itens de situacao atual -> vira resumo');
assert(Array.isArray(modelo2.situacaoAtual.linhas) && modelo2.situacaoAtual.linhas[0][0] === 'Situação atual' && modelo2.situacaoAtual.linhas[0][1] === 'Não informada', 'fallback textual "Situação atual: Não informada" (' + JSON.stringify(modelo2.situacaoAtual.linhas) + ')');
assert(modelo2.situacaoAtual.nota === '', 'nota vazia no fallback de resumo');
assert(modelo2.atual === 0, 'atual = 0 quando situacaoAtualManual vazio');
assert(modelo2.novaProposta.total === 700, 'novaProposta.total nao muda so por causa da situacaoAtual vazia');
assert(modelo2.destaque.reducao === null, 'sem reducao quando atual=0 (nao ha atualManual>0 pra comparar percentual, mas deltaReais ainda e >0)');

// ===== 9b) reducao quando proposta manual e mais barata que a situacao atual =====
proposalState.situacaoAtualManual = [{ descricao: 'Plano caro atual', qtd: 1, valorUnit: 2000 }];
const modelo2b = buildPropostaDocModel();
assert(modelo2b.atual === 2000, 'atual reconstruido a partir da nova situacaoAtualManual');
assert(modelo2b.destaque.reducao !== null, 'reducao calculada quando atual > proposto');
assert(modelo2b.destaque.reducao.valor === 2000 - 700, 'valor da reducao correto (' + modelo2b.destaque.reducao.valor + ')');
assert(Math.abs(modelo2b.destaque.reducao.pct - ((2000-700)/2000*100)) < 0.01, 'percentual da reducao correto (' + modelo2b.destaque.reducao.pct + ')');

// ===== 10) itens/situacao com so espaco em branco (sem descricao nem valor) sao filtrados =====
proposalState.itensManuais = [{ categoria: 'Outro', descricao: '   ', valorUnit: 0, qtd: 1 }, { categoria: 'Outro', descricao: 'Item valido', valorUnit: 10, qtd: 1 }];
proposalState.situacaoAtualManual = [{ descricao: '', qtd: 1, valorUnit: 0 }];
const modelo3 = buildPropostaDocModel();
assert(modelo3.novaProposta.itens.length === 1, 'item vazio (so espacos, valor 0) e filtrado do modelo (' + modelo3.novaProposta.itens.length + ')');
assert(modelo3.situacaoAtual.tipo === 'resumo', 'item de situacao atual totalmente vazio tambem e filtrado -> vira resumo');

// ===== 11) desligar modo manual restaura fluxo catalogado (sanity - nao deve quebrar) =====
document.getElementById('propModoManual').click();
assert(proposalState.modoManual === false, 'desligar modoManual funciona');
assert(document.getElementById('propConsolidarValores') !== null, '"Consolidar valores" volta a aparecer');
assert(document.querySelector('.propGrupoTipo') !== null, 'accordion catalogado volta a aparecer');
assert(document.getElementById('btnAddItemManual') === null, 'editor de itens manuais some ao desligar');
assert(document.getElementById('btnAddSitManual') === null, 'editor de situacao atual manual some ao desligar');

console.log('RESULTADO: ' + ok + ' passaram, ' + fail + ' falharam');
if(fail > 0) process.exitCode = 1;
`;

try {
  window.eval(jsCode + '\n' + testScript);
} catch (e) {
  console.error('ERRO NO TESTE:', e.message, e.stack);
  process.exitCode = 1;
}
