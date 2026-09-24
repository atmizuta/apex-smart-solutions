// test_consolidar_valores.js (23/09/2026, novo): cobre proposalState.consolidarValores — quando
// ligado, a Nova Proposta consolida TODAS as linhas móveis (base + incremento) em um único item
// "Linhas móveis" (qtd total + valor total), em vez de detalhar por plano/grupo. Fibra/Passaporte/
// extras manuais NUNCA são consolidados (não são "linhas" comparáveis entre si). Claro Monitor nunca
// aparece como item (vira valorMonitor, independente do modo). Ver buildPropostaDocModel() no
// _template.html e a seção correspondente do REGRAS_NEGOCIO.md.
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

const testScript = `
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  const clienteBase = {
    razao_social: 'CLIENTE CONSOLIDAR TESTE LTDA', cnpj: '11.222.333/0001-44', cidade: 'São Paulo', ddd: '11',
    linhas_voz: 30, valor_contrato: 4500, arpu: 150, cep_cabeado: '01000-000',
  };

  const ofertasRenov = OFFERS_MOBILE.filter(o => (o.tipos||[]).includes('renovacao'));
  const ofertaRenov1 = ofertasRenov[0];
  const ofertaRenov2 = ofertasRenov[1] || ofertasRenov[0];
  const ofertaInc = OFFERS_MOBILE.find(o => (o.tipos||[]).includes('incremento'));

  function montarCenario(consolidar){
    openProposal(clienteBase, { consolidarValoresOverride: consolidar });
    proposalState.renewGrupos = [
      { qtd: 10, offerId: ofertaRenov1.id },
      { qtd: 20, offerId: ofertaRenov2.id },
    ];
    proposalState.incluirIncremento = true;
    proposalState.incrementos = [{ offerId: ofertaInc.id, qtd: 3 }];
    proposalState.incluirFixa = true; // Claro Fibra
    proposalState.incluirPassaporte = true; // Claro Passaporte
    proposalState.incluirExtras = true;
    proposalState.extras = [
      { tipo: 'monitor', valorUnit: 5, qtd: 30 },
      { tipo: 'manual', descricao: 'Instalação de rack dedicado', valorUnit: 350, qtd: 1 },
    ];
  }

  // --- (a) default: consolidarValores nasce false, comportamento itemizado de sempre ---
  openProposal(clienteBase, {});
  assert(proposalState.consolidarValores === false, 'consolidarValores nasce desligado por padrão');
  proposalState.renewGrupos = [{ qtd: 10, offerId: ofertaRenov1.id }, { qtd: 20, offerId: ofertaRenov2.id }];
  let modelo = buildPropostaDocModel();
  assert(modelo.novaProposta.consolidado === false, 'modelo: consolidado false por padrão');
  assert(modelo.novaProposta.itens.filter(it => it.item === 'Renovação').length === 2, 'default: 2 itens de renovação separados (itemizado)');
  assert(!modelo.novaProposta.itens.some(it => it.item === 'Linhas móveis'), 'default: NÃO existe item consolidado "Linhas móveis"');

  // --- (b) consolidarValoresOverride: true + múltiplos baseGrupos/incGrupos -> 1 único item "Linhas móveis" ---
  montarCenario(true);
  assert(proposalState.consolidarValores === true, 'consolidarValoresOverride liga proposalState.consolidarValores');
  modelo = buildPropostaDocModel();
  assert(modelo.novaProposta.consolidado === true, 'modelo: consolidado true');
  const itensMoveis = modelo.novaProposta.itens.filter(it => it.item === 'Linhas móveis');
  assert(itensMoveis.length === 1, 'consolidado: exatamente 1 item "Linhas móveis" (achou ' + itensMoveis.length + ')');
  const qtdTotalEsperada = 10 + 20 + 3; // 2 grupos de renovação + 1 grupo de incremento
  assert(itensMoveis[0].desc.includes(String(qtdTotalEsperada)), 'consolidado: desc menciona a quantidade total de linhas (' + itensMoveis[0].desc + ')');
  const valorEsperadoMoveis = (ofertaRenov1.valor * 10) + (ofertaRenov2.valor * 20) + (ofertaInc.valor * 3);
  assert(Math.abs(itensMoveis[0].subtotal - valorEsperadoMoveis) < 0.01, 'consolidado: subtotal do item consolidado = soma do que seria itemizado (' + itensMoveis[0].subtotal + ' esperado ' + valorEsperadoMoveis + ')');
  assert(!modelo.novaProposta.itens.some(it => it.item === 'Renovação'), 'consolidado: itens individuais de Renovação não aparecem mais');
  assert(!modelo.novaProposta.itens.some(it => it.item === 'Incremento(s)'), 'consolidado: itens individuais de Incremento(s) não aparecem mais');

  // --- (c) mesmo com consolidarValores true, Fibra/Passaporte/manual continuam itemizados separadamente ---
  const itemFibra = modelo.novaProposta.itens.find(it => it.item === 'Claro Fibra');
  const itemPassaporte = modelo.novaProposta.itens.find(it => it.item === 'Claro Passaporte');
  const itemManual = modelo.novaProposta.itens.find(it => it.item === 'Instalação de rack dedicado');
  assert(!!itemFibra, 'consolidado: Claro Fibra continua um item separado, não entra em "Linhas móveis"');
  assert(!!itemPassaporte, 'consolidado: Claro Passaporte continua um item separado');
  assert(!!itemManual, 'consolidado: oferta manual continua itemizada separadamente');
  assert(!modelo.novaProposta.itens.some(it => it.item === 'Claro Monitor'), 'consolidado: Claro Monitor nunca aparece como item (vira valorMonitor + badge)');
  assert(Math.abs(modelo.novaProposta.valorMonitor - 150) < 0.01, 'consolidado: valorMonitor = 5,00 × 30 = 150,00 (' + modelo.novaProposta.valorMonitor + ')');

  // --- (d) consistência do total: soma dos itens visíveis + valorMonitor === destaque.valorProposto,
  // em ambos os modos (consolidado e itemizado), com e sem Claro Monitor incluído ---
  function checarConsistencia(modelo, rotulo){
    const soma = modelo.novaProposta.itens.reduce((s, it) => s + (it.subtotal || 0), 0);
    assert(Math.abs(soma + modelo.novaProposta.valorMonitor - modelo.destaque.valorProposto) < 0.01,
      rotulo + ': soma dos itens + valorMonitor bate com destaque.valorProposto (' + soma + ' + ' + modelo.novaProposta.valorMonitor + ' vs ' + modelo.destaque.valorProposto + ')');
    assert(Math.abs(soma + modelo.novaProposta.valorMonitor - modelo.novaProposta.total) < 0.01,
      rotulo + ': soma dos itens + valorMonitor bate com novaProposta.total');
  }

  checarConsistencia(modelo, 'consolidado com monitor');

  montarCenario(true);
  proposalState.extras = proposalState.extras.filter(e => e.tipo !== 'monitor'); // sem Claro Monitor
  checarConsistencia(buildPropostaDocModel(), 'consolidado sem monitor');

  montarCenario(false);
  checarConsistencia(buildPropostaDocModel(), 'itemizado com monitor');

  montarCenario(false);
  proposalState.extras = proposalState.extras.filter(e => e.tipo !== 'monitor');
  checarConsistencia(buildPropostaDocModel(), 'itemizado sem monitor');

  // ============================================================================================
  // 24/09/2026 (pedido do usuário: "na proposta gerada em pdv[sic: pdf] no campo nova proposta
  // mencionar os planos selecionados para o cliente conforme na situação atual"): mesmo com
  // consolidarValores ligado, o item "Linhas móveis" agora cita os planos (por GB) escolhidos,
  // agrupando grupos diferentes que caem no mesmo GB e ordenando da maior pra menor franquia.
  // Ver o comentário em buildPropostaDocModel() (porGb/planosTxt) e a seção 34 do REGRAS_NEGOCIO.md.
  // ============================================================================================

  const oferta12 = OFFERS_MOBILE.find(o => o.id === 'p57-12'); // 12GB, renovação + incremento
  const oferta40 = OFFERS_MOBILE.find(o => o.id === 'p57-40'); // 40GB, renovação + incremento
  const oferta30 = OFFERS_MOBILE.find(o => o.id === 'p57-30'); // 30GB, renovação

  // --- (e) múltiplos GBs diferentes (renovação 40GB + renovação 12GB) consolidados: desc menciona
  // as duas franquias, da maior pra menor, com a quantidade certa em cada uma ---
  openProposal(clienteBase, { consolidarValoresOverride: true });
  proposalState.renewGrupos = [
    { qtd: 4, offerId: oferta12.id },
    { qtd: 2, offerId: oferta40.id },
  ];
  modelo = buildPropostaDocModel();
  let itemLinhas = modelo.novaProposta.itens.find(it => it.item === 'Linhas móveis');
  assert(!!itemLinhas, 'multi-GB: existe item "Linhas móveis"');
  assert(itemLinhas.desc.indexOf('2× 40GB') < itemLinhas.desc.indexOf('4× 12GB'),
    'multi-GB: desc lista 40GB antes de 12GB (ordem decrescente de franquia) — desc="' + itemLinhas.desc + '"');
  assert(itemLinhas.desc.includes('2× 40GB'), 'multi-GB: desc menciona "2× 40GB" (' + itemLinhas.desc + ')');
  assert(itemLinhas.desc.includes('4× 12GB'), 'multi-GB: desc menciona "4× 12GB" (' + itemLinhas.desc + ')');
  assert(itemLinhas.desc.startsWith('6 linha(s)'), 'multi-GB: qtdTotal = 4+2 = 6 no início da desc (' + itemLinhas.desc + ')');
  let somaVisiveis = modelo.novaProposta.itens.reduce((s, it) => s + (it.subtotal || 0), 0);
  assert(Math.abs(somaVisiveis + modelo.novaProposta.valorMonitor - modelo.destaque.valorProposto) < 0.01,
    'multi-GB: soma dos itens + valorMonitor bate com destaque.valorProposto');

  // --- (f) mesmo GB vindo de grupos diferentes (renovação 12GB + incremento 12GB) deve MESCLAR num
  // único "<soma>× 12GB", não repetir a franquia duas vezes na descrição ---
  openProposal(clienteBase, { consolidarValoresOverride: true });
  proposalState.renewGrupos = [{ qtd: 4, offerId: oferta12.id }];
  proposalState.incluirIncremento = true;
  proposalState.incrementos = [{ offerId: oferta12.id, qtd: 3 }];
  modelo = buildPropostaDocModel();
  itemLinhas = modelo.novaProposta.itens.find(it => it.item === 'Linhas móveis');
  assert(!!itemLinhas, 'mesmo-GB: existe item "Linhas móveis"');
  assert(itemLinhas.desc.includes('7× 12GB'), 'mesmo-GB: renovação(4) + incremento(3) no mesmo GB viram "7× 12GB" (' + itemLinhas.desc + ')');
  const ocorrencias12gb = (itemLinhas.desc.match(/12GB/g) || []).length;
  assert(ocorrencias12gb === 1, 'mesmo-GB: "12GB" aparece uma única vez na desc, não duplicado (' + itemLinhas.desc + ')');
  assert(itemLinhas.desc.startsWith('7 linha(s)'), 'mesmo-GB: qtdTotal = 4+3 = 7 (' + itemLinhas.desc + ')');
  somaVisiveis = modelo.novaProposta.itens.reduce((s, it) => s + (it.subtotal || 0), 0);
  assert(Math.abs(somaVisiveis + modelo.novaProposta.valorMonitor - modelo.destaque.valorProposto) < 0.01,
    'mesmo-GB: soma dos itens + valorMonitor bate com destaque.valorProposto');

  // --- (g) um único GB no cenário inteiro (regressão: já funcionava antes via porGb ter 1 chave só,
  // confirma explicitamente que a franquia aparece mencionada na desc) ---
  openProposal(clienteBase, { consolidarValoresOverride: true });
  proposalState.renewGrupos = [{ qtd: 5, offerId: oferta30.id }];
  modelo = buildPropostaDocModel();
  itemLinhas = modelo.novaProposta.itens.find(it => it.item === 'Linhas móveis');
  assert(!!itemLinhas, 'single-GB: existe item "Linhas móveis"');
  assert(itemLinhas.desc.includes('5× 30GB'), 'single-GB: desc menciona "5× 30GB" (' + itemLinhas.desc + ')');
  assert(itemLinhas.desc === '5 linha(s) — 5× 30GB — valor total consolidado',
    'single-GB: desc completa bate exatamente com o formato esperado (' + itemLinhas.desc + ')');
  somaVisiveis = modelo.novaProposta.itens.reduce((s, it) => s + (it.subtotal || 0), 0);
  assert(Math.abs(somaVisiveis + modelo.novaProposta.valorMonitor - modelo.destaque.valorProposto) < 0.01,
    'single-GB: soma dos itens + valorMonitor bate com destaque.valorProposto');

  // --- (h) modo itemizado (default, sem consolidar) não é afetado pela mudança: itens não carregam
  // a propriedade "gb" crua no modelo (é removida via destructuring) e a desc de cada item continua
  // no formato antigo "Nx GBGB — R$/linha", sem alteração ---
  openProposal(clienteBase, { consolidarValoresOverride: false });
  proposalState.renewGrupos = [
    { qtd: 4, offerId: oferta12.id },
    { qtd: 2, offerId: oferta40.id },
  ];
  modelo = buildPropostaDocModel();
  assert(!modelo.novaProposta.itens.some(it => it.item === 'Linhas móveis'), 'itemizado: sem item consolidado "Linhas móveis"');
  const itensRenovacaoItemizado = modelo.novaProposta.itens.filter(it => it.item === 'Renovação');
  assert(itensRenovacaoItemizado.length === 2, 'itemizado: 2 itens de Renovação separados, um por GB');
  assert(itensRenovacaoItemizado.every(it => !('gb' in it)), 'itemizado: nenhum item expõe a propriedade crua "gb" no modelo');
  assert(itensRenovacaoItemizado.every(it => !('qtd' in it)), 'itemizado: nenhum item expõe a propriedade crua "qtd" no modelo');
  const itemRenov12 = itensRenovacaoItemizado.find(it => it.desc.includes('12GB'));
  const itemRenov40 = itensRenovacaoItemizado.find(it => it.desc.includes('40GB'));
  assert(!!itemRenov12 && itemRenov12.desc === ('4× 12GB — ' + fmtBRL(oferta12.valor) + '/linha'), 'itemizado: desc do item 12GB no formato antigo, inalterado (' + (itemRenov12 && itemRenov12.desc) + ')');
  assert(!!itemRenov40 && itemRenov40.desc === ('2× 40GB — ' + fmtBRL(oferta40.valor) + '/linha'), 'itemizado: desc do item 40GB no formato antigo, inalterado (' + (itemRenov40 && itemRenov40.desc) + ')');
  somaVisiveis = modelo.novaProposta.itens.reduce((s, it) => s + (it.subtotal || 0), 0);
  assert(Math.abs(somaVisiveis + modelo.novaProposta.valorMonitor - modelo.destaque.valorProposto) < 0.01,
    'itemizado multi-GB: soma dos itens + valorMonitor bate com destaque.valorProposto');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 2000);
