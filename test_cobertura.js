const fs = require('fs');
const { JSDOM } = require('jsdom');
const JSZipLib = require('jszip');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.JSZip = JSZipLib;

// stub simples do supabase, com uma "tabela" cobertura_kmz em memória pra simular upsert/select
window.__memCobertura = {};
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => {
    if(table === 'cobertura_kmz'){
      return {
        upsert: (row) => {
          window.__memCobertura[row.cidade] = { pontos: row.pontos, cidade_label: row.cidade_label, total_pontos: row.total_pontos };
          return Promise.resolve({ error: null });
        },
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: async () => ({ data: window.__memCobertura[val] || null, error: null }),
          }),
          order: () => ({ then: (resolve) => resolve({ data: Object.values(window.__memCobertura), error: null }) }),
        }),
      };
    }
    if(table === 'config'){
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { valor: 'FAKE_KEY' }, error: null }) }) }),
        upsert: async () => ({ error: null }) };
    }
    return { select: () => ({ order: () => ({ then: () => {} }) }) };
  },
  functions: { invoke: async () => ({data:{},error:null}) },
}) };

window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;
window.fetch = async () => ({ json: async () => ({ status: 'OK', results: [] }) });
window.jspdf = { jsPDF: function(){ return {}; } };

// jsdom's Blob/File não é reconhecido pelo checks internos do jszip quando ele roda puro no Node
// (instanceof cruzado entre realms) — pra testar a lógica de verdade (unzip + parse), usamos um
// Buffer normal do Node com um .name colado, que é tudo que parseKMZ/extrairCidadeDoNome precisam.
const bufCampinas = fs.readFileSync('campinas.kmz');
bufCampinas.name = 'SP - CAMPINAS - 06.07.2026 (1).kmz';
window.__fileCampinas = bufCampinas;
const bufSjrp = fs.readFileSync('sjrp.kmz');
bufSjrp.name = 'SP - SÃO JOSÉ DO RIO PRETO_13.05.2026 (4).kmz';
window.__fileSjrp = bufSjrp;

