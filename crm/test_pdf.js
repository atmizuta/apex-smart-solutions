// test_pdf.js (23/09/2026): generateProposalPDF() foi removida — a proposta agora é gerada como
// DOCX a partir de buildPropostaDocModel() (dado puro, sem jsPDF/docx) + montarDocxProposta() +
// generateProposalDocx() (orquestrador async). Este arquivo virou um teste de "smoke" da CAMADA DE
// DADOS: chama buildPropostaDocModel() direto pros mesmos 5 cenários que antes verificavam
// call-counts do jsPDF, e confere a FORMA/VALORES do modelo (itens da nova proposta, situação
// atual, destaque). O caso 6 exercita o caminho assíncrono completo (generateProposalDocx, com
// window.docx e window.downloadBlob stubados) só pra garantir que não lança exceção e baixa um
// .docx com o nome certo.
const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: () => ({ select: () => ({ order: () => ({ then: () => {} }) }) }),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;

// Stub PERMISSIVO de docx.js: cada "classe" só guarda os argumentos recebidos — não tenta desenhar
// nada de verdade. Packer.toBlob resolve pra um objeto qualquer (jsdom não tem Blob de verdade em
// todo ambiente, e não precisamos de um Blob real pra este teste — downloadBlob também é stubado).
const docxStubDef = `
window.docx = (function(){
  class FakeNode { constructor(opts){ this.opts = opts; } }
  return {
    Document: FakeNode, Paragraph: FakeNode, TextRun: FakeNode,
    Table: FakeNode, TableRow: FakeNode, TableCell: FakeNode,
    AlignmentType: { LEFT: 'left', CENTER: 'center', RIGHT: 'right' },
    WidthType: { AUTO: 'auto', PERCENTAGE: 'pct', DXA: 'dxa' },
    ShadingType: { CLEAR: 'clear' },
    VerticalAlign: { CENTER: 'center', TOP: 'top', BOTTOM: 'bottom' },
    Packer: { toBlob: async () => ({ __fakeBlob: true }) },
  };
})();
window.__lastDownload = null;
window.downloadBlob = function(blob, filename){ window.__lastDownload = { blob, filename }; };
`;

