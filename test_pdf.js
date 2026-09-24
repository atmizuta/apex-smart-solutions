// test_pdf.js (23/09/2026): generateProposalPDF() foi removida — a proposta agora é gerada como
// DOCX a partir de buildPropostaDocModel() (dado puro, sem jsPDF/docx) + montarDocxProposta() +
// generateProposalDocx() (orquestrador async). Este arquivo virou um teste de "smoke" da CAMADA DE
// DADOS: chama buildPropostaDocModel() direto pros mesmos 5 cenários que antes verificavam
// call-counts do jsPDF, e confere a FORMA/VALORES do modelo (itens da nova proposta, situação
// atual, destaque). O caso 6 exercita o caminho assíncrono completo (generateProposalDocx, com
// window.docx e window.downloadBlob stubados) só pra garantir que não lança exceção e baixa um
// .docx com o nome certo.
//
// 24/09/2026 (pedido do usuário: "na emissao da proposta em word perde-se os logos da Apex e da
// Claro, é possivel emitir no formato anterior, deixar a opção tambem de emissão em PDF... Versao
// editavel, versao pdf e pdf para o cliente"): casos 7-10 cobrem os 3 formatos de emissão —
// getLogoBytes() (bytes reais dos logos), montarDocxProposta() com o novo cabeçalho em tabela com
// ImageRun (fix dos logos perdidos no Word), generateProposalPdfConsultor() (2ª opção, PDF "oficial"
// que também registra no funil) e generateProposalPdfCliente() (3ª opção, PDF resumido pro cliente
// final, que NÃO registra no funil). O stub de docx.js ganhou ImageRun (antes ausente — quebraria o
// novo cabeçalho em tabela) e o de jsPDF (window.jspdf) é novo neste arquivo, reaproveitando o mesmo
// padrão __makeDocStubFatura já usado em test_analisar_fatura.js.
const fs = require('fs');
const { JSDOM } = require('jsdom');

