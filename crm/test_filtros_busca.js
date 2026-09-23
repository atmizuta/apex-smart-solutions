const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__mockClientes = [];
function mockQueryBuilder(table){
  const builder = {
    select: () => builder, or: () => builder, limit: () => builder,
    then: (resolve) => resolve(table === 'clientes' ? { data: window.__mockClientes, error: null } : { data: [], error: null }),
  };
  return builder;
}
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => mockQueryBuilder(table),
  functions: { invoke: async () => ({data:{},error:null}) },
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;

const testScript = `
(async () => {
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  function cliente(overrides){
    return Object.assign({
      cnpj: '11.222.333/0001-44', razao_social: 'CLIENTE TESTE LTDA', cidade: 'São Paulo',
      telefone_contato: '11999990000', tel1: '', tel2: '',
      tempo_contrato_voz: 20, cep_cabeado: 'CEP Cabeado',
    }, overrides);
  }

  window.__mockClientes = [
    cliente({ razao_social: 'APTO CABEADO LTDA', telefone_contato: '11911112222', tempo_contrato_voz: 20, cep_cabeado: 'CEP Cabeado' }),
    cliente({ razao_social: 'APTO NAO CABEADO LTDA', telefone_contato: '11911113333', tempo_contrato_voz: 30, cep_cabeado: 'CEP Não Cabeado' }),
    cliente({ razao_social: 'NAO APTO CABEADO LTDA', telefone_contato: '11911114444', tempo_contrato_voz: 5, cep_cabeado: 'CEP Cabeado' }),
    cliente({ razao_social: 'NAO APTO NAO CABEADO LTDA', telefone_contato: '11911115555', tempo_contrato_voz: 2, cep_cabeado: 'CEP Não Cabeado' }),
  ];

  const searchInput = document.getElementById('searchInput');
  const pills = document.getElementById('filterPills');
  const pillApto = pills.querySelector('[data-filter="apto"]');
  const pillNaoApto = pills.querySelector('[data-filter="naoapto"]');
  const pillCabeado = pills.querySelector('[data-filter="cabeado"]');

  // --- 1) sem filtro nenhum: os 4 aparecem ---
  searchInput.value = '119111';
  await renderResults('119111');
  assert(window.__lastResults.length === 4, 'sem filtro, os 4 clientes aparecem (' + window.__lastResults.length + ')');
  assert(!pillApto.classList.contains('active'), 'pílula Apto começa inativa');

  // --- 2) clicar em Apto: só os 2 aptos aparecem ---
  pillApto.click();
  await new Promise(r => setTimeout(r, 0));
  assert(pillApto.classList.contains('active'), 'pílula Apto fica ativa após clicar');
  assert(window.__lastResults.length === 2, 'com filtro Apto, só 2 clientes aparecem (' + window.__lastResults.length + ')');
  assert(window.__lastResults.every(r => clienteApto(r)), 'todos os resultados filtrados por Apto são realmente aptos');

  // --- 3) clicar em Não apto: desliga Apto automaticamente (mutuamente exclusivos) e filtra os não aptos ---
  pillNaoApto.click();
  await new Promise(r => setTimeout(r, 0));
  assert(!pillApto.classList.contains('active'), 'clicar em Não apto desliga a pílula Apto');
  assert(pillNaoApto.classList.contains('active'), 'pílula Não apto fica ativa');
  assert(window.__lastResults.length === 2, 'com filtro Não apto, só 2 clientes aparecem (' + window.__lastResults.length + ')');
  assert(window.__lastResults.every(r => !clienteApto(r)), 'todos os resultados filtrados por Não apto são realmente não aptos');

  // --- 4) clicar em Não apto de novo desliga o filtro ---
  pillNaoApto.click();
  await new Promise(r => setTimeout(r, 0));
  assert(!pillNaoApto.classList.contains('active'), 'clicar de novo em Não apto desliga a pílula');
  assert(window.__lastResults.length === 4, 'sem filtro de apto, volta a mostrar os 4 (' + window.__lastResults.length + ')');

  // --- 5) Cabeado é independente de Apto/Não apto — combina os dois filtros ---
  pillApto.click();
  pillCabeado.click();
  await new Promise(r => setTimeout(r, 0));
  assert(pillApto.classList.contains('active') && pillCabeado.classList.contains('active'), 'Apto e Cabeado podem ficar ativos juntos');
  assert(window.__lastResults.length === 1, 'combinando Apto + Cabeado, só 1 cliente bate os dois critérios (' + window.__lastResults.length + ')');
  assert(window.__lastResults[0].razao_social === 'APTO CABEADO LTDA', 'o cliente filtrado é o esperado (Apto + Cabeado)');

  // --- 6) searchMeta mostra a contagem filtrada ---
  const metaText = document.getElementById('searchMeta').textContent;
  assert(metaText.includes('1 resultado'), 'searchMeta reflete a contagem já filtrada (' + metaText + ')');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
})();
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 2000);
