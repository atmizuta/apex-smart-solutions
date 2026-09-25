const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('/sessions/affectionate-eloquent-bohr/mnt/outputs/_template.html', 'utf8');
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

  const clienteAvulsa = { razao_social: 'CLIENTE MANUAL TESTE LTDA', cnpj: '', cidade: 'Sao Paulo', ddd: '11', linhas_atuais: 5, valor_contrato: 800, arpu: 160, cep_cabeado: '' };

  // 1) abrir proposta avulsa -> modoManual nasce desligado, campos existem
  openProposal(clienteAvulsa, { avulsa: true, tipoAvulsa: 'novo' });
  assert(proposalState.modoManual === false, 'modoManual nasce desligado');
  assert(Array.isArray(proposalState.itensManuais) && proposalState.itensManuais.length === 0, 'itensManuais nasce vazio');
  assert(Array.isArray(proposalState.situacaoAtualManual) && proposalState.situacaoAtualManual.length === 0, 'situacaoAtualManual nasce vazio');
  assert(document.getElementById('propModoManual') !== null, 'toggle modo manual aparece pra avulsa');

  // 2) toggle liga modo manual -> catalog accordions desaparecem, editores livres aparecem
  document.getElementById('propModoManual').click();
  assert(proposalState.modoManual === true, 'toggle liga modoManual');
  assert(document.getElementById('btnAddItemManual') !== null, 'botao +Adicionar item (itens manuais) aparece');
  assert(document.getElementById('btnAddSitManual') !== null, 'botao +Adicionar item (situacao atual manual) aparece');
  assert(document.getElementById('propConsolidarValores') === null, 'consolidar valores escondido no modo manual');
  assert(document.querySelector('.propGrupoTipo') === null, 'accordion de linha/renovacao catalogado sumiu');
  assert(document.getElementById('dlModoManualSugestoes') !== null, 'datalist de sugestoes existe');

  // 3) adicionar item na situacao atual manual
  document.getElementById('btnAddSitManual').click();
  assert(proposalState.situacaoAtualManual.length === 1, 'item de situacao atual manual adicionado');
  const sitDesc = document.querySelector('.propSitManualDescricao[data-idx="0"]');
  sitDesc.value = '5 linhas plano 15GB';
  sitDesc.dispatchEvent(new window.Event('input', { bubbles: true }));
  const sitQtd = document.querySelector('.propSitManualQtd[data-idx="0"]');
  sitQtd.value = '5';
  sitQtd.dispatchEvent(new window.Event('input', { bubbles: true }));
  const sitValor = document.querySelector('.propSitManualValor[data-idx="0"]');
  sitValor.value = '80';
  sitValor.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(proposalState.situacaoAtualManual[0].descricao === '5 linhas plano 15GB', 'descricao situacao atual manual gravada');
  assert(proposalState.situacaoAtualManual[0].qtd === 5, 'qtd situacao atual manual gravada');
  assert(proposalState.situacaoAtualManual[0].valorUnit === 80, 'valorUnit situacao atual manual gravado');

  // 4) adicionar item na nova proposta (itens manuais), 2 itens
  document.getElementById('btnAddItemManual').click();
  document.getElementById('btnAddItemManual').click();
  assert(proposalState.itensManuais.length === 2, '2 itens manuais adicionados');

  const desc0 = document.querySelector('.propItemManualDescricao[data-idx="0"]');
  desc0.value = 'Plano 30GB';
  desc0.dispatchEvent(new window.Event('input', { bubbles: true }));
  const valor0 = document.querySelector('.propItemManualValor[data-idx="0"]');
  valor0.value = '90';
  valor0.dispatchEvent(new window.Event('input', { bubbles: true }));
  const qtd0 = document.querySelector('.propItemManualQtd[data-idx="0"]');
  qtd0.value = '5';
  qtd0.dispatchEvent(new window.Event('input', { bubbles: true }));

  const cat1 = document.querySelector('.propItemManualCategoria[data-idx="1"]');
  cat1.value = 'PABX';
  cat1.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(proposalState.itensManuais[1].categoria === 'PABX', 'categoria PABX gravada no 2o item');
  const desc1 = document.querySelector('.propItemManualDescricao[data-idx="1"]');
  desc1.value = 'PABX 20 ramais';
  desc1.dispatchEvent(new window.Event('input', { bubbles: true }));
  const valor1 = document.querySelector('.propItemManualValor[data-idx="1"]');
  valor1.value = '250';
  valor1.dispatchEvent(new window.Event('input', { bubbles: true }));
  const qtd1 = document.querySelector('.propItemManualQtd[data-idx="1"]');
  qtd1.value = '1';
  qtd1.dispatchEvent(new window.Event('input', { bubbles: true }));

  assert(proposalState.itensManuais[0].descricao === 'Plano 30GB' && proposalState.itensManuais[0].valorUnit === 90 && proposalState.itensManuais[0].qtd === 5, 'item 0 gravado corretamente');
  assert(proposalState.itensManuais[1].descricao === 'PABX 20 ramais' && proposalState.itensManuais[1].valorUnit === 250 && proposalState.itensManuais[1].qtd === 1, 'item 1 gravado corretamente');

  // 5) subtotal no DOM atualizado sem re-render (updateModoManualTotals)
  const subtotalEl = document.querySelector('.propItemManualSubtotal[data-idx="0"] b');
  assert(subtotalEl.textContent.includes('450'), 'subtotal do item 0 atualizado no DOM (' + subtotalEl.textContent + ')');
  const totalEl = document.getElementById('propItemManualTotalValor');
  assert(totalEl.textContent.includes('700'), 'total da secao atualizado no DOM (' + totalEl.textContent + ')'); // 450+250=700

  // 6) Claro Monitor auto-fill via categoria (so quando descricao vazia)
  document.getElementById('btnAddItemManual').click();
  assert(proposalState.itensManuais.length === 3, '3o item adicionado');
  const cat2 = document.querySelector('.propItemManualCategoria[data-idx="2"]');
  cat2.value = 'Claro Monitor';
  cat2.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(proposalState.itensManuais[2].descricao === 'Claro Monitor — Jornada Mobilidade', 'Claro Monitor auto-preenche descricao (' + proposalState.itensManuais[2].descricao + ')');
  assert(proposalState.itensManuais[2].valorUnit === 5, 'Claro Monitor auto-preenche valor 5 (' + proposalState.itensManuais[2].valorUnit + ')');

  // remove item 2 (Claro Monitor) pra nao afetar o total esperado abaixo
  const btnRemove2 = document.querySelector('.btnRemoveItemManual[data-idx="2"]');
  btnRemove2.click();
  assert(proposalState.itensManuais.length === 2, 'item Claro Monitor removido, volta a 2 itens');

  // 7) buildPropostaDocModel no modo manual
  const modelo = buildPropostaDocModel();
  assert(modelo.novaProposta.total === 700, 'novaProposta.total correto (' + modelo.novaProposta.total + ')');
  assert(modelo.novaProposta.itens.length === 2, 'novaProposta.itens tem 2 linhas');
  assert(modelo.novaProposta.itens[1].item === '[PABX] PABX 20 ramais', 'item com categoria vira prefixo [PABX] (' + modelo.novaProposta.itens[1].item + ')');
  assert(modelo.atual === 400, 'situacaoAtual total correto (5x80=400) (' + modelo.atual + ')'); // 5*80=400
  assert(modelo.situacaoAtual.tipo === 'tabela', 'situacaoAtual vira tabela quando ha itens');
  assert(modelo.situacaoAtual.itens[0].item === '5 linhas plano 15GB', 'situacaoAtual.itens usa a descricao digitada');
  assert(modelo.destaque.valorProposto === 700, 'destaque.valorProposto = novaProposta.total');
  assert(modelo.destaque.reducao === null, 'sem reducao (700 > 400)');
  assert(modelo.novaProposta.consolidado === false, 'consolidado sempre false no modo manual');
  assert(modelo.beneficios.badges.length === 0, 'sem badges universais no modo manual');
  assert(modelo.beneficios.extras.length === 1 && modelo.beneficios.extras[0].includes('manual'), 'nota de proposta manual presente');
  assert(modelo.beneficios.temOfertaMovel === true, 'temOfertaMovel true quando ha itens (pra nota aparecer no doc)');
  assert(modelo.subtitulo === 'Proposta avulsa — Nova aquisição de linha', 'subtitulo reaproveita logica normal (' + modelo.subtitulo + ')');
  assert(modelo.client.razaoSocial === 'CLIENTE MANUAL TESTE LTDA', 'client.razaoSocial correto');

  // 8) situacaoAtualManual vazio -> fallback resumo
  proposalState.situacaoAtualManual = [];
  const modelo2 = buildPropostaDocModel();
  assert(modelo2.situacaoAtual.tipo === 'resumo', 'sem itens -> situacaoAtual vira resumo');
  assert(modelo2.atual === 0, 'atual = 0 quando situacaoAtualManual vazio');

  // 9) guarda de itensManuais vazio (nao deve gerar documento) - checa so a logica do guard, sem chamar generateProposalDocx de verdade
  proposalState.itensManuais = [];
  renderProposalBody();
  const hint = document.querySelector('.propItemManualSubtotal'); // nao deve existir pois lista vazia
  assert(document.body.textContent.includes('Adicione pelo menos um item'), 'hint de lista vazia aparece');

  // 10) desligar modo manual restaura fluxo catalogado (sanity - nao deve quebrar)
  document.getElementById('propModoManual').click();
  assert(proposalState.modoManual === false, 'desligar modoManual funciona');
  assert(document.getElementById('propConsolidarValores') !== null, 'consolidar valores volta a aparecer');
  assert(document.querySelector('.propGrupoTipo') !== null, 'accordion catalogado volta a aparecer');

  // 11) fluxo NAO-avulsa (cliente da base) nunca mostra o toggle modo manual
  const clienteBase = { razao_social: 'CLIENTE BASE LTDA', cnpj: '11.111.111/0001-11', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 8, valor_contrato: 1200, arpu: 150, cep_cabeado: '', tempo_contrato_voz: 20 };
  openProposal(clienteBase, {});
  assert(document.getElementById('propModoManual') === null, 'toggle modo manual NAO aparece no fluxo cliente-da-base');
  assert(proposalState.modoManual === false, 'modoManual sempre false no fluxo cliente-da-base');

  console.log('RESULTADO: ' + ok + ' passaram, ' + fail + ' falharam');
  if(fail > 0) process.exitCode = 1;
}catch(e){
  console.error('ERRO NO TESTE:', e.message, e.stack);
  process.exitCode = 1;
}
`;

window.eval(jsCode + '\n' + testScript);