// 24/09/2026: passou a ler painel_clientes_apex.html (o arquivo JÁ COM OS PLACEHOLDERS DE LOGO
// SUBSTITUÍDOS por build_painel.py), não mais _template.html direto — _template.html sozinho ainda
// tem os placeholders literais __APEX_LOGO_B64__/__CLARO_LOGO_B64__ nas tags <img>, e os casos novos
// (getLogoBytes / cabeçalho com ImageRun) precisam dos bytes REAIS dos logos pra fazer sentido. Mesmo
// padrão já usado em test_analisar_fatura.js. O runner sempre roda build_painel.py antes dos testes.
let html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// stub de Supabase (24/09/2026: ganhou tracking de tabela por chamada de .from(), em
// window.__testFromCalls, e suporte a insert/update/eq/single — antes só suportava select/order.
// registrarPropostaNoFunil() está sempre dentro de try/catch e nunca lança pro chamador, mas agora
// dá pra verificar SE ela foi de fato chamada (tabela 'propostas' presente em __testFromCalls) em vez
// de só confiar em "não lançou exceção" — importante pro caso 9 (PDF consultor DEVE tocar o funil) x
// caso 10 (PDF cliente NÃO DEVE tocar o funil).
window.__testFromCalls = [];
function __chainable(){
  // .select()/.order()/.eq() (sem .single() no fim) resolvem como listagem — {data:[], error:null},
  // formato que renderFunil()/loadFunil() esperam (lista.filter precisa de um array). .single() (só
  // usado depois de .insert(...).select()) resolve como registro único — {data:{id:...}, error:null}.
  const obj = {
    select: () => obj, order: () => obj, eq: () => obj, insert: () => obj, update: () => obj,
    single: () => Promise.resolve({ data: { id: 'fake-proposta-id' }, error: null }),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return obj;
}
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => { window.__testFromCalls.push(table); return __chainable(); },
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;

// Stub PERMISSIVO de docx.js: cada "classe" só guarda os argumentos recebidos — não tenta desenhar
// nada de verdade. Packer.toBlob resolve pra um objeto qualquer (jsdom não tem Blob de verdade em
// todo ambiente, e não precisamos de um Blob real pra este teste — downloadBlob também é stubado).
// 24/09/2026: ganhou ImageRun — antes ausente, o que faria montarDocxProposta() lançar ao montar o
// novo cabeçalho em tabela com os logos. ImageRun usa uma classe DISTINTA (FakeImageRun) do resto
// (FakeNode genérico) pra dar pra distinguir com "instanceof" nos testes que verificam que os logos
// realmente viraram ImageRun dentro da tabela do cabeçalho (e não viraram só texto/nada). Document
// também guarda a última instância criada em window.__lastDocxDocument, pra inspeção estrutural.
const docxStubDef = `
window.docx = (function(){
  class FakeNode { constructor(opts){ this.opts = opts; } }
  class FakeImageRun extends FakeNode {}
  class FakeDocument extends FakeNode { constructor(opts){ super(opts); window.__lastDocxDocument = this; } }
  return {
    Document: FakeDocument, Paragraph: FakeNode, TextRun: FakeNode,
    Table: FakeNode, TableRow: FakeNode, TableCell: FakeNode, ImageRun: FakeImageRun,
    AlignmentType: { LEFT: 'left', CENTER: 'center', RIGHT: 'right' },
    WidthType: { AUTO: 'auto', PERCENTAGE: 'pct', DXA: 'dxa', PCT: 'pct' },
    ShadingType: { CLEAR: 'clear' },
    VerticalAlign: { CENTER: 'center', TOP: 'top', BOTTOM: 'bottom' },
    Packer: { toBlob: async () => ({ __fakeBlob: true }) },
  };
})();
window.__lastDownload = null;
window.downloadBlob = function(blob, filename){ window.__lastDownload = { blob, filename }; };

// stub de jsPDF (24/09/2026, novo neste arquivo — mesmo padrão __makeDocStubFatura já usado em
// test_analisar_fatura.js): grava toda chamada de doc.text()/doc.save() em window.__testPdfCalls,
// pra dar pra inspecionar o conteúdo/nome do arquivo sem renderizar um PDF de verdade.
window.__testPdfCalls = [];
function __makeDocStub(){
  return {
    setFillColor(){}, setDrawColor(){}, setTextColor(){}, setFontSize(){}, setLineWidth(){}, setFont(){},
    rect(){}, roundedRect(){}, line(){}, text(){ window.__testPdfCalls.push(['text', Array.from(arguments)]); },
    addImage(){}, addPage(){}, setPage(){}, getTextWidth(t){ return String(t).length * 1.8; }, save(){ window.__testPdfCalls.push(['save', Array.from(arguments)]); },
    internal: { getNumberOfPages: () => 1 },
  };
}
window.jspdf = { jsPDF: function(){ return __makeDocStub(); } };
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

  console.log('--- caso 7: getLogoBytes() retorna bytes reais dos logos Apex e Claro ---');
  const logos = getLogoBytes();
  assert(logos && logos.apex instanceof Uint8Array, 'caso 7: logos.apex e um Uint8Array');
  assert(logos && logos.apex && logos.apex.length > 0, 'caso 7: logos.apex tem bytes (' + (logos.apex ? logos.apex.length : 'null') + ')');
  assert(logos && logos.claro instanceof Uint8Array, 'caso 7: logos.claro e um Uint8Array');
  assert(logos && logos.claro && logos.claro.length > 0, 'caso 7: logos.claro tem bytes (' + (logos.claro ? logos.claro.length : 'null') + ')');

  window.__syncFailed = false;
}catch(e){
  console.log('ERRO FATAL (casos 1-5, 7):', e.message);
  console.log(e.stack);
  window.__syncFailed = true;
}

(async () => {
  try{
    if(window.__syncFailed){
      console.log('--- pulando casos assincronos: casos sincronos ja falharam ---');
    } else {
      console.log('--- caso 6: caminho assincrono completo (generateProposalDocx) ---');
      window.__lastDownload = null;
      await generateProposalDocx();
      assert(window.__lastDownload !== null, 'caso 6: downloadBlob foi chamado');
      assert(window.__lastDownload && window.__lastDownload.filename.endsWith('.docx'), 'caso 6: nome do arquivo termina em .docx (' + (window.__lastDownload && window.__lastDownload.filename) + ')');
      assert(window.__lastDownload && window.__lastDownload.filename.includes('PROSPECT_AVULSO_LTDA'), 'caso 6: nome do arquivo inclui a razao social sanitizada');

      console.log('--- caso 8: montarDocxProposta(modelo) com logos - cabecalho vira Table com 2 ImageRun ---');
      const clienteBaseLogo = { razao_social: 'CLIENTE LOGO TESTE LTDA', cnpj: '11.222.333/0001-44', cidade: 'São Paulo', ddd: '11', linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000' };
      openProposal(clienteBaseLogo, {});
      proposalState.incluirFixa = false;
      const modeloLogo = buildPropostaDocModel();
      window.__lastDocxDocument = null;
      const blobLogo = await montarDocxProposta(modeloLogo);
      assert(blobLogo && blobLogo.__fakeBlob === true, 'caso 8: montarDocxProposta completa sem lancar e devolve o blob stubado');
      assert(window.__lastDocxDocument !== null, 'caso 8: um Document foi criado');
      const headerTable = window.__lastDocxDocument.opts.sections[0].children[0];
      assert(headerTable instanceof window.docx.Table, 'caso 8: primeiro filho do documento e uma Table (cabecalho) — nao mais um Paragraph');
      const headerRow = headerTable.opts.rows[0];
      const headerCells = headerRow.opts.children;
      assert(headerCells.length === 3, 'caso 8: cabecalho tem 3 celulas (logo Apex | titulo | logo Claro) (' + headerCells.length + ')');
      function imageRunDentroDaCelula(cell){
        const paragrafo = cell.opts.children[0];
        const filho = paragrafo && paragrafo.opts.children && paragrafo.opts.children[0];
        return filho instanceof window.docx.ImageRun;
      }
      assert(imageRunDentroDaCelula(headerCells[0]), 'caso 8: 1a celula (Apex) contem um ImageRun de verdade');
      assert(imageRunDentroDaCelula(headerCells[2]), 'caso 8: 3a celula (Claro) contem um ImageRun de verdade');
      assert(!imageRunDentroDaCelula(headerCells[1]), 'caso 8: celula central (titulo) NAO contem ImageRun');

      console.log('--- caso 9: generateProposalPdfConsultor() - salva PDF e registra no funil ---');
      const clienteConsultor = { razao_social: 'CLIENTE PDF CONSULTOR LTDA', cnpj: '22.333.444/0001-55', cidade: 'São Paulo', ddd: '11', linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000' };
      openProposal(clienteConsultor, {});
      proposalState.incluirFixa = false;
      window.__testPdfCalls.length = 0;
      window.__testFromCalls.length = 0;
      generateProposalPdfConsultor();
      const saveCallsConsultor = window.__testPdfCalls.filter(c => c[0] === 'save');
      assert(saveCallsConsultor.length === 1, 'caso 9: doc.save() foi chamado exatamente 1 vez (' + saveCallsConsultor.length + ')');
      assert(saveCallsConsultor[0] && String(saveCallsConsultor[0][1][0]).startsWith('proposta_') && String(saveCallsConsultor[0][1][0]).endsWith('.pdf'), 'caso 9: nome do arquivo no padrao proposta_<razao>.pdf (' + (saveCallsConsultor[0] && saveCallsConsultor[0][1][0]) + ')');
      assert(saveCallsConsultor[0] && String(saveCallsConsultor[0][1][0]).includes('CLIENTE_PDF_CONSULTOR_LTDA'), 'caso 9: nome do arquivo inclui a razao social sanitizada');
      assert(window.__testFromCalls.includes('propostas'), 'caso 9: registrarPropostaNoFunil tocou a tabela "propostas" (PDF do consultor conta como proposta oficial)');

      console.log('--- caso 10: generateProposalPdfCliente() - salva PDF e NAO registra no funil ---');
      const clienteFinal = { razao_social: 'CLIENTE PDF FINAL LTDA', cnpj: '33.444.555/0001-66', cidade: 'São Paulo', ddd: '11', linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000' };
      openProposal(clienteFinal, {});
      proposalState.incluirFixa = false;
      window.__testPdfCalls.length = 0;
      window.__testFromCalls.length = 0;
      generateProposalPdfCliente();
      const saveCallsCliente = window.__testPdfCalls.filter(c => c[0] === 'save');
      assert(saveCallsCliente.length === 1, 'caso 10: doc.save() foi chamado exatamente 1 vez (' + saveCallsCliente.length + ')');
      assert(saveCallsCliente[0] && String(saveCallsCliente[0][1][0]).startsWith('proposta_cliente_') && String(saveCallsCliente[0][1][0]).endsWith('.pdf'), 'caso 10: nome do arquivo no padrao proposta_cliente_<razao>.pdf (' + (saveCallsCliente[0] && saveCallsCliente[0][1][0]) + ')');
      assert(saveCallsCliente[0] && String(saveCallsCliente[0][1][0]).includes('CLIENTE_PDF_FINAL_LTDA'), 'caso 10: nome do arquivo inclui a razao social sanitizada');
      assert(!window.__testFromCalls.includes('propostas'), 'caso 10: PDF pro cliente NAO toca a tabela "propostas" (nao e o ato formal de gerar a proposta)');

      console.log('--- caso 11: montarPdfProposta com Claro Monitor incluso (4o badge - testa quebra de linha) ---');
      const clienteMonitor = { razao_social: 'CLIENTE MONITOR TESTE LTDA', cnpj: '44.555.666/0001-77', cidade: 'São Paulo', ddd: '11', linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000' };
      openProposal(clienteMonitor, {});
      proposalState.incluirFixa = true; // ativa oferta movel/fibra p/ aparecerem badges universais
      proposalState.incluirExtras = true;
      proposalState.extras = [{ tipo: 'monitor', descricao: 'Claro Monitor — Jornada Mobilidade', valorUnit: 5, qtd: 5 }];
      const modeloMonitor = buildPropostaDocModel();
      assert(modeloMonitor.beneficios.badges.length >= 1, 'caso 11: modelo tem pelo menos 1 badge de beneficio');
      let excecaoMontarPdf = null;
      let docMonitor = null;
      try{ docMonitor = montarPdfProposta(modeloMonitor); }catch(e){ excecaoMontarPdf = e; }
      assert(excecaoMontarPdf === null, 'caso 11: montarPdfProposta nao lanca com Claro Monitor incluso (' + (excecaoMontarPdf && excecaoMontarPdf.message) + ')');
      assert(docMonitor !== null, 'caso 11: montarPdfProposta devolve o objeto doc');
    }
  }catch(e){
    console.log('ERRO FATAL (casos assincronos):', e.message);
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
