// test_proposta_timbrada.js — proposta timbrada editável (15/10/2026, §84).
// Requer: npm i jsdom docx
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} }, from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }), functions: { invoke: async () => ({ data: {}, error: null }) } }) };
window.docx = require('docx'); window.alert = () => {}; window.confirm = () => true; window.jspdf = { jsPDF: function(){ return {}; } };
let printed = 0; window.print = () => { printed++; };
const t = `
let ok = 0, fail = 0;
function assert(c, m){ if(c) ok++; else { fail++; console.log('FALHOU:', m); } }
currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'c', role: 'consultor' };
openProposal({ razao_social: 'EMPRESA TIMBRADA LTDA', cnpj: '12.345.678/0001-90', cidade: 'SP', ddd: '11', linhas_atuais: 1, valor_contrato: 10, arpu: 1, cep_cabeado: '' }, { avulsa: true, tipoAvulsa: 'novo' });
assert(document.getElementById('btnPropostaTimbrada') !== null, 'botao Proposta timbrada existe na tela de proposta');
document.getElementById('propModoManual').click();
proposalState.clienteManual = { contato: 'Maria Silva', telefone: '(11) 90000-0000', email: 'm@x.com', endereco: 'Rua A, 1' };
proposalState.itensManuais = [
  { categoria: 'Nova linha', descricao: 'Plano 30GB', valorUnit: 44.99, qtd: 10, cobranca: 'mensal', parcelas: 12 },
  { categoria: 'Aparelho', descricao: 'Smartphone X', valorUnit: 200, qtd: 2, cobranca: 'parcelado', parcelas: 10 },
];
// guarda do modo manual vazio nao bloqueia (ha itens)
document.getElementById('btnPropostaTimbrada').click();
assert(document.getElementById('timbradoOverlay') !== null, 'overlay da proposta timbrada abre');
const corpo = document.getElementById('timbradoCorpo');
assert(corpo && corpo.getAttribute('contenteditable') === 'true', 'corpo da proposta e editavel');
assert(document.querySelector('.tl-head').getAttribute('contenteditable') === 'false' && document.querySelector('.tl-foot').getAttribute('contenteditable') === 'false', 'timbre (cabecalho/rodape) travado');
assert(document.querySelector('.tl-claro').src.indexOf('data:image/png;base64,') === 0, 'logo Claro (esfera) embutida no cabecalho');
assert(corpo.textContent.indexOf('EMPRESA TIMBRADA LTDA') >= 0 && corpo.textContent.indexOf('Maria Silva') >= 0, 'dados do cliente preenchidos');
assert(corpo.querySelectorAll('table.tl-table').length === 2, 'duas tabelas: mensal e unico');
assert(corpo.querySelector('[data-bind="mensal"]').textContent === fmtBRL(449.9), 'cartao mensal = ' + corpo.querySelector('[data-bind="mensal"]').textContent);
assert(corpo.querySelector('[data-bind="unico"]').textContent === fmtBRL(4000), 'cartao unico = 4000');
assert(timbradoParseBRL('R$ 1.234,56') === 1234.56 && timbradoParseBRL('') === 0 && timbradoParseBRL('abc') === 0, 'parse de valor em reais');
// editar valor + recalcular
const tdVal = corpo.querySelector('table[data-total="mensal"] tbody td.tl-val'); tdVal.textContent = 'R$ 500,00';
timbradoRecalcular();
assert(corpo.querySelector('table[data-total="mensal"] .tl-total-val').textContent === fmtBRL(500) && corpo.querySelector('[data-bind="mensal"]').textContent === fmtBRL(500), 'recalcular soma a coluna de valores e atualiza o cartao');
// adicionar / remover linha
timbradoAdicionarLinha();
assert(corpo.querySelectorAll('table[data-total="mensal"] tbody tr').length === 2, 'adicionar linha');
const ultima = corpo.querySelectorAll('table[data-total="mensal"] tbody tr')[1];
ultima.children[2].textContent = 'R$ 100,00'; timbradoRecalcular();
assert(corpo.querySelector('[data-bind="mensal"]').textContent === fmtBRL(600), 'total considera a linha nova');
const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(ultima.children[0]); sel.removeAllRanges(); sel.addRange(r);
timbradoRemoverLinha();
assert(corpo.querySelectorAll('table[data-total="mensal"] tbody tr').length === 1, 'remover linha selecionada');
// xss: texto do cliente nao vira HTML
proposalState.client.razao_social = '<img src=x onerror=window.__x=1>';
timbradoFechar(); abrirPropostaTimbrada();
assert(document.getElementById('timbradoCorpo').querySelector('img') === null && !window.__x, 'nome do cliente escapado (sem HTML injetado)');
// imprimir
document.querySelector('[data-tl="print"]').click();

// word
const blobPromise = montarDocxTimbrado(document.getElementById('timbradoCorpo'));
window.__blobPromise = blobPromise;
timbradoFechar();
assert(document.getElementById('timbradoOverlay') === null, 'fechar remove o overlay');
window.__res = () => ({ ok, fail });
`;
(async () => {
  try {
    window.eval(jsCode + '\n' + t);
    const blob = await window.__blobPromise;
    let { ok, fail } = window.__res();
    if (blob && (blob.size || blob.length) > 3000) ok++; else { fail++; console.log('FALHOU: docx timbrado nao gerado'); }
    if (printed === 1) ok++; else { fail++; console.log('FALHOU: window.print nao chamado (' + printed + ')'); }
    console.log('RESULTADO: ' + ok + ' passaram, ' + fail + ' falharam');
    if (fail) process.exitCode = 1;
  } catch (e) { console.error('ERRO NO TESTE:', e.message, e.stack); process.exitCode = 1; }
})();
