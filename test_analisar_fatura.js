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
// stub de jsPDF (23/09/2026: ganhou os metodos usados por generateFaturaAnalisePDF, mesmo padrao
// do __makeDocStub ja usado em test_pdf.js) — grava toda chamada de doc.text() em
// window.__testPdfCalls, pra testar o conteudo do PDF pro cliente sem precisar renderizar um PDF de verdade.
window.__testPdfCalls = [];
function __makeDocStubFatura(){
  return {
    setFillColor(){}, setDrawColor(){}, setTextColor(){}, setFontSize(){}, setLineWidth(){}, setFont(){},
    rect(){}, roundedRect(){}, line(){}, text(){ window.__testPdfCalls.push(['text', Array.from(arguments)]); },
    addImage(){}, addPage(){}, setPage(){}, getTextWidth(t){ return String(t).length * 1.8; }, save(){ window.__testPdfCalls.push(['save', Array.from(arguments)]); },
    internal: { getNumberOfPages: () => 1 },
  };
}
window.jspdf = { jsPDF: function(){ return __makeDocStubFatura(); } };

// mock de pdf.js: em jsdom (runScripts:'outside-only') o <script src="...pdf.min.js"> do CDN nunca
// carrega de verdade, entao getPdfjsLib() precisa achar algo em window['pdfjs-dist/build/pdf'].
// O texto "extraido" de cada pagina vem de window.__mockPdfText (o teste seta antes de cada analise).
window.__mockPdfText = '';
window['pdfjs-dist/build/pdf'] = {
  GlobalWorkerOptions: {},
  getDocument: function(){
    return { promise: Promise.resolve({
      numPages: 1,
      getPage: async function(){
        return { getTextContent: async function(){
          return { items: [{ str: window.__mockPdfText || '' }] };
        } };
      }
    }) };
  }
};

