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

  function secaoAberta(titulo){
    const detalhes = Array.from(document.querySelectorAll('#proposalBody details.propSection'));
    const d = detalhes.find(el => el.querySelector('.secTitle').textContent.includes(titulo));
    return d ? d.hasAttribute('open') : null;
  }

  const clienteCabeado = { razao_social: 'CLIENTE CABEADO LTDA', cnpj: '11.222.333/0001-44', cidade: 'Sao Paulo', ddd: '11', linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: 'CEP Cabeado' };
  const clienteNaoCabeado = { razao_social: 'CLIENTE NAO CABEADO LTDA', cnpj: '22.333.444/0001-55', cidade: 'Campinas', ddd: '19', linhas_voz: 3, valor_contrato: 500, arpu: 166, cep_cabeado: 'CEP Não Cabeado' };

  // --- 1) só a Renovação nasce aberta; Incremento e Fibra nascem fechadas (tela menos poluída) ---
  openProposal(clienteCabeado, {});
  assert(secaoAberta('Renovação') === true, 'seção de Renovação começa aberta (é a ação principal)');
  assert(secaoAberta('Incremento') === false, 'seção de Incremento começa fechada até o consultor optar por usar');
  assert(secaoAberta('Claro fibra') === false, 'seção de Claro fibra começa fechada até o consultor optar por usar');
  assert(secaoAberta('Passaporte') === false, 'seção de Passaporte já começava fechada (sem mudança)');
  assert(secaoAberta('Convergência') === false, 'seção de combo de Convergência já começava fechada (sem mudança)');

  // --- 2) estado inicial: só renovação ligada, incremento e fibra desligados ---
  assert(proposalState.incluirRenovacao === true, 'renovação começa ligada');
  assert(proposalState.incluirIncremento === false, 'incremento começa desligado');
  assert(proposalState.incluirFixa === false, 'fibra começa desligada');

  // --- 3) cliente cabeado: alerta de viabilidade aparece no título da seção de fibra, mesmo fechada ---
  const bodyHtmlCabeado = document.getElementById('proposalBody').innerHTML;
  assert(bodyHtmlCabeado.includes('Endereço cabeado — disponível'), 'alerta de viabilidade aparece pro cliente cabeado, mesmo com a seção fechada');

  // --- 4) cliente NÃO cabeado: alerta não aparece ---
  openProposal(clienteNaoCabeado, {});
  const bodyHtmlNaoCabeado = document.getElementById('proposalBody').innerHTML;
  assert(!bodyHtmlNaoCabeado.includes('Endereço cabeado — disponível'), 'alerta de viabilidade NÃO aparece pro cliente não cabeado');
  assert(secaoAberta('Claro fibra') === false, 'fibra também começa fechada pro cliente não cabeado');

  // --- 5) ligar o interruptor de Fibra abre a seção (comportamento normal do acordeão, preservado) ---
  document.getElementById('propFixa').click();
  assert(proposalState.incluirFixa === true, 'clicar no interruptor liga a fibra');
  assert(secaoAberta('Claro fibra') === true, 'seção de fibra abre depois de ligada');

  // --- 6) ligar Incremento também abre a seção normalmente ---
  document.getElementById('propIncluirIncremento').click();
  assert(proposalState.incluirIncremento === true, 'clicar no interruptor liga o incremento');
  assert(secaoAberta('Incremento') === true, 'seção de incremento abre depois de ligada');

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
