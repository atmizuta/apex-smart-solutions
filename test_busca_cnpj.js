const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__lastOrFilter = null;
window.__mockClientes = [];
function mockQueryBuilder(table){
  const builder = {
    select: () => builder,
    or: (filterStr) => { if(table === 'clientes') window.__lastOrFilter = filterStr; return builder; },
    limit: () => builder,
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

  window.__mockClientes = [{
    cnpj: '11.222.333/0001-44', cnpj_digits: '11222333000144', razao_social: 'CLIENTE TESTE LTDA',
    cidade: 'São Paulo', telefone_contato: '', tel1: '', tel2: '', tempo_contrato_voz: 20, cep_cabeado: '',
  }];

  // --- 1) CNPJ digitado SEM formatação (o bug relatado): filtro inclui cnpj_digits com os
  // mesmos dígitos, então bate com o valor salvo formatado no banco ---
  await renderResults('11222333000144');
  assert(window.__lastOrFilter.includes('cnpj_digits.ilike.%11222333000144%'), 'CNPJ puro (sem pontuação) entra no filtro cnpj_digits (' + window.__lastOrFilter + ')');

  // --- 2) CNPJ digitado COM formatação: continua funcionando (extrai só os dígitos pro filtro
  // extra, além do ilike normal contra a coluna cnpj que já cobria esse caso) ---
  await renderResults('11.222.333/0001-44');
  assert(window.__lastOrFilter.includes('cnpj_digits.ilike.%11222333000144%'), 'CNPJ formatado também entra no filtro cnpj_digits (' + window.__lastOrFilter + ')');
  assert(window.__lastOrFilter.includes('cnpj.ilike.%11.222.333/0001-44%'), 'CNPJ formatado continua batendo no ilike normal da coluna cnpj também');

  // --- 3) CNPJ parcial (raiz, sem filial/DV): também funciona, sem tentar "completar" o número ---
  await renderResults('11222333');
  assert(window.__lastOrFilter.includes('cnpj_digits.ilike.%11222333%'), 'CNPJ parcial (raiz) entra no filtro cnpj_digits sem tentar completar/formatar errado (' + window.__lastOrFilter + ')');

  // --- 4) busca por texto puro (razão social): não força um filtro cnpj_digits vazio/inútil ---
  await renderResults('CLIENTE TESTE');
  assert(!window.__lastOrFilter.includes('cnpj_digits'), 'busca só com letras não inclui cnpj_digits no filtro (' + window.__lastOrFilter + ')');

  // --- 5) poucos dígitos (poderiam ser parte de um DDD/telefone, não CNPJ) — abaixo do limiar de
  // 4 dígitos, não adiciona o filtro cnpj_digits pra evitar resultado "aleatório" demais ---
  await renderResults('SL 12');
  assert(!window.__lastOrFilter.includes('cnpj_digits'), 'poucos dígitos (< 4) não entram no filtro cnpj_digits (' + window.__lastOrFilter + ')');

  // --- 6) fim a fim: a busca continua achando o cliente digitando só números (era o bug relatado) ---
  await renderResults('11222333000144');
  assert(window.__lastResults.length === 1, 'busca por CNPJ sem formatação encontra o cliente (resultado simulado do banco)');

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
}, 500);