const testScript = `
var ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };

  const clienteBase = {
    razao_social: 'CLIENTE BASE TESTE LTDA', cnpj: '11.222.333/0001-44', cidade: 'São Paulo', ddd: '11',
    linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000',
  };

  console.log('--- caso 1: cliente da base, renovacao + 2 incrementos + fibra ---');
  openProposal(clienteBase, {});
  proposalState.incluirIncremento = true;
  proposalState.incrementos = OFFERS_MOBILE.filter(o => (o.tipos||[]).includes('incremento')).slice(0,2).map(o=>({offerId:o.id, qtd:1}));
  proposalState.incluirFixa = true;
  let modelo = buildPropostaDocModel();
  assert(modelo.client.razaoSocial === 'CLIENTE BASE TESTE LTDA', 'caso 1: razaoSocial correta');
  assert(modelo.situacaoAtual.tipo === 'resumo', 'caso 1: sem situacaoAtualGrupos, situacaoAtual e resumo');
  // 1 grupo de renovacao (base) + 2 incrementos + 1 fibra = 4 itens (consolidarValores desligado por padrao)
  assert(modelo.novaProposta.itens.length === 4, 'caso 1: 4 itens na nova proposta (' + modelo.novaProposta.itens.length + ')');
  assert(modelo.novaProposta.itens.some(it => it.item === 'Renovação'), 'caso 1: item de renovacao presente');
  assert(modelo.novaProposta.itens.filter(it => it.item === 'Incremento(s)').length === 2, 'caso 1: 2 itens de incremento');
  assert(modelo.novaProposta.itens.some(it => it.item === 'Claro Fibra'), 'caso 1: item de fibra presente');
  assert(modelo.novaProposta.consolidado === false, 'caso 1: consolidado falso por padrao');
  const { novoTotal } = computeProposal();
  assert(modelo.destaque.valorProposto === novoTotal, 'caso 1: destaque.valorProposto bate com computeProposal().novoTotal');

  console.log('--- caso 2: cliente da base, sem renovacao, so incremento ---');
  openProposal(clienteBase, {});
  proposalState.incluirRenovacao = false;
  proposalState.incluirIncremento = true; // seções nascem desligadas por padrão agora — ligar explicitamente pro cenário do teste
  const ofertaIncCaso2 = OFFERS_MOBILE.find(o => (o.tipos||[]).includes('incremento'));
  proposalState.incrementos = [{ offerId: ofertaIncCaso2.id, qtd: 1 }];
  proposalState.incluirFixa = false;
  modelo = buildPropostaDocModel();
  const itemPlanoAtual = modelo.novaProposta.itens.find(it => it.item === 'Plano atual');
  assert(!!itemPlanoAtual, 'caso 2: sem renovacao, aparece item "Plano atual" (mantido)');
  assert(itemPlanoAtual.subtotal === null, 'caso 2: item "Plano atual" tem subtotal null (nao soma no total)');
  assert(itemPlanoAtual.desc === 'mantido, sem alteração', 'caso 2: descricao do item "Plano atual"');
  assert(modelo.novaProposta.itens.some(it => it.item === 'Incremento(s)'), 'caso 2: item de incremento presente');

  console.log('--- caso 3: proposta avulsa concorrencia, grupos mistos ---');
  const clienteAvulsa = {
    razao_social: 'PROSPECT AVULSO LTDA', cnpj: '', cidade: 'Rio de Janeiro', ddd: '21',
    linhas_atuais: 3, valor_contrato: 450, arpu: 150, cep_cabeado: '',
  };
  openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'portabilidade', operadoraAtual: 'Vivo' });
  const ofertaPort = grupoOfferList(clienteAvulsa, 'portabilidade').find(o => o.aplicavel);
  const ofertaAquis = grupoOfferList(clienteAvulsa, 'aquisicao').find(o => o.aplicavel);
  proposalState.linhaGrupos = [
    { tipo: 'portabilidade', qtd: 3, offerId: ofertaPort ? ofertaPort.id : null },
    { tipo: 'aquisicao', qtd: 2, offerId: ofertaAquis ? ofertaAquis.id : null },
  ];
  proposalState.incluirPassaporte = true;
  modelo = buildPropostaDocModel();
  assert(modelo.subtitulo === 'Proposta avulsa — Portabilidade', 'caso 3: subtitulo de proposta avulsa portabilidade');
  assert(modelo.novaProposta.itens.some(it => it.item === 'Portabilidade'), 'caso 3: item de portabilidade presente');
  assert(modelo.novaProposta.itens.some(it => it.item === 'Aquisição'), 'caso 3: item de aquisicao presente');
  assert(modelo.novaProposta.itens.some(it => it.item === 'Claro Passaporte'), 'caso 3: item de passaporte presente');

  console.log('--- caso 4: transferencia de titularidade PF->PJ ---');
  openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'titularidade', operadoraAtual: 'Claro (Pessoa Física)' });
  modelo = buildPropostaDocModel();
  assert(modelo.subtitulo === 'Transferência de titularidade Claro — Pessoa Física para Jurídica', 'caso 4: subtitulo de titularidade');

  console.log('--- caso 5: muitos itens (grupos + incrementos + fibra + passaporte) ---');
  openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'portabilidade', operadoraAtual: 'Tim' });
  const todasOfertas = grupoOfferList(clienteAvulsa, 'aquisicao').filter(o => o.aplicavel);
  proposalState.linhaGrupos = todasOfertas.slice(0, 8).map(o => ({ tipo: 'aquisicao', qtd: 1, offerId: o.id }));
  proposalState.incrementos = OFFERS_MOBILE.filter(o => (o.tipos||[]).includes('incremento')).slice(0,4).map(o=>({offerId:o.id, qtd:1}));
  proposalState.incluirFixa = true;
  proposalState.incluirPassaporte = true;
  modelo = buildPropostaDocModel();
  const somaItens = modelo.novaProposta.itens.reduce((s, it) => s + (it.subtotal || 0), 0);
  assert(Math.abs(somaItens + modelo.novaProposta.valorMonitor - modelo.destaque.valorProposto) < 0.01,
    'caso 5: soma dos itens + valorMonitor bate com destaque.valorProposto (' + somaItens + ' + ' + modelo.novaProposta.valorMonitor + ' vs ' + modelo.destaque.valorProposto + ')');
  assert(modelo.novaProposta.itens.length >= 10, 'caso 5: muitos itens presentes (grupos + incrementos + fibra + passaporte) (' + modelo.novaProposta.itens.length + ')');

  window.__syncFailed = false;
}catch(e){
  console.log('ERRO FATAL (casos 1-5):', e.message);
  console.log(e.stack);
  window.__syncFailed = true;
}

(async () => {
  try{
    if(window.__syncFailed){
      console.log('--- pulando caso 6: casos 1-5 ja falharam ---');
    } else {
      console.log('--- caso 6: caminho assincrono completo (generateProposalDocx) ---');
      window.__lastDownload = null;
      await generateProposalDocx();
      assert(window.__lastDownload !== null, 'caso 6: downloadBlob foi chamado');
      assert(window.__lastDownload && window.__lastDownload.filename.endsWith('.docx'), 'caso 6: nome do arquivo termina em .docx (' + (window.__lastDownload && window.__lastDownload.filename) + ')');
      assert(window.__lastDownload && window.__lastDownload.filename.includes('PROSPECT_AVULSO_LTDA'), 'caso 6: nome do arquivo inclui a razao social sanitizada');
    }
  }catch(e){
    console.log('ERRO FATAL (caso 6):', e.message);
    console.log(e.stack);
    fail++;
  }
  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = (fail > 0 || window.__syncFailed) ? 'FAIL' : 'OK';
})();
`;

// Ordem importa: docxStubDef precisa vir ANTES de jsCode no mesmo eval — "function downloadBlob(){}"
// declarada dentro de jsCode é hoisted e viraria propriedade de window igual à do stub, mas como tudo
// roda numa única eval em sequência (nada de wrapper de função em volta de jsCode), a ATRIBUIÇÃO do
// stub (que é uma instrução, não uma function declaration) executa depois do hoisting e prevalece.
window.eval(docxStubDef + jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 500);
