// NOTA (23/09/2026): este arquivo testava o campo único "GB do plano atual" (22/09/2026), que foi
// substituído no mesmo dia por "situacaoAtualGrupos" (detalhe do plano atual por linha — qtd + GB +
// valor unitário — renderizado como tabela no PDF) + campo de vendedor editável, a pedido do
// usuário. Não foi possível apagar/renomear o arquivo (outputs não permite exclusão), então o
// conteúdo foi reescrito aqui pra cobrir a funcionalidade nova. Ver REGRAS_NEGOCIO.md seção 27.
//
// Atualização (23/09/2026, troca PDF->DOCX): generateProposalPDF() foi removida. Os blocos 5-9, que
// antes liam texto renderizado no PDF, agora chamam buildPropostaDocModel() direto e conferem
// modelo.situacaoAtual (tipo/itens/linhas) e modelo.client.consultor.
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

  const clienteBase = { razao_social: 'CLIENTE GB TESTE LTDA', cnpj: '11.222.333/0001-44', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000' };

  // --- 1) estado nasce vazio/com default ---
  openProposal(clienteBase, {});
  assert(Array.isArray(proposalState.situacaoAtualGrupos) && proposalState.situacaoAtualGrupos.length === 0, 'situacaoAtualGrupos nasce vazio');
  assert(proposalState.vendedorNome === 'Consultor Teste', 'vendedorNome nasce com o nome do usuario logado (' + proposalState.vendedorNome + ')');

  // --- 2) input de vendedor existe e comeca preenchido; editar atualiza o estado ---
  renderProposalBody();
  const vendedorInput = document.getElementById('propVendedorNome');
  assert(!!vendedorInput, 'input de vendedor existe na tela');
  assert(vendedorInput.value === 'Consultor Teste', 'input de vendedor comeca com o nome do usuario logado');
  vendedorInput.value = 'Fulano de Tal';
  vendedorInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(proposalState.vendedorNome === 'Fulano de Tal', 'editar o input de vendedor atualiza proposalState.vendedorNome (' + proposalState.vendedorNome + ')');

  // --- 3) "+ Adicionar plano atual" cria um grupo {qtd:1, gb:0, valorUnit:0}; inputs de qtd/gb/valor existem ---
  const btnAddSit = document.getElementById('btnAddSitAtual');
  assert(!!btnAddSit, 'botao "+ Adicionar plano atual" existe');
  btnAddSit.click();
  assert(proposalState.situacaoAtualGrupos.length === 1, 'clicar no botao adiciona 1 grupo');
  assert(JSON.stringify(proposalState.situacaoAtualGrupos[0]) === JSON.stringify({qtd:1, gb:0, valorUnit:0}), 'grupo novo nasce com qtd 1, gb 0, valorUnit 0');
  let qtdInput = document.querySelector('.propSitAtualQtd[data-idx="0"]');
  let gbInput = document.querySelector('.propSitAtualGb[data-idx="0"]');
  let valorInput = document.querySelector('.propSitAtualValor[data-idx="0"]');
  assert(!!qtdInput && !!gbInput && !!valorInput, 'inputs de qtd/GB/valor do grupo aparecem na tela');

  // --- 4) editar qtd/GB/valor atualiza o estado sem precisar re-renderizar ---
  qtdInput.value = '5'; qtdInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  gbInput.value = '10'; gbInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  valorInput.value = '50'; valorInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(proposalState.situacaoAtualGrupos[0].qtd === 5, 'qtd atualizada pro grupo (5)');
  assert(proposalState.situacaoAtualGrupos[0].gb === 10, 'GB atualizado pro grupo (10)');
  assert(proposalState.situacaoAtualGrupos[0].valorUnit === 50, 'valor/linha atualizado pro grupo (50)');

  // --- 5) sem grupos preenchidos, o modelo mostra o resumo simples de antes (fallback) ---
  openProposal(clienteBase, {});
  let modelo = buildPropostaDocModel();
  assert(modelo.situacaoAtual.tipo === 'resumo', 'sem grupos: situacaoAtual.tipo é resumo (fallback)');
  const rotulosResumo = modelo.situacaoAtual.linhas.map(l => l[0]);
  assert(rotulosResumo.includes('Linhas (voz)'), 'sem grupos: resumo inclui "Linhas (voz)"');
  assert(rotulosResumo.includes('Total da fatura (valor do contrato)'), 'sem grupos: resumo inclui "Total da fatura (valor do contrato)"');
  assert(rotulosResumo.includes('Valor médio por linha'), 'sem grupos: resumo inclui "Valor médio por linha"');

  // --- 6) com grupos preenchidos ("5 linhas de 10GB a R$50,00/linha = R$250,00"), a Situacao Atual
  // vira tabela itemizada igual ao modelo da Nova Proposta (pedido do usuario, 23/09/2026) ---
  openProposal(clienteBase, {});
  proposalState.situacaoAtualGrupos = [
    { qtd: 5, gb: 10, valorUnit: 50 },
    { qtd: 3, gb: 45, valorUnit: 59.99 },
  ];
  modelo = buildPropostaDocModel();
  assert(modelo.situacaoAtual.tipo === 'tabela', 'com grupos: situacaoAtual.tipo é tabela');
  const itensPlanoAtual = modelo.situacaoAtual.itens;
  assert(itensPlanoAtual.length === 2, 'com grupos: 1 item "Plano atual" na tabela por grupo (achou ' + itensPlanoAtual.length + ')');
  assert(itensPlanoAtual.every(it => it.item === 'Plano atual'), 'com grupos: todos os itens da tabela sao "Plano atual"');
  assert(itensPlanoAtual[0].desc.includes('5× 10GB') && itensPlanoAtual[0].desc.includes('50,00'), 'descricao do 1o grupo mostra "5× 10GB ... 50,00/linha" (' + itensPlanoAtual[0].desc + ')');
  assert(itensPlanoAtual[1].desc.includes('3× 45GB'), 'descricao do 2o grupo mostra "3× 45GB..."');
  assert(Math.abs(itensPlanoAtual[0].subtotal - 250) < 0.01, '5× R$50,00 = subtotal 250,00 no 1o grupo (' + itensPlanoAtual[0].subtotal + ')');
  assert(Math.abs(itensPlanoAtual[1].subtotal - 179.97) < 0.01, '3× R$59,99 = subtotal 179,97 no 2o grupo (' + itensPlanoAtual[1].subtotal + ')');

  // --- 7) grupo com qtd 0 (ou removido) e ignorado, sem quebrar ---
  openProposal(clienteBase, {});
  proposalState.situacaoAtualGrupos = [{ qtd: 0, gb: 10, valorUnit: 50 }];
  modelo = buildPropostaDocModel();
  assert(modelo.situacaoAtual.tipo === 'resumo', 'grupo com qtd 0 e tratado como vazio -> cai no resumo simples');

  // --- 8) nome do vendedor aparece no modelo (client.consultor) ---
  openProposal(clienteBase, {});
  proposalState.vendedorNome = 'Maria Vendedora';
  modelo = buildPropostaDocModel();
  assert(modelo.client.consultor === 'Maria Vendedora', 'nome do vendedor editado aparece no modelo (client.consultor)');

  // vendedorNome vazio (apagou o campo) cai de volta pro nome do usuario logado
  openProposal(clienteBase, {});
  proposalState.vendedorNome = '';
  modelo = buildPropostaDocModel();
  assert(modelo.client.consultor === 'Consultor Teste', 'vendedorNome vazio cai de volta pro nome do usuario logado no modelo');

  // --- 9) proposta avulsa: mesmo comportamento (fallback "Linhas hoje" / tabela quando tem grupos) ---
  openProposal({ razao_social: 'Prospect Avulso', linhas_atuais: 3 }, { avulsa: true, operadoraAtual: 'Vivo' });
  modelo = buildPropostaDocModel();
  assert(modelo.situacaoAtual.tipo === 'resumo', 'avulsa sem grupos: situacaoAtual.tipo é resumo');
  assert(modelo.situacaoAtual.linhas.map(l => l[0]).includes('Linhas hoje'), 'avulsa sem grupos: resumo inclui "Linhas hoje"');
  proposalState.situacaoAtualGrupos = [{ qtd: 2, gb: 20, valorUnit: 40 }];
  modelo = buildPropostaDocModel();
  assert(modelo.situacaoAtual.tipo === 'tabela', 'avulsa com grupos: situacaoAtual.tipo vira tabela');
  assert(modelo.situacaoAtual.itens.some(it => it.desc.includes('2× 20GB')), 'avulsa com grupos: descricao do grupo aparece na tabela');

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