const testScript = `
(async () => {
const assert = (c,m) => { if(!c) throw new Error('FALHOU: '+m); console.log('OK:', m); };
currentUser = { id:'u1', nome:'T', username:'t', role:'consultor' };

// --- 1) estrutura: botao existe dentro do panel-proposta, modal comeca fechado ---
const btnAbrir = document.getElementById('btnAbrirAnaliseFatura');
assert(!!btnAbrir, 'botao "Analisar Fatura" existe');
assert(document.getElementById('panel-proposta').contains(btnAbrir), 'botao esta dentro da aba Gerar Proposta (panel-proposta)');
assert(btnAbrir.textContent.trim() === 'Analisar Fatura', 'texto do botao e "Analisar Fatura"');
const faturaOverlayTest = document.getElementById('faturaOverlay');
assert(!!faturaOverlayTest, 'modal faturaOverlay existe');
assert(!faturaOverlayTest.classList.contains('active'), 'modal comeca fechado');

// --- 2) abrir o modal reseta campos e mostra o overlay ---
document.getElementById('faturaNomeCliente').value = 'lixo antigo';
btnAbrir.click();
assert(faturaOverlayTest.classList.contains('active'), 'modal abre ao clicar no botao');
assert(document.getElementById('faturaNomeCliente').value === '', 'campo nome do cliente e resetado ao abrir');
assert(document.getElementById('faturaResultado').style.display === 'none', 'area de resultado comeca escondida');

// --- 3) fechar o modal pelo X ---
document.getElementById('faturaClose').click();
assert(!faturaOverlayTest.classList.contains('active'), 'modal fecha no X');
btnAbrir.click();

// --- 4) validacao do DDD do endereco fiscal (novo campo obrigatorio, 23/09/2026, secao 31):
// clicar em Analisar com #faturaDdd vazio bloqueia a analise e mostra erro especifico, ANTES de
// checar o arquivo anexado (mesmo padrao ja usado pra validacao de arquivo) ---
document.getElementById('btnAnalisarFatura').click();
const errEl = document.getElementById('faturaErr');
assert(errEl.style.display === 'block', 'com faturaDdd vazio, clicar Analisar mostra erro');
assert(/DDD/.test(errEl.textContent), 'erro de DDD vazio menciona "DDD" — achou: ' + errEl.textContent);
assert(document.getElementById('faturaResultado').style.display === 'none', 'com faturaDdd vazio, resultado continua escondido');
assert(faturaState.ddd === '', 'faturaState.ddd fica vazio quando o campo nao foi preenchido');

// DDD com 1 digito -> ainda invalido
document.getElementById('faturaDdd').value = '1';
document.getElementById('btnAnalisarFatura').click();
assert(errEl.style.display === 'block', 'DDD com 1 digito ainda mostra erro');

// DDD com 3 digitos -> ainda invalido
document.getElementById('faturaDdd').value = '123';
document.getElementById('btnAnalisarFatura').click();
assert(errEl.style.display === 'block', 'DDD com 3 digitos ainda mostra erro');

// DDD nao numerico -> ainda invalido
document.getElementById('faturaDdd').value = 'ab';
document.getElementById('btnAnalisarFatura').click();
assert(errEl.style.display === 'block', 'DDD nao numerico (letras) ainda mostra erro');

// --- 4b) DDD valido (2 digitos) preenchido -> passa da validacao de DDD e cai na validacao de
// arquivo (nenhum anexado ainda nesse ponto do teste) -- prova que a nova validacao de DDD nao
// quebra a validacao de arquivo que ja existia (era o antigo passo "4") ---
document.getElementById('faturaDdd').value = '11';
document.getElementById('btnAnalisarFatura').click();
assert(errEl.style.display === 'block', 'com DDD valido mas sem arquivo anexado, clicar Analisar mostra erro (validacao de arquivo)');
assert(!/DDD/.test(errEl.textContent), 'com DDD valido, o erro deixa de mencionar DDD e passa a ser sobre o arquivo — achou: ' + errEl.textContent);
assert(document.getElementById('faturaResultado').style.display === 'none', 'sem arquivo, resultado continua escondido');
assert(faturaState.ddd === '11', 'faturaState.ddd grava o valor digitado (11) apos DDD valido');

// --- fixture reutilizada nos passos 6, 7, 9-12: reproduz 3 blocos "DETALHAMENTO DE LIGACOES E
// SERVICOS DO CELULAR" como o pdf.js devolveria (texto corrido, sem quebras de tabela), cobrindo
// os 2 exemplos que o usuario deu (10GB e 20GB) mais um terceiro plano (50GB) pra garantir que o
// parser nao e hardcoded pra um valor so (baseada em MASALVADOR.pdf) ---
const faturaFixture = \`
Veja aqui o que esta sendo cobrado
DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (17) 99219 9652
Mensalidades e Pacotes Promocionais
Descricao Total (R$)
Oferta Conjunta Claro MIX 48,49
Bonus de Internet Turbo - 4GB 0,00
Claro Monitor lite -
Claro Pos 10GB -
Pacote Mobilidade 0,00
Pacote Redes Sociais 5GB 0,00
Aplicativos Digitais -
TOTAL R$ 48,49
Interurbanas e Rec. em viagem
Ligacoes com o Codigo 21 - Embratel
Data Hora Origem-Destino Numero Dur. Efetiva Duracao Valor Total (R$) Valor Cobrado (R$)
06/08 17:54:57 Sao Paulo Sao Vicente 1335693100 00:06:48 00:06:48 0,00 0,00
Internet (MB)
Servico Mbytes Utilizados Tarifa (R$) Valor Total (R$) Valor Cobrado (R$)
Internet 0,050 0,00 0,00 0,00
Subtotal 0,050 0,00
DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (17) 99244 3093
Mensalidades e Pacotes Promocionais
Descricao Total (R$)
Oferta Conjunta Claro MIX 58,99
Bonus de Internet Turbo - 5GB 0,00
Claro Monitor lite -
Claro Pos 20GB -
Pacote Mobilidade 0,00
Pacote Redes Sociais 10GB 0,00
Aplicativos Digitais -
TOTAL R$ 58,99
Ligacoes Locais
Ligacoes para celulares Claro
Data Hora Origem(UF)-Destino Numero Dur. Efetiva Duracao Tarifa (R$) Valor Total (R$) Valor Cobrado (R$)
08/08 15:40:43 Sao Paulo Sao Paulo (17) 17992557322 00:00:52 00:00:54 0,00 0,00 0,00
Internet (MB)
Servico Mbytes Utilizados Tarifa (R$) Valor Total (R$) Valor Cobrado (R$)
Internet 100,000 0,00 0,00 0,00
Subtotal 100,000 0,00
DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (17) 99708 1735
Mensalidades e Pacotes Promocionais
Descricao Total (R$)
Oferta Conjunta Claro MIX 74,99
Bonus de Internet Turbo - 5GB 0,00
Claro Monitor lite -
Claro Pos 50GB -
Pacote Mobilidade 0,00
Pacote Redes Sociais 15GB 0,00
Aplicativos Digitais -
TOTAL R$ 74,99
Interurbanas e Rec. em viagem
Internet (MB)
Servico Mbytes Utilizados Tarifa (R$) Valor Total (R$) Valor Cobrado (R$)
Internet 60000,000 0,00 0,00 0,00
Subtotal 60000,000 0,00
\`;

// --- 5) anexar arquivo (mock de File, jsdom nao permite setar files real) ---
const fileInput = document.getElementById('faturaArquivo');
const fakeFile = { name: 'fatura_setembro.pdf', size: 204800, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(0) };
Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });
fileInput.dispatchEvent(new window.Event('change'));
assert(document.getElementById('faturaArquivoInfo').textContent.includes('fatura_setembro.pdf'), 'nome do arquivo aparece apos selecionar');
assert(document.getElementById('faturaArquivoInfo').textContent.includes('200 KB'), 'tamanho do arquivo em KB aparece (200 KB)');

// intercepta analisarFatura pra conseguir dar "await" na Promise disparada pelo click: o listener
// real do botao dispara "fire-and-forget" (sem await), entao o teste precisa da propria Promise
// pra saber quando a leitura assincrona do PDF (mockado) terminou de renderizar o resultado.
const origAnalisarFatura = window.analisarFatura;
let lastAnalise = Promise.resolve();
window.analisarFatura = function(state){ lastAnalise = origAnalisarFatura(state); return lastAnalise; };

// --- 6) clicar em Analisar agora deve funcionar (pdf.js mockado) e mostrar o resultado real ---
window.__mockPdfText = faturaFixture;
document.getElementById('faturaNomeCliente').value = 'Empresa Teste Ltda';
document.getElementById('btnAnalisarFatura').click();
await lastAnalise;
assert(errEl.style.display !== 'block', 'com arquivo anexado nao mostra erro');
const resultEl = document.getElementById('faturaResultado');
assert(resultEl.style.display === 'block', 'area de resultado aparece apos analisar');
assert(resultEl.innerHTML.includes('fatura_setembro.pdf'), 'resultado menciona o nome do arquivo anexado');
assert(resultEl.innerHTML.includes('Empresa Teste Ltda'), 'resultado menciona o nome do cliente informado');
assert(resultEl.innerHTML.includes('3 linha'), 'resultado informa quantas linhas foram identificadas na fatura (3)');
// 22/09/2026 (redesign visual, ver renderFaturaComparacao): a diferenca por linha deixou de usar
// o texto "economia de X"/"aumento de X" em badge grande e passou a ser um texto compacto colorido
// "-R$X (Y%)"/"+R$X (Y%)" ao lado do valor proposto — checa o novo formato, mais o resumo (KPIs) no topo.
assert(/[-+]R\\$/.test(resultEl.innerHTML), 'resultado mostra a diferenca de valor por linha (formato -R$/+R$), ja calculada de verdade');
assert(resultEl.innerHTML.includes('class="kpiGrid"'), 'resultado mostra o resumo (KPIs) no topo — linhas, mensalidade atual/proposta e economia/aumento total');

// --- 7) escapeHtml protege contra nome de arquivo/cliente com caracteres de HTML ---
const fakeFile2 = { name: '<img src=x onerror=alert(1)>.pdf', size: 1024, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(0) };
Object.defineProperty(fileInput, 'files', { value: [fakeFile2], configurable: true });
fileInput.dispatchEvent(new window.Event('change'));
document.getElementById('faturaNomeCliente').value = '<b>hack</b>';
document.getElementById('btnAnalisarFatura').click();
await lastAnalise;
assert(!resultEl.innerHTML.includes('<img src=x'), 'nome de arquivo malicioso e escapado no resultado');
assert(!resultEl.innerHTML.includes('<b>hack</b>'), 'nome de cliente malicioso e escapado no resultado');
assert(resultEl.innerHTML.includes('&lt;img'), 'HTML do arquivo aparece escapado (&lt;img)');

// --- 8) clicar fora do modal NAO fecha mais (23/09/2026, pedido do usuario: "a tela fecha
// automaticamente clicando fora, corrigir para deixar a pagina aberta") — antes desse pedido, esse
// mesmo clique fechava o modal (era o comportamento padrao dos overlays); a analise de fatura fica
// aberta por bastante tempo (varias linhas, ajustes), entao um clique sem querer fora do conteudo
// nao pode mais derrubar o trabalho todo. So fecha pelo X ou terminando o fluxo ---
const evtFora = new window.MouseEvent('click');
Object.defineProperty(evtFora, 'target', { value: faturaOverlayTest });
faturaOverlayTest.dispatchEvent(evtFora);
assert(faturaOverlayTest.classList.contains('active'), 'clicar fora do modal (no overlay) NAO fecha mais o modal da analise de fatura');

// --- 9) extractFaturaLinhas(): parsing real do texto extraido do PDF (fixture baseada em MASALVADOR.pdf) ---
const linhasExtraidas = window.extractFaturaLinhas(faturaFixture);
assert(linhasExtraidas.length === 3, 'extractFaturaLinhas encontra as 3 linhas da fixture (encontrou ' + linhasExtraidas.length + ')');
const l1 = linhasExtraidas.find(l => l.numero === '992199652');
assert(!!l1, 'linha (17) 99219 9652 foi encontrada');
assert(l1.planoGb === 10, 'linha 99219 9652: plano identificado como 10GB (exemplo do usuario) — achou ' + l1.planoGb);
assert(l1.valorMensal === 48.49, 'linha 99219 9652: valor mensal 48,49 — achou ' + l1.valorMensal);
const l2 = linhasExtraidas.find(l => l.numero === '992443093');
assert(!!l2, 'linha 17992443093 foi encontrada');
assert(l2.planoGb === 20, 'linha 992443093: plano identificado como 20GB (exemplo do usuario) — achou ' + l2.planoGb);
assert(l2.valorMensal === 58.99, 'linha 992443093: valor mensal 58,99 — achou ' + l2.valorMensal);
const l3 = linhasExtraidas.find(l => l.numero === '997081735');
assert(!!l3 && l3.planoGb === 50 && l3.valorMensal === 74.99, 'linha 99708 1735: plano 50GB, valor 74,99 (terceiro plano, nao hardcoded)');
assert(linhasExtraidas.every(l => l.temAplicativosDigitais), 'todas as linhas da fixture tem Aplicativos Digitais');
assert(linhasExtraidas.every(l => l.temClaroMonitor), 'todas as linhas da fixture tem Claro Monitor lite');
// consumo de dados por linha (22/09/2026, secao 23) — extraido da secao "Internet (MB)"/"Subtotal"
// de cada bloco, escopado a essa linha (nunca ao bloco seguinte)
assert(Math.abs(l1.internetMbUtilizado - 0.05) < 0.001, 'linha 99219 9652: consumo de 0,050MB — achou ' + l1.internetMbUtilizado);
assert(Math.abs(l2.internetMbUtilizado - 100) < 0.001, 'linha 992443093: consumo de 100MB — achou ' + l2.internetMbUtilizado);
assert(Math.abs(l3.internetMbUtilizado - 60000) < 0.001, 'linha 99708 1735: consumo de 60.000MB — achou ' + l3.internetMbUtilizado);

// --- 9b) extractFaturaLinhas() contra texto REAL extraido do MASALVADOR.pdf via pdf.js (nao uma
// fixture escrita a mao): o pdf.js quebra cada caractere acentuado em um item de texto separado,
// e o join(' ') do analisarFatura() cola um espaço extra colado ao acento — "LIGAÇÕES" vira
// "LIGA ÇÕ ES", "Descrição" vira "Descri çã o", "Pós" vira "P ó s" etc. Esse artefato só aparece
// no texto real (a fixture acima, digitada a mao, nao tem esse problema) e foi o motivo de
// "Analisar Fatura" nao reconhecer nenhuma linha na fatura real do usuario. Trecho abaixo e um
// recorte literal (3 blocos) do texto que o pdf.js realmente devolveu pra MASALVADOR.pdf.
const faturaFixtureReal = \`DETALHAMENTO DE LIGA ÇÕ ES E SERVI Ç OS DO CELULAR (17) 99219 9652  Mensalidades e Pacotes Promocionais  Descri çã o   Total (R$)  Oferta Conjunta Claro MIX   48,49 B ô nus de Internet Turbo - 4GB   0,00 Claro Monitor lite   - Claro P ó s 10GB   - Pacote Mobilidade   0,00 Pacote Redes Sociais 5GB   0,00 Aplicativos Digitais   -  TOTAL   R$ 48,49
DETALHAMENTO DE LIGA ÇÕ ES E SERVI Ç OS DO CELULAR (17) 99220 3463  Mensalidades e Pacotes Promocionais  Descri çã o   Total (R$)  Oferta Conjunta Claro MIX   58,99 B ô nus de Internet Turbo - 5GB   0,00 Claro Monitor lite   - Claro P ó s 20GB   - Pacote Mobilidade   0,00 Pacote Redes Sociais 10GB   0,00 Aplicativos Digitais   -  TOTAL   R$ 58,99
DETALHAMENTO DE LIGA ÇÕ ES E SERVI Ç OS DO CELULAR (17) 99708 1735  Mensalidades e Pacotes Promocionais  Descri çã o   Total (R$)  Oferta Conjunta Claro MIX   74,99 B ô nus de Internet Turbo - 5GB   0,00 Claro Monitor lite   - Claro P ó s 50GB   - Pacote Mobilidade   0,00 Pacote Redes Sociais 15GB   0,00 Aplicativos Digitais   -  TOTAL   R$ 74,99\`;
const linhasReais = window.extractFaturaLinhas(faturaFixtureReal);
assert(linhasReais.length === 3, 'com o espacamento REAL do pdf.js, extractFaturaLinhas ainda encontra as 3 linhas (achou ' + linhasReais.length + ')');
const r1 = linhasReais.find(l => l.numero === '992199652');
assert(!!r1 && r1.planoGb === 10 && r1.valorMensal === 48.49, 'texto real: linha 99219 9652 -> 10GB, R$48,49 (mesmo com "P ó s" espaçado)');
const r2 = linhasReais.find(l => l.numero === '992203463');
assert(!!r2 && r2.planoGb === 20 && r2.valorMensal === 58.99, 'texto real: linha 99220 3463 -> 20GB, R$58,99');

// --- 10) extractFaturaLinhas() com texto vazio/sem blocos nao quebra ---
assert(Array.isArray(window.extractFaturaLinhas('')) && window.extractFaturaLinhas('').length === 0, 'texto vazio devolve lista vazia sem lancar erro');
assert(window.extractFaturaLinhas('texto qualquer sem fatura nenhuma').length === 0, 'texto sem blocos de detalhamento devolve lista vazia');

// --- 11) sugerirPlanoConsumo(): upgrade/downgrade/manter por % da franquia (22/09/2026, secao 23) ---
// l1 (10GB, 0,05MB usado) -> uso ~0% <= LIMIAR_DOWNGRADE_PCT(40), mas nao ha plano < 10GB no
// catalogo -> cai em "manter", sugerindo o menor plano >= 10GB (12GB, p57-12)
const sug1 = window.sugerirPlanoConsumo(l1);
assert(sug1.acao === 'manter', 'l1 (10GB, uso quase zero): sem plano menor que 10GB no catalogo -> "manter" (achou ' + sug1.acao + ')');
assert(sug1.oferta && sug1.oferta.gb === 12, 'l1: "manter" sugere o menor plano do catalogo >= 10GB (12GB) — achou ' + (sug1.oferta && sug1.oferta.gb));
// l2 (20GB, 100MB usado = 0,49% da franquia) -> downgrade pro maior plano < 20GB que ainda cobre
// o consumo com folga (12GB, franquia 12288MB * 0,8 = 9830,4MB >= 100MB)
const sug2 = window.sugerirPlanoConsumo(l2);
assert(sug2.acao === 'downgrade', 'l2 (20GB, uso de 0,49% da franquia): sugere downgrade — achou ' + sug2.acao);
assert(sug2.oferta && sug2.oferta.gb === 12, 'l2: downgrade sugerido e pro plano de 12GB — achou ' + (sug2.oferta && sug2.oferta.gb));
assert(Math.abs(sug2.pctFranquia - 0.48828125) < 0.01, 'l2: pctFranquia calculado corretamente (100/20480*100) — achou ' + sug2.pctFranquia);
// l3 (50GB, 60.000MB usado = 117% da franquia, estourando) -> upgrade pro menor plano > 50GB que
// cobre o consumo (70GB) — entre as duas ofertas de 70GB do catalogo (p57-70 R$74,99 e p60-70
// R$69,99), a mais barata e sugerida
const sug3 = window.sugerirPlanoConsumo(l3);
assert(sug3.acao === 'upgrade', 'l3 (50GB, uso de 117% da franquia): sugere upgrade — achou ' + sug3.acao);
assert(sug3.oferta && sug3.oferta.gb === 70, 'l3: upgrade sugerido e pro plano de 70GB — achou ' + (sug3.oferta && sug3.oferta.gb));
assert(sug3.oferta && sug3.oferta.id === 'p60-70', 'l3: entre as duas ofertas de 70GB, sugere a mais barata (p60-70, R$69,99) — achou ' + (sug3.oferta && sug3.oferta.id));
// linha sem plano identificado -> acao "indefinido", sem quebrar
const semPlano = { planoGb: null, internetMbUtilizado: 500 };
assert(window.sugerirPlanoConsumo(semPlano).acao === 'indefinido', 'linha sem planoGb identificado devolve acao "indefinido", sem lancar erro');

// --- 12) renderFaturaComparacao(): cada linha tem SEU PROPRIO select, ja pre-selecionado na
// sugestao (pedido do usuario: "deixar o plano sugerido setado") — nunca uma oferta unica pra
// fatura inteira (substitui pickOfertaAlvoPadrao/comparacao de 18/09) ---
const escolhasTeste = {
  porLinha: linhasExtraidas.map(() => ({ offerId: null })), // null = segue a sugestao automatica
  monitorIncluir: false,
  monitorQtd: linhasExtraidas.length,
  incrementos: [],
};
const htmlComparacao = window.renderFaturaComparacao(linhasExtraidas, escolhasTeste);
// 22/09/2026 (redesign visual): o <thead> agora tambem usa "<tr>" sem atributos (estilo via
// classe .faturaTbl), entao a contagem precisa olhar so dentro do <tbody> pra nao contar a linha
// de cabecalho junto — uma linha de tabela por telefone (3), sem agregacao.
const tbodyOnly = htmlComparacao.split('<tbody>')[1] ? htmlComparacao.split('<tbody>')[1].split('</tbody>')[0] : '';
const trCountTbody = (tbodyOnly.match(/<tr>/g) || []).length;
assert(trCountTbody === 3, 'uma linha de tabela por telefone (3), sem agregacao — achou ' + trCountTbody);
assert((htmlComparacao.match(/class="faturaLinhaOferta"/g) || []).length === 3, 'cada linha tem seu proprio select de oferta (3 selects, um por telefone)');
assert(htmlComparacao.includes('<option value="p57-12" selected>'), 'select da l1/l2 ja vem com 12GB pre-selecionado (sugestao automatica)');
assert(htmlComparacao.includes('<option value="p60-70" selected>'), 'select da l3 ja vem com a oferta de 70GB mais barata pre-selecionada');
assert(htmlComparacao.includes('Upgrade sugerido'), 'badge de upgrade aparece pra l3');
assert(htmlComparacao.includes('Downgrade sugerido'), 'badge de downgrade aparece pra l2');
assert(htmlComparacao.includes('id="faturaMonitorIncluir"') && !htmlComparacao.includes('id="faturaMonitorQtd"'), 'checkbox do Claro Monitor existe, desmarcado (campo de qtde so aparece quando marcado)');
assert(htmlComparacao.includes('id="btnAddFaturaInc"'), 'botao de adicionar incremento existe');
assert(htmlComparacao.includes('id="btnGerarPropostaFatura"'), 'botao "Gerar proposta com essas escolhas" existe');
// troca manual: escolhas.porLinha sobrescreve a sugestao automatica
const escolhasComTroca = JSON.parse(JSON.stringify(escolhasTeste));
escolhasComTroca.porLinha[0] = { offerId: 'p57-150' };
const htmlComTroca = window.renderFaturaComparacao(linhasExtraidas, escolhasComTroca);
assert(htmlComTroca.includes('<option value="p57-150" selected>'), 'troca manual de plano na l1 e respeitada no select (150GB em vez da sugestao de 12GB)');

// --- 13) gerarPropostaDaFatura(): conecta a analise ao motor de proposta existente (pedido do
// usuario, 22/09/2026 — "conectar ao motor de proposta") ---
const stateTesteProposta = {
  nomeCliente: 'Empresa Consumo Teste',
  linhas: linhasExtraidas,
  escolhas: {
    porLinha: linhasExtraidas.map(() => ({ offerId: null })), // todas seguem a sugestao automatica
    monitorIncluir: true,
    monitorQtd: 3,
    incrementos: [{ offerId: 'p57-12', qtd: 1 }],
  },
};
window.gerarPropostaDaFatura(linhasExtraidas, stateTesteProposta);
assert(document.getElementById('proposalOverlay').classList.contains('active'), 'gerarPropostaDaFatura abre o modal de proposta');
assert(!document.getElementById('faturaOverlay').classList.contains('active'), 'gerarPropostaDaFatura fecha o modal de analise de fatura');
// proposalState e um "let" no escopo do script principal (nao vira propriedade de window) — como o
// testScript e concatenado e avaliado junto com jsCode num unico window.eval(), o identificador
// solto (sem "window.") resolve pro mesmo binding usado internamente por openProposal().
assert(proposalState.avulsa === false, 'proposta gerada da fatura NAO e avulsa (e uma renovacao — o cliente ja e Claro)');
assert(proposalState.client.razao_social === 'Empresa Consumo Teste', 'nome do cliente informado na analise vira o razao_social da proposta');
assert(proposalState.client.linhas_voz === 3, 'linhas_voz do cliente sintetico = numero de linhas da fatura (3)');
assert(Math.abs(proposalState.client.valor_contrato - 182.47) < 0.01, 'valor_contrato do cliente sintetico = soma dos valorMensal das 3 linhas (48,49+58,99+74,99=182,47)');
// l1 (manter->12GB) e l2 (downgrade->12GB) sugerem o MESMO plano -> devem virar 1 grupo so, qtd 2;
// l3 (upgrade->70GB, p60-70) fica num grupo separado, qtd 1 -- prova que renewGrupos agrupa por
// oferta escolhida, nao 1 grupo por linha
const grupoP5712 = proposalState.renewGrupos.find(g => g.offerId === 'p57-12');
const grupoP6070 = proposalState.renewGrupos.find(g => g.offerId === 'p60-70');
assert(proposalState.renewGrupos.length === 2, 'renewGrupos tem 2 grupos (l1+l2 mesmo plano viram 1 grupo, l3 fica separado) — achou ' + proposalState.renewGrupos.length);
assert(!!grupoP5712 && grupoP5712.qtd === 2, 'grupo do plano 12GB tem qtd=2 (l1 + l2, mesmo plano sugerido) — achou ' + (grupoP5712 && grupoP5712.qtd));
assert(!!grupoP6070 && grupoP6070.qtd === 1, 'grupo do plano 70GB (p60-70) tem qtd=1 (so l3) — achou ' + (grupoP6070 && grupoP6070.qtd));

// --- 13b) situacaoAtualGrupos (23/09/2026, pedido do usuario — "retirar da analise da fatura os
// planos ja existentes... nao precisa colocar manualmente"): agrupado pelo plano ATUAL de cada
// linha (GB + valor mensal), nao pela sugestao de renovacao — as 3 linhas da fixture tem planos
// atuais diferentes entre si (10GB/48,49, 20GB/58,99, 50GB/74,99), entao viram 3 grupos, cada 1 com qtd 1 ---
assert(proposalState.situacaoAtualGrupos.length === 3, 'situacaoAtualGrupos tem 3 grupos (planos atuais diferentes entre as 3 linhas) — achou ' + proposalState.situacaoAtualGrupos.length);
const grupoAtual10 = proposalState.situacaoAtualGrupos.find(g => g.gb === 10);
const grupoAtual20 = proposalState.situacaoAtualGrupos.find(g => g.gb === 20);
const grupoAtual50 = proposalState.situacaoAtualGrupos.find(g => g.gb === 50);
assert(!!grupoAtual10 && grupoAtual10.qtd === 1 && Math.abs(grupoAtual10.valorUnit - 48.49) < 0.01, 'grupo do plano atual 10GB: qtd 1, valor 48,49 — achou ' + JSON.stringify(grupoAtual10));
assert(!!grupoAtual20 && grupoAtual20.qtd === 1 && Math.abs(grupoAtual20.valorUnit - 58.99) < 0.01, 'grupo do plano atual 20GB: qtd 1, valor 58,99 — achou ' + JSON.stringify(grupoAtual20));
assert(!!grupoAtual50 && grupoAtual50.qtd === 1 && Math.abs(grupoAtual50.valorUnit - 74.99) < 0.01, 'grupo do plano atual 50GB: qtd 1, valor 74,99 — achou ' + JSON.stringify(grupoAtual50));
assert(proposalState.incluirExtras === true, 'Claro Monitor marcado na analise -> incluirExtras=true na proposta');
assert(proposalState.extras[0].tipo === 'monitor' && proposalState.extras[0].qtd === 3, 'extras[0] e o Claro Monitor com qtd=3 (monitorQtd escolhido na analise)');
assert(proposalState.incluirIncremento === true, 'incremento marcado na analise -> incluirIncremento=true na proposta');
assert(proposalState.incrementos[0].offerId === 'p57-12' && proposalState.incrementos[0].qtd === 1, 'incrementos[0] reflete a escolha feita na analise (p57-12, qtd 1)');
document.getElementById('proposalClose').click();

// --- 13c) linhas com o MESMO plano atual (mesmo GB + mesmo valor) devem somar na mesma qtd, em vez
// de virar um grupo por linha — cenario sintetico (2 linhas de 10GB/48,49 + 1 linha de 20GB/58,99) ---
const linhasComPlanoRepetido = [
  { ddd:'17', telefone:'(17) 90000 0001', numero:'900000001', valorMensal:48.49, planoGb:10, internetMbUtilizado:0 },
  { ddd:'17', telefone:'(17) 90000 0002', numero:'900000002', valorMensal:48.49, planoGb:10, internetMbUtilizado:0 },
  { ddd:'17', telefone:'(17) 90000 0003', numero:'900000003', valorMensal:58.99, planoGb:20, internetMbUtilizado:0 },
];
window.gerarPropostaDaFatura(linhasComPlanoRepetido, { nomeCliente: 'Empresa Plano Repetido', linhas: linhasComPlanoRepetido, escolhas: { porLinha: linhasComPlanoRepetido.map(() => ({offerId:null})), monitorIncluir:false, monitorQtd:0, incrementos:[] } });
assert(proposalState.situacaoAtualGrupos.length === 2, 'linhas com o mesmo plano atual (2x 10GB/48,49) somam num grupo so — achou ' + proposalState.situacaoAtualGrupos.length + ' grupos');
const grupoRepetido10 = proposalState.situacaoAtualGrupos.find(g => g.gb === 10);
assert(!!grupoRepetido10 && grupoRepetido10.qtd === 2, 'grupo repetido de 10GB tem qtd=2 (as 2 linhas iguais somadas) — achou ' + (grupoRepetido10 && grupoRepetido10.qtd));
document.getElementById('proposalClose').click();

// --- 14) fatura escaneada: aceitar .md/.txt como entrada alternativa (pedido do usuario,
// 22/09/2026 — fatura real UMUNIDADEMEDICA.pdf era PDF escaneado, sem camada de texto, so pdf.js
// nao achava nada pra extrair; ver REGRAS_NEGOCIO.md secao 23.7). Mesma fixture da fatura, so que
// entregue como texto puro via file.text() em vez de pdf.js/arrayBuffer — o parser por tras
// (extractFaturaLinhas) e o mesmo, entao o resultado deve ser identico ao caminho PDF. ---
document.getElementById('btnAbrirAnaliseFatura').click();
document.getElementById('faturaDdd').value = '11';
const fakeFileMd = { name: 'fatura_setembro_transcrita.md', size: 2048, type: 'text/markdown', text: async () => faturaFixture };
Object.defineProperty(fileInput, 'files', { value: [fakeFileMd], configurable: true });
fileInput.dispatchEvent(new window.Event('change'));
assert(document.getElementById('faturaArquivoInfo').textContent.includes('fatura_setembro_transcrita.md'), 'nome do arquivo .md aparece apos selecionar');
document.getElementById('faturaNomeCliente').value = 'Empresa Teste MD Ltda';
document.getElementById('btnAnalisarFatura').click();
await lastAnalise;
assert(errEl.style.display !== 'block', 'arquivo .md nao mostra erro (leitura de texto puro funciona)');
assert(resultEl.style.display === 'block', 'area de resultado aparece apos analisar arquivo .md');
assert(resultEl.innerHTML.includes('fatura_setembro_transcrita.md'), 'resultado menciona o nome do arquivo .md anexado');
assert(resultEl.innerHTML.includes('3 linha'), 'arquivo .md: as mesmas 3 linhas da fixture sao identificadas (parser identico ao do PDF)');
assert(/[-+]R\\$/.test(resultEl.innerHTML), 'arquivo .md: diferenca de valor por linha calculada normalmente (formato -R$/+R$)');

// --- 15) arquivo .txt tambem funciona (mesma logica, extensao diferente) ---
document.getElementById('btnAbrirAnaliseFatura').click();
document.getElementById('faturaDdd').value = '11';
const fakeFileTxt = { name: 'fatura_outubro.txt', size: 2048, type: 'text/plain', text: async () => faturaFixture };
Object.defineProperty(fileInput, 'files', { value: [fakeFileTxt], configurable: true });
fileInput.dispatchEvent(new window.Event('change'));
document.getElementById('btnAnalisarFatura').click();
await lastAnalise;
assert(errEl.style.display !== 'block', 'arquivo .txt tambem e aceito sem erro');
assert(resultEl.innerHTML.includes('3 linha'), 'arquivo .txt: mesmas 3 linhas identificadas');

// --- 16) banda larga (Claro Fibra / Oferta de Convergencia) como produto adicional (22/09/2026,
// pedido do usuario: "incluir a banda larga como opcao de produto adicional... tem a convergencia
// com bonus"). Desligada por padrao (nao mostra o select de combo); ligando, sempre aparece um
// combo pre-selecionado (mesmo padrao de auto-pick do "Gerar Proposta") ---
const escolhasSemFibra = {
  porLinha: linhasExtraidas.map(() => ({ offerId: null })),
  monitorIncluir: false, monitorQtd: linhasExtraidas.length, incrementos: [],
  fibraIncluir: false, fibraComboId: null,
};
// 23/09/2026: renderFaturaComparacao(linhas, escolhas, client) passa a decidir combos regionais
// pelo DDD do ENDERECO FISCAL (client.ddd), nao mais pelo DDD da 1a linha telefonica da fatura —
// passamos um client explicito aqui (em vez de depender do default faturaState.ddd, que outros
// passos deste arquivo ja mudaram pra '11') pra manter o cenario "DDD 17, dentro da regiao"
// deterministico independente da ordem dos testes.
const clienteFibraTeste = { ddd: '17' };
const htmlSemFibra = window.renderFaturaComparacao(linhasExtraidas, escolhasSemFibra, clienteFibraTeste);
assert(htmlSemFibra.includes('id="faturaFibraIncluir"'), 'checkbox de banda larga (Claro Fibra) existe');
assert(!htmlSemFibra.includes('id="faturaFibraCombo"'), 'com o toggle desligado, o select de combo nao aparece');
assert(htmlSemFibra.includes('sempre vendida junto com uma linha móvel'), 'aviso explica que fibra e sempre venda casada (convergencia)');

const escolhasComFibra = {
  porLinha: linhasExtraidas.map(() => ({ offerId: null })),
  monitorIncluir: false, monitorQtd: linhasExtraidas.length, incrementos: [],
  fibraIncluir: true, fibraComboId: null, // null = auto-pick decide pelo DDD do endereco fiscal (client.ddd)
};
const htmlComFibra = window.renderFaturaComparacao(linhasExtraidas, escolhasComFibra, clienteFibraTeste);
assert(htmlComFibra.includes('id="faturaFibraCombo"'), 'com o toggle ligado, o select de combo aparece');
// DDD fiscal 17 esta na lista regional do combo conv-1giga-15gb (RSC/RSI, DDD 12 a 19) -> e o 1o
// combo "aplicavel" da lista -> auto-pick escolhe ele e grava em escolhas.fibraComboId (efeito
// colateral do render, mesmo padrao ja usado no auto-pick de convergencia do "Gerar Proposta")
assert(escolhasComFibra.fibraComboId === 'conv-1giga-15gb', 'auto-pick escolhe o combo aplicavel pro DDD fiscal do cliente (17) — achou ' + escolhasComFibra.fibraComboId);
assert(htmlComFibra.includes('<option value="conv-1giga-15gb" selected>'), 'select de combo ja vem com o combo auto-escolhido pre-selecionado');
assert(htmlComFibra.includes('Mega Bônus'), 'aviso explica que o combo ja ativa o Mega Bônus de dados (bonus da convergencia)');

// --- 17) gerarPropostaDaFatura() propaga a escolha de banda larga pro motor de proposta (usa
// usarConvergenciaPresetOverride/convergenciaPresetIdOverride, mesmo padrao do Claro Monitor/
// incremento) ---
const stateComFibra = {
  nomeCliente: 'Empresa Fibra Teste',
  linhas: linhasExtraidas,
  escolhas: {
    porLinha: linhasExtraidas.map(() => ({ offerId: null })),
    monitorIncluir: false, monitorQtd: linhasExtraidas.length, incrementos: [],
    fibraIncluir: true, fibraComboId: 'conv-800mega-40gb',
  },
};
window.gerarPropostaDaFatura(linhasExtraidas, stateComFibra);
assert(proposalState.usarConvergenciaPreset === true, 'banda larga marcada na analise -> usarConvergenciaPreset=true na proposta');
assert(proposalState.convergenciaPresetId === 'conv-800mega-40gb', 'combo escolhido na analise chega intacto na proposta — achou ' + proposalState.convergenciaPresetId);
document.getElementById('proposalClose').click();

const stateSemFibra = {
  nomeCliente: 'Empresa Sem Fibra',
  linhas: linhasExtraidas,
  escolhas: {
    porLinha: linhasExtraidas.map(() => ({ offerId: null })),
    monitorIncluir: false, monitorQtd: linhasExtraidas.length, incrementos: [],
    fibraIncluir: false, fibraComboId: null,
  },
};
window.gerarPropostaDaFatura(linhasExtraidas, stateSemFibra);
assert(proposalState.usarConvergenciaPreset === false, 'sem banda larga marcada na analise -> usarConvergenciaPreset=false na proposta (nao liga sozinho)');
document.getElementById('proposalClose').click();

// --- 18) multiplas faturas (23/09/2026, pedido do usuario: "liberar a opcao de inserir mais de uma
// fatura... para que possa efetuar o calculo da media de utilizacao de cada linha e outras
// informacoes") --- fixture de uma "2a fatura" (mes seguinte) com: l1 (992199652) mesmo plano 10GB
// mas valor/consumo diferentes; l2 (992443093) com plano MUDOU pra 30GB (upgrade no periodo) e
// valor/consumo diferentes; l3 (997081735) NAO aparece nessa fatura (linha ausente num dos meses) ---
const faturaFixtureMes2 = \`
DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (17) 99219 9652
Mensalidades e Pacotes Promocionais
Descricao Total (R$)
Oferta Conjunta Claro MIX 50,00
Claro Monitor lite -
Claro Pos 10GB -
Aplicativos Digitais -
TOTAL R$ 50,00
Internet (MB)
Servico Mbytes Utilizados Tarifa (R$) Valor Total (R$) Valor Cobrado (R$)
Internet 0,090 0,00 0,00 0,00
Subtotal 0,090 0,00
DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (17) 99244 3093
Mensalidades e Pacotes Promocionais
Descricao Total (R$)
Oferta Conjunta Claro MIX 70,00
Claro Monitor lite -
Claro Pos 30GB -
Aplicativos Digitais -
TOTAL R$ 70,00
Internet (MB)
Servico Mbytes Utilizados Tarifa (R$) Valor Total (R$) Valor Cobrado (R$)
Internet 200,000 0,00 0,00 0,00
Subtotal 200,000 0,00
\`;

// --- 18a) mesclarLinhasFaturas() isolada: com 1 fatura so, o resultado bate com extractFaturaLinhas
// direto (nao muda o fluxo de sempre) ---
const linhasMes1 = window.extractFaturaLinhas(faturaFixture);
const mesclado1Fatura = window.mesclarLinhasFaturas([linhasMes1]);
assert(mesclado1Fatura.length === 3, 'mesclarLinhasFaturas com 1 fatura so mantem as 3 linhas');
const merge1l1 = mesclado1Fatura.find(l => l.numero === '992199652');
assert(merge1l1.planoGb === 10 && merge1l1.valorMensal === 48.49, 'com 1 fatura, planoGb/valorMensal da mescla batem com o valor original (sem media nenhuma)');
assert(Math.abs(merge1l1.internetMbUtilizado - 0.05) < 0.001, 'com 1 fatura, internetMbUtilizado da mescla bate com o original (0,05MB)');
assert(merge1l1.qtdFaturasEncontrada === 1 && merge1l1.totalFaturas === 1, 'com 1 fatura, qtdFaturasEncontrada=totalFaturas=1');

// --- 18b) mesclarLinhasFaturas() com 2 faturas: media de consumo/valor, faixa min-max, linha
// ausente numa fatura, plano que mudou no periodo ---
const linhasMes2 = window.extractFaturaLinhas(faturaFixtureMes2);
assert(linhasMes2.length === 2, 'fixture da 2a fatura tem 2 linhas (l3 nao aparece nesse mes)');
const mesclado2Faturas = window.mesclarLinhasFaturas([linhasMes1, linhasMes2]);
assert(mesclado2Faturas.length === 3, 'mesclarLinhasFaturas junta as linhas das 2 faturas pelo numero (3 linhas unicas no total)');

const m1 = mesclado2Faturas.find(l => l.numero === '992199652');
assert(!!m1, 'linha 992199652 (presente nas 2 faturas) foi encontrada na mescla');
assert(Math.abs(m1.valorMensal - 49.245) < 0.01, 'valorMensal medio de l1 = (48,49+50,00)/2 = 49,245 — achou ' + m1.valorMensal);
assert(Math.abs(m1.internetMbUtilizado - 0.07) < 0.001, 'internetMbUtilizado medio de l1 = (0,05+0,09)/2 = 0,07MB — achou ' + m1.internetMbUtilizado);
assert(m1.qtdFaturasEncontrada === 2 && m1.totalFaturas === 2, 'l1 apareceu nas 2 faturas anexadas (2/2)');
assert(m1.planoGbDistintos.length === 1 && m1.planoGbDistintos[0] === 10, 'l1 manteve o mesmo plano (10GB) nas 2 faturas — sem variacao');

const m2 = mesclado2Faturas.find(l => l.numero === '992443093');
assert(!!m2, 'linha 992443093 (mudou de plano entre as faturas) foi encontrada na mescla');
assert(Math.abs(m2.valorMensal - 64.495) < 0.01, 'valorMensal medio de l2 = (58,99+70,00)/2 = 64,495 — achou ' + m2.valorMensal);
assert(Math.abs(m2.internetMbUtilizado - 150) < 0.001, 'internetMbUtilizado medio de l2 = (100+200)/2 = 150MB — achou ' + m2.internetMbUtilizado);
assert(m2.internetMbMin === 100 && m2.internetMbMax === 200, 'l2 guarda a faixa min/max de consumo observada (100 a 200MB)');
assert(m2.planoGbDistintos.length === 2 && m2.planoGbDistintos.includes(20) && m2.planoGbDistintos.includes(30), 'l2 registra os 2 planos distintos vistos no periodo (20GB e 30GB) — achou ' + JSON.stringify(m2.planoGbDistintos));
assert(m2.planoGb === 30, 'l2: plano usado pra sugestao e o da fatura mais recente (30GB, ultima anexada) — achou ' + m2.planoGb);

const m3 = mesclado2Faturas.find(l => l.numero === '997081735');
assert(!!m3, 'linha 997081735 (so aparece na 1a fatura) ainda entra na mescla');
assert(m3.qtdFaturasEncontrada === 1 && m3.totalFaturas === 2, 'l3 apareceu em so 1 das 2 faturas anexadas (1/2) — linha ausente sinalizavel na UI');
assert(m3.valorMensal === 74.99 && Math.abs(m3.internetMbUtilizado - 60000) < 0.001, 'l3 sem 2a fatura: media cai no unico valor que existe (nao quebra, nao vira 0)');

// --- 18c) UI: seletor "Quantidade de faturas" recria os inputs de arquivo e o estado ---
document.getElementById('btnAbrirAnaliseFatura').click();
document.getElementById('faturaDdd').value = '11';
const qtdSelect = document.getElementById('faturaQtd');
assert(!!qtdSelect, 'select de quantidade de faturas existe');
assert(qtdSelect.value === '1', 'select de quantidade comeca em 1 fatura (padrao, mesmo fluxo de sempre)');
assert(!!document.getElementById('faturaArquivo') && !document.getElementById('faturaArquivo2'), 'com qtd=1, so existe o input unico faturaArquivo (compatibilidade com o fluxo de 1 fatura)');

qtdSelect.value = '2';
qtdSelect.dispatchEvent(new window.Event('change'));
assert(!!document.getElementById('faturaArquivo') && !!document.getElementById('faturaArquivo2'), 'com qtd=2, aparecem os inputs faturaArquivo e faturaArquivo2');
assert(faturaState.files.length === 2 && faturaState.files[0] === null && faturaState.files[1] === null, 'trocar a quantidade reseta faturaState.files (2 posicoes vazias)');

// clicar Analisar sem anexar as 2 faturas -> erro (mesmo padrao de validacao do fluxo de 1 fatura)
document.getElementById('btnAnalisarFatura').click();
assert(errEl.style.display === 'block', 'com qtd=2 e nenhum arquivo anexado, clicar Analisar mostra erro');

// --- 18d) fluxo completo: anexar as 2 faturas (.txt, pra nao depender do mock global de pdf.js,
// que so devolve 1 texto fixo pra qualquer arquivo) e analisar ---
const fileInput1 = document.getElementById('faturaArquivo');
const fileInput2 = document.getElementById('faturaArquivo2');
const fakeFileMes1 = { name: 'fatura_julho.txt', size: 1024, type: 'text/plain', text: async () => faturaFixture };
const fakeFileMes2 = { name: 'fatura_agosto.txt', size: 1024, type: 'text/plain', text: async () => faturaFixtureMes2 };
Object.defineProperty(fileInput1, 'files', { value: [fakeFileMes1], configurable: true });
fileInput1.dispatchEvent(new window.Event('change'));
Object.defineProperty(fileInput2, 'files', { value: [fakeFileMes2], configurable: true });
fileInput2.dispatchEvent(new window.Event('change'));
assert(document.getElementById('faturaArquivoInfo').textContent.includes('fatura_julho.txt'), 'info da fatura 1 mostra o nome do arquivo selecionado');
assert(document.getElementById('faturaArquivoInfo2').textContent.includes('fatura_agosto.txt'), 'info da fatura 2 mostra o nome do arquivo selecionado');

document.getElementById('faturaNomeCliente').value = 'Empresa Multi Fatura';
document.getElementById('btnAnalisarFatura').click();
await lastAnalise;
assert(errEl.style.display !== 'block', 'com as 2 faturas anexadas, Analisar nao mostra erro');
assert(resultEl.innerHTML.includes('fatura_julho.txt') && resultEl.innerHTML.includes('fatura_agosto.txt'), 'resultado menciona os nomes das 2 faturas anexadas');
assert(resultEl.innerHTML.includes('média de 2 faturas'), 'resultado avisa que os valores sao a media de 2 faturas');
assert(resultEl.innerHTML.includes('achada em 1 de 2 faturas'), 'resultado sinaliza a linha que so apareceu numa das 2 faturas (l3)');
assert(resultEl.innerHTML.includes('plano mudou no período'), 'resultado sinaliza a linha cujo plano contratado mudou entre as faturas (l2)');
assert(faturaState.linhas.length === 3, 'faturaState.linhas junta as 3 linhas unicas das 2 faturas');

// gerarPropostaDaFatura com as linhas mescladas (media) continua funcionando normalmente
const stateMultiFatura = {
  nomeCliente: 'Empresa Multi Fatura',
  linhas: faturaState.linhas,
  escolhas: {
    porLinha: faturaState.linhas.map(() => ({ offerId: null })),
    monitorIncluir: false, monitorQtd: faturaState.linhas.length, incrementos: [],
    fibraIncluir: false, fibraComboId: null,
  },
};
window.gerarPropostaDaFatura(faturaState.linhas, stateMultiFatura);
assert(proposalState.client.linhas_voz === 3, 'proposta gerada da analise multi-fatura tem as 3 linhas unicas');
const valorContratoEsperado = m1.valorMensal + m2.valorMensal + m3.valorMensal;
assert(Math.abs(proposalState.client.valor_contrato - valorContratoEsperado) < 0.01, 'valor_contrato da proposta usa os valores MEDIOS de cada linha, nao o de uma fatura isolada');
document.getElementById('proposalClose').click();

// --- 18e) voltar a quantidade pra 1 remove o input extra e reseta o estado ---
qtdSelect.value = '1';
qtdSelect.dispatchEvent(new window.Event('change'));
assert(!document.getElementById('faturaArquivo2'), 'voltar pra qtd=1 remove o input extra faturaArquivo2');
assert(faturaState.files.length === 1, 'voltar pra qtd=1 reduz faturaState.files pra 1 posicao');

// --- 19) baixar PDF da analise pro cliente (23/09/2026, pedido do usuario: "gerar um pdf ou uma
// imagem para envio ao cliente com essa analise, deixe formatado para ser de facil entendimento e
// amigavel visualmente") — usa o resultado ainda renderizado na tela do passo 18d (analise
// multi-fatura), que ja tem o botao "Baixar PDF para o cliente" religado ---
window.__testPdfCalls.length = 0;
const btnPdfFatura = document.getElementById('btnBaixarAnaliseFaturaPdf');
assert(!!btnPdfFatura, 'botao "Baixar PDF para o cliente" existe no resultado da analise');
btnPdfFatura.click();
const pdfTextosFatura = window.__testPdfCalls.filter(c => c[0] === 'text').map(c => String(c[1][0]));
assert(pdfTextosFatura.some(t => t.includes('RESUMO DA SUA FATURA')), 'PDF do cliente tem o titulo "RESUMO DA SUA FATURA"');
assert(pdfTextosFatura.some(t => t.includes('média de 2 faturas')), 'PDF do cliente avisa que os valores sao a media das faturas analisadas (cenario multi-fatura do passo 18d)');
assert(pdfTextosFatura.some(t => t === 'LINHA') && pdfTextosFatura.some(t => t === 'PLANO SUGERIDO') && pdfTextosFatura.some(t => t === 'DIFERENÇA'), 'PDF do cliente tem a tabela com cabecalho Linha/Plano sugerido/Diferenca');
const saveCallsFatura = window.__testPdfCalls.filter(c => c[0] === 'save');
assert(saveCallsFatura.length === 1 && String(saveCallsFatura[0][1][0]).startsWith('analise_fatura_'), 'PDF do cliente e salvo com nome comecando em "analise_fatura_" — achou ' + (saveCallsFatura[0] && saveCallsFatura[0][1][0]));

// com 1 fatura so (fluxo de sempre), o PDF NAO mostra o aviso de media — regressao
window.__testPdfCalls.length = 0;
window.generateFaturaAnalisePDF(linhasExtraidas, escolhasTeste, 'Cliente PDF Teste');
const pdfTextosUnica = window.__testPdfCalls.filter(c => c[0] === 'text').map(c => String(c[1][0]));
assert(!pdfTextosUnica.some(t => t.includes('média de')), 'com 1 fatura so, PDF do cliente NAO mostra o aviso de media (comportamento de sempre)');
assert(pdfTextosUnica.some(t => t === 'Cliente PDF Teste'), 'PDF do cliente mostra o nome do cliente informado');
assert(pdfTextosUnica.some(t => t.includes('RESUMO DA SUA FATURA')), 'PDF do cliente com 1 fatura tambem tem o titulo padrao');


// --- 20) planosRenovacaoCatalogo(client)/sugerirPlanoConsumo(linha, client): elegibilidade
// regional depende do DDD do ENDERECO FISCAL (client.ddd), nao do DDD da linha telefonica da
// fatura (fix 23/09/2026 — "corrigir para o DDD do endereco do cliente", secao 31) ---
const clienteDentroRegiao = { ddd: '17' }; // RSC/RSI, DDD 12 a 19
const clienteForaRegiao = { ddd: '21' }; // Rio de Janeiro, fora da regiao

const catalogoDentro = window.planosRenovacaoCatalogo(clienteDentroRegiao);
assert(catalogoDentro.some(o => o.id === 'p57-15reg'), 'planosRenovacaoCatalogo com DDD 17 (dentro da regiao 12-19) INCLUI a oferta regional p57-15reg');
const catalogoFora = window.planosRenovacaoCatalogo(clienteForaRegiao);
assert(!catalogoFora.some(o => o.id === 'p57-15reg'), 'planosRenovacaoCatalogo com DDD 21 (fora da regiao) EXCLUI a oferta regional p57-15reg');
const catalogoSemClient = window.planosRenovacaoCatalogo();
assert(!catalogoSemClient.some(o => o.id === 'p57-15reg'), 'planosRenovacaoCatalogo sem client nenhum tambem exclui a oferta regional (comportamento seguro por padrao)');

// linha sintetica com plano de 14GB e consumo de 8000MB (~55,8% da franquia de 14336MB) -> cai
// entre os limiares de upgrade(90%)/downgrade(40%), ou seja "manter", sugerindo o MENOR plano do
// catalogo >= 14GB. Com DDD dentro da regiao, esse menor plano e justamente a oferta regional de
// 15GB (p57-15reg); fora da regiao, o mesmo calculo pula pro proximo nacional (30GB, p57-30)
// porque a regional nem entra no catalogo.
const linhaTesteRegional = { ddd: '17', telefone: '(17) 90000 0009', numero: '900000009', valorMensal: 44.99, planoGb: 14, internetMbUtilizado: 8000 };
const sugDentro = window.sugerirPlanoConsumo(linhaTesteRegional, clienteDentroRegiao);
assert(sugDentro.acao === 'manter', 'linha de 14GB com uso de ~55,8% da franquia cai em "manter" (nem upgrade nem downgrade) — achou ' + sugDentro.acao);
assert(sugDentro.oferta && sugDentro.oferta.id === 'p57-15reg', 'com DDD dentro da regiao (17), sugerirPlanoConsumo pode selecionar a oferta regional p57-15reg — achou ' + (sugDentro.oferta && sugDentro.oferta.id));

const sugFora = window.sugerirPlanoConsumo(linhaTesteRegional, clienteForaRegiao);
assert(sugFora.acao === 'manter', 'mesma linha, DDD fora da regiao: continua "manter"');
// fora da regiao, catalogo de renovacao sem a p57-15reg tem varias ofertas de 25GB+ (Pag.60
// inclusive) — a mais proxima por cima de 14GB e a de 25GB (p60-25, R$49,99), nao mais a regional
assert(sugFora.oferta && sugFora.oferta.id === 'p60-25', 'com DDD fora da regiao (21), sugerirPlanoConsumo NUNCA sugere a oferta regional — cai na proxima oferta nacional/pag.60 disponivel (25GB, p60-25) — achou ' + (sugFora.oferta && sugFora.oferta.id));
assert(sugFora.oferta && sugFora.oferta.id !== 'p57-15reg', 'confirma explicitamente que a oferta regional NUNCA e sugerida fora da regiao');

// sugerirPlanoConsumo sem client explicito usa faturaState.ddd (default do parametro) — grava um
// DDD fora da regiao em faturaState.ddd e confirma que o default tambem exclui a oferta regional.
faturaState.ddd = '11';
const sugSemClient = window.sugerirPlanoConsumo(linhaTesteRegional);
assert(sugSemClient.oferta && sugSemClient.oferta.id !== 'p57-15reg', 'sem client explicito, sugerirPlanoConsumo cai no DDD global (faturaState.ddd=11, fora da regiao) e nao sugere a oferta regional');

// --- 21) renderFaturaComparacao(linhas, escolhas, client): o dropdown "Plano proposto" rotula a
// oferta regional com "— confirmar DDD" quando o cliente esta fora da regiao (aviso, NAO bloqueio
// — a oferta continua listada e selecionavel, so avisa que precisa confirmar o DDD) ---
function extrairTextoOption(html, offerId){
  const re = new RegExp('<option value="' + offerId + '"[^>]*>([^<]*)</option>');
  const m = html.match(re);
  return m ? m[1] : null;
}
const escolhasRegionalTeste = {
  porLinha: linhasExtraidas.map(() => ({ offerId: 'p57-15reg' })), // forca a oferta regional em todas as linhas, pra garantir que ela aparece nos 3 selects
  monitorIncluir: false, monitorQtd: linhasExtraidas.length, incrementos: [],
};
const htmlForaRegiao = window.renderFaturaComparacao(linhasExtraidas, JSON.parse(JSON.stringify(escolhasRegionalTeste)), clienteForaRegiao);
const optForaRegiao = extrairTextoOption(htmlForaRegiao, 'p57-15reg');
assert(!!optForaRegiao, 'com DDD fora da regiao, a oferta regional p57-15reg ainda aparece listada no dropdown (nao e removida, so avisada)');
assert(optForaRegiao.includes('confirmar DDD'), 'com DDD fora da regiao, o texto da oferta regional inclui o aviso "— confirmar DDD" — achou: ' + optForaRegiao);

const htmlDentroRegiao = window.renderFaturaComparacao(linhasExtraidas, JSON.parse(JSON.stringify(escolhasRegionalTeste)), clienteDentroRegiao);
const optDentroRegiao = extrairTextoOption(htmlDentroRegiao, 'p57-15reg');
assert(!!optDentroRegiao, 'com DDD dentro da regiao, a oferta regional p57-15reg aparece listada no dropdown');
assert(!optDentroRegiao.includes('confirmar DDD'), 'com DDD dentro da regiao, o texto da oferta regional NAO inclui o aviso "— confirmar DDD" — achou: ' + optDentroRegiao);

// --- 22) gerarPropostaDaFatura(): o cliente sintetico da proposta usa o DDD do ENDERECO FISCAL
// (state.ddd, preenchido no campo faturaDdd do modal), nao o DDD da linha telefonica da fatura
// (linhas[0].ddd) — fixture onde os dois DDDs sao propositalmente diferentes (linha telefonica no
// DDD 11, mas endereco fiscal informado como DDD 21) pra provar que a proposta usa o certo ---
const linhasDddDivergente = [
  { ddd: '11', telefone: '(11) 90000 0001', numero: '900000001', valorMensal: 48.49, planoGb: 10, internetMbUtilizado: 50 },
];
const stateDddDivergente = {
  nomeCliente: 'Empresa DDD Divergente',
  ddd: '21', // DDD do endereco fiscal informado no modal — diferente do DDD da linha (11) acima
  linhas: linhasDddDivergente,
  escolhas: {
    porLinha: linhasDddDivergente.map(() => ({ offerId: null })),
    monitorIncluir: false, monitorQtd: 0, incrementos: [],
  },
};
window.gerarPropostaDaFatura(linhasDddDivergente, stateDddDivergente);
assert(proposalState.client.ddd === '21', 'gerarPropostaDaFatura usa state.ddd (DDD fiscal, 21) no cliente sintetico da proposta, NAO linhas[0].ddd (DDD da linha telefonica, 11) — achou ' + proposalState.client.ddd);
assert(proposalState.client.ddd !== linhasDddDivergente[0].ddd, 'confirma que o DDD da proposta e diferente do DDD da linha telefonica (prova que nao usa mais linhas[0].ddd)');
document.getElementById('proposalClose').click();

// --- 23) campo CNPJ (opcional) na Analisar Fatura (pedido do usuario, 24/09/2026 — "na proposta
// gerada... nao tem o campo onde colocamos o CNPJ, esta aparecendo em branco"): antes,
// gerarPropostaDaFatura() sempre montava o cliente sintetico com cnpj: '' fixo. Agora existe o
// campo #faturaCnpj (opcional, mesmo padrao do #faturaNomeCliente) que alimenta faturaState.cnpj e
// chega ate o cliente sintetico da proposta ---

// 23a) preencher #faturaCnpj e seguir o fluxo completo (anexar fatura, DDD, Analisar, Gerar
// proposta com essas escolhas) -> proposalState.client.cnpj bate com o que foi digitado, e o
// mesmo valor chega ate buildPropostaDocModel() (modelo.client.cnpj), que e o campo realmente
// usado no Word/PDF/PDF-cliente.
document.getElementById('btnAbrirAnaliseFatura').click();
document.getElementById('faturaDdd').value = '11';
document.getElementById('faturaNomeCliente').value = 'Empresa CNPJ Teste Ltda';
document.getElementById('faturaCnpj').value = '12.345.678/0001-90';
const fakeFileCnpj = { name: 'fatura_cnpj_teste.pdf', size: 2048, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(0) };
Object.defineProperty(fileInput, 'files', { value: [fakeFileCnpj], configurable: true });
fileInput.dispatchEvent(new window.Event('change'));
window.__mockPdfText = faturaFixture;
document.getElementById('btnAnalisarFatura').click();
await lastAnalise;
assert(errEl.style.display !== 'block', 'com CNPJ preenchido, analisar a fatura nao mostra erro nenhum (campo opcional, sem validacao)');
assert(faturaState.cnpj === '12.345.678/0001-90', 'faturaState.cnpj grava o valor digitado no campo #faturaCnpj apos Analisar');
const btnGerarPropostaCnpj = document.getElementById('btnGerarPropostaFatura');
assert(!!btnGerarPropostaCnpj, 'botao "Gerar proposta com essas escolhas" existe apos a analise (fluxo com CNPJ)');
btnGerarPropostaCnpj.click();
assert(document.getElementById('proposalOverlay').classList.contains('active'), 'Gerar proposta com essas escolhas abre o modal de proposta');
assert(proposalState.client.cnpj === '12.345.678/0001-90', 'proposalState.client.cnpj bate com o CNPJ digitado no modal Analisar Fatura — achou ' + JSON.stringify(proposalState.client.cnpj));
const modeloComCnpj = window.buildPropostaDocModel();
assert(modeloComCnpj.client.cnpj === '12.345.678/0001-90', 'buildPropostaDocModel(): modelo.client.cnpj (campo usado no Word/PDF/PDF-cliente) tambem bate com o CNPJ digitado — achou ' + JSON.stringify(modeloComCnpj.client.cnpj));
document.getElementById('proposalClose').click();

// 23b) deixar #faturaCnpj em branco (nunca tocado): nao bloqueia a analise (nao e bundlado na
// validacao obrigatoria do DDD) e o cliente sintetico da proposta recebe cnpj === '' (string
// vazia, nao undefined/null) — regressao explicita do bug relatado pelo usuario.
document.getElementById('btnAbrirAnaliseFatura').click();
document.getElementById('faturaDdd').value = '11';
document.getElementById('faturaNomeCliente').value = 'Empresa Sem CNPJ Ltda';
assert(document.getElementById('faturaCnpj').value === '', 'campo #faturaCnpj comeca vazio nesse novo ciclo (nao foi tocado)');
const fakeFileSemCnpj = { name: 'fatura_sem_cnpj.pdf', size: 2048, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(0) };
Object.defineProperty(fileInput, 'files', { value: [fakeFileSemCnpj], configurable: true });
fileInput.dispatchEvent(new window.Event('change'));
document.getElementById('btnAnalisarFatura').click();
await lastAnalise;
assert(errEl.style.display !== 'block', 'com CNPJ em branco, analisar a fatura NAO mostra erro (CNPJ nao entra na validacao obrigatoria, so o DDD)');
assert(resultEl.style.display === 'block', 'com CNPJ em branco, o resultado da analise aparece normalmente');
assert(faturaState.cnpj === '', 'faturaState.cnpj fica em string vazia quando o campo nao foi preenchido (nao undefined, nao null)');
const btnGerarPropostaSemCnpj = document.getElementById('btnGerarPropostaFatura');
btnGerarPropostaSemCnpj.click();
assert(proposalState.client.cnpj === '', 'sem CNPJ informado, proposalState.client.cnpj e string vazia — achou ' + JSON.stringify(proposalState.client.cnpj));
assert(proposalState.client.cnpj !== undefined && proposalState.client.cnpj !== null, 'proposalState.client.cnpj nunca e undefined/null, mesmo sem CNPJ informado');
const modeloSemCnpj = window.buildPropostaDocModel();
assert(modeloSemCnpj.client.cnpj === '', 'buildPropostaDocModel(): modelo.client.cnpj tambem fica em string vazia quando nao ha CNPJ (nao aparece "undefined" no Word/PDF)');
document.getElementById('proposalClose').click();

// 23c) reabrir o modal via #btnAbrirAnaliseFatura reseta #faturaCnpj e faturaState.cnpj, mesmo
// padrao ja usado pro reset do nome do cliente/DDD (evita que o CNPJ de uma analise anterior
// vaze pra proxima) ---
document.getElementById('btnAbrirAnaliseFatura').click();
document.getElementById('faturaCnpj').value = '98.765.432/0001-10';
faturaState.cnpj = '98.765.432/0001-10'; // simula estado de uma analise anterior ja concluida
document.getElementById('btnAbrirAnaliseFatura').click();
assert(document.getElementById('faturaCnpj').value === '', 'reabrir o modal (#btnAbrirAnaliseFatura) reseta o campo #faturaCnpj pra vazio');
assert(faturaState.cnpj === '', 'reabrir o modal (#btnAbrirAnaliseFatura) reseta faturaState.cnpj pra string vazia');

// 23d) chamada direta de gerarPropostaDaFatura() com um state.cnpj explicito (sem passar pela UI)
// — cobre a funcao isolada, como pedido: cliente sintetico usa state.cnpj || '' ---
document.getElementById('btnAbrirAnaliseFatura').click();
const linhasCnpjDireto = [
  { ddd: '11', telefone: '(11) 90000 0002', numero: '900000002', valorMensal: 48.49, planoGb: 10, internetMbUtilizado: 50 },
];
const stateCnpjDireto = {
  nomeCliente: 'Empresa Chamada Direta',
  cnpj: '11.222.333/0001-44',
  ddd: '11',
  linhas: linhasCnpjDireto,
  escolhas: {
    porLinha: linhasCnpjDireto.map(() => ({ offerId: null })),
    monitorIncluir: false, monitorQtd: 0, incrementos: [],
  },
};
window.gerarPropostaDaFatura(linhasCnpjDireto, stateCnpjDireto);
assert(proposalState.client.cnpj === '11.222.333/0001-44', 'gerarPropostaDaFatura() chamada direto com state.cnpj explicito grava o mesmo CNPJ no cliente sintetico — achou ' + JSON.stringify(proposalState.client.cnpj));
document.getElementById('proposalClose').click();

console.log('TODOS OS TESTES DE ANALISAR FATURA PASSARAM');
})().catch(err => { console.error('FALHA ASSINCRONA:', err && err.message ? err.message : err); throw err; });
`;
window.eval(jsCode + testScript);
