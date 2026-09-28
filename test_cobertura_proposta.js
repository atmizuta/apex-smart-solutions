// test_cobertura_proposta.js (25/09/2026): a aba Cobertura saiu, mas a checagem de CEP dentro da
// proposta (ao incluir Claro fibra) continua — este teste clica no botão e confere o resultado,
// com a geocodificação do Google e o banco stubados (não depende de fixture nem de rede).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const w = dom.window;
w.alert = () => {};
const vazio = { data: [], error: null };
const b = new Proxy({}, { get: (_, p) => p === 'then' ? (res) => res(vazio) : (p === 'single' || p === 'maybeSingle') ? () => ({ then: (res) => res({ data: null, error: null }) }) : () => b });
w.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} }, from: () => b, rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({}) } }) };

const testScript = `
(async function(){
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  try{
    currentUser = { id: 'u1', nome: 'Teste', username: 'teste', role: 'admin' };
    // stubs: sem Google e sem KMZ reais
    geocodeEndereco = async (cep, numero) => ({ lat: -22.9, lng: -47.06, cidade: 'Campinas', enderecoFormatado: 'Rua Exemplo, ' + numero + ' - Campinas' });
    verificarCobertura = async (cidade, lat, lng) => ({ status: 'coberto', distancia: 42, rede: 'GPON', cidade });

    const cliente = { razao_social: 'CLIENTE CEP LTDA', cnpj: '11.222.333/0001-44', cidade: 'Campinas', ddd: '19', linhas_voz: 3, valor_contrato: 500, arpu: 160, cep: '13000-000', cep_cabeado: '13000-000' };
    openProposal(cliente, {});
    proposalState.incluirFixa = true;
    renderProposalBody();

    const btn = document.getElementById('btnPropVerificarCobertura');
    assert(!!btn, 'botão "Verificar" de cobertura aparece dentro da proposta com fibra incluída');
    assert(document.getElementById('propCovCep').value === '13000-000', 'CEP do cliente vem pré-preenchido');

    // sem CEP: pede o CEP
    document.getElementById('propCovCep').value = '';
    btn.click();
    await new Promise(r => setTimeout(r, 10));
    assert(document.getElementById('propCoberturaResultado').textContent.includes('Informe o CEP'), 'sem CEP, pede o CEP');

    // com CEP: mostra o resultado da checagem
    document.getElementById('propCovCep').value = '13000-000';
    document.getElementById('propCovNumero').value = '123';
    btn.click();
    await new Promise(r => setTimeout(r, 30));
    const res = document.getElementById('propCoberturaResultado').innerHTML;
    assert(res.length > 0 && !res.includes('Verificando') && !res.includes('loginError'), 'resultado da cobertura renderizado (' + res.slice(0, 120) + ')');
    assert(/Rua Exemplo, 123/.test(res) || /Campinas/.test(res), 'resultado mostra o endereço/cidade geocodificados');

    // erro na geocodificação: mensagem ao consultor
    geocodeEndereco = async () => { throw new Error('CEP inválido (teste)'); };
    btn.click();
    await new Promise(r => setTimeout(r, 30));
    assert(document.getElementById('propCoberturaResultado').textContent.includes('CEP inválido (teste)'), 'erro da geocodificação aparece pro consultor');
  }catch(e){ fail++; console.log('ERRO FATAL:', e.stack); }
  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
})();
`;
w.eval(jsCode + testScript);
setTimeout(() => { if(w.__testResult !== 'OK') process.exitCode = 1; }, 1500);