const testScript = `
(async () => {
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'admin' };
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // --- 1) extrairCidadeDoNome contra nomes reais dos arquivos enviados ---
  const casos = {
    'SP - CAMPINAS - 06.07.2026 (1).kmz': 'CAMPINAS',
    'SP - ARACATUBA_21.05.2026 (1).kmz': 'ARACATUBA',
    'SP - BERTIOGA_06.05.2025 (1).kmz': 'BERTIOGA',
    'SP - BOTUCATU_30.04.2026 (2).kmz': 'BOTUCATU',
    'SP - FRANCA_17.07.2026.kmz': 'FRANCA',
    'SP - JACAREI_02.06.2026 (2).kmz': 'JACAREI',
    'SP - LIMEIRA_27.04.2026 (1).kmz': 'LIMEIRA',
    'SP - RIBEIRAO PRETO_13.07.2026 (2).kmz': 'RIBEIRAO PRETO',
    'SP - SANTOS - 16.07.2026 (1).kmz': 'SANTOS',
    'SP - SAO JOSE DOS CAMPOS - 07.07.2026 (1).kmz': 'SAO JOSE DOS CAMPOS',
    'SP - SOROCABA - 17.07.2026 (1).kmz': 'SOROCABA',
    'SP - SÃO CARLOS_16.06.2026 (2).kmz': 'SÃO CARLOS',
    'SP - SÃO JOSÉ DO RIO PRETO_13.05.2026 (4).kmz': 'SÃO JOSÉ DO RIO PRETO',
    'SP - SÃO VICENTE_03.06.2026 (3).kmz': 'SÃO VICENTE',
  };
  for(const [nome, esperado] of Object.entries(casos)){
    const r = extrairCidadeDoNome(nome);
    assert(r === esperado, 'extrairCidadeDoNome("'+nome+'") = "'+r+'" (esperado "'+esperado+'")');
  }

  // --- 2) normalizarCidade remove acento e caixa ---
  assert(normalizarCidade('São José do Rio Preto') === 'SAO JOSE DO RIO PRETO', 'normalizarCidade acento');
  assert(normalizarCidade('  Campinas  ') === 'CAMPINAS', 'normalizarCidade trim/caixa');

  // --- 3) distanciaMetros: dois pontos ~1km de distância (aprox, mesma longitude) ---
  const d = distanciaMetros(-22.9, -47.0, -22.909, -47.0);
  assert(d > 950 && d < 1050, 'distanciaMetros ~1km, deu ' + d.toFixed(1) + 'm');
  const d0 = distanciaMetros(-22.9, -47.0, -22.9, -47.0);
  assert(d0 === 0, 'distanciaMetros mesmo ponto = 0');

  // --- 4) parseKMZ em um arquivo real (Campinas) ---
  const fileCampinas = window.__fileCampinas;
  const pontosCampinas = await parseKMZ(fileCampinas);
  assert(pontosCampinas.length > 0, 'parseKMZ Campinas extraiu pontos (' + pontosCampinas.length + ')');
  const temHFC = pontosCampinas.some(p => p[2] === 'HFC');
  const temGPON = pontosCampinas.some(p => p[2] === 'GPON');
  assert(temHFC, 'parseKMZ Campinas tem pontos HFC');
  assert(temGPON, 'parseKMZ Campinas tem pontos GPON');
  const coordsValidas = pontosCampinas.every(p => p[0] < -10 && p[0] > -30 && p[1] < -40 && p[1] > -55);
  assert(coordsValidas, 'parseKMZ Campinas: todas as coordenadas em faixa plausível pra SP (lat/lng)');

  // --- 5) parseKMZ em segundo arquivo real (São José do Rio Preto, nome com acento) ---
  const fileSjrp = window.__fileSjrp;
  const pontosSjrp = await parseKMZ(fileSjrp);
  assert(pontosSjrp.length > 0, 'parseKMZ SJRP extraiu pontos (' + pontosSjrp.length + ')');

  // --- 6) upload real via handler (dispara change event) + upsert no mock ---
  const inputEl = document.getElementById('kmzUpload');
  Object.defineProperty(inputEl, 'files', { value: [fileCampinas], configurable: true });
  await new Promise((resolve) => {
    inputEl.dispatchEvent(new window.Event('change'));
    setTimeout(resolve, 300);
  });
  assert(!!window.__memCobertura['CAMPINAS'], 'upload de KMZ upsertou CAMPINAS no mock do supabase');
  if(window.__memCobertura['CAMPINAS']) assert(window.__memCobertura['CAMPINAS'].total_pontos === pontosCampinas.length, 'total_pontos bate com o parse direto');

  // --- 7) verificarCobertura: ponto dentro do raio (usa o próprio primeiro ponto salvo) e fora do raio ---
  if(window.__memCobertura['CAMPINAS']){
    const [plat, plng] = window.__memCobertura['CAMPINAS'].pontos[0];
    const covDentro = await verificarCobertura('Campinas', plat, plng);
    assert(covDentro.status === 'coberto', 'verificarCobertura no próprio ponto = coberto (deu ' + covDentro.status + ')');
    const covFora = await verificarCobertura('Campinas', plat + 1, plng + 1);
    assert(covFora.status === 'sem_cobertura', 'verificarCobertura longe = sem_cobertura (deu ' + covFora.status + ')');
    const covSemDados = await verificarCobertura('Cidade Que Nao Existe', plat, plng);
    assert(covSemDados.status === 'sem_dados', 'verificarCobertura cidade sem KMZ = sem_dados (deu ' + covSemDados.status + ')');
  }

  // --- 8) geocodeEndereco: valida CEP mal formado sem precisar de chave real ---
  let erroCep = null;
  try{ await geocodeEndereco('123', ''); }catch(e){ erroCep = e.message; }
  assert(!!erroCep && erroCep.includes('CEP inválido'), 'geocodeEndereco rejeita CEP curto (' + erroCep + ')');

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
}, 4000);
