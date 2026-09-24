const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// --- mock do supabase: cobertura_kmz (2 cidades) + config (chave fake) ---
const CIDADES_MOCK = [
  { cidade: 'RIO CLARO', cidade_label: 'Rio Claro', pontos: [[-22.39,-47.57,'HFC'],[-22.391,-47.571,'GPON'],[-22.392,-47.572,'HFC']] },
  { cidade: 'CAMPINAS', cidade_label: 'Campinas', pontos: [[-22.9,-47.0,'HFC'],[-22.901,-47.001,'HFC'],[-22.902,-47.002,'GPON'],[-22.903,-47.003,'GPON']] },
];

window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => {
    if(table === 'cobertura_kmz'){
      return {
        select: (cols) => {
          const builder = {
            eq: (col, val) => ({
              maybeSingle: async () => {
                const row = CIDADES_MOCK.find(c => c.cidade === val);
                return { data: row ? { pontos: row.pontos, cidade_label: row.cidade_label } : null, error: null };
              },
            }),
            order: () => ({
              then: (resolve) => resolve({
                data: CIDADES_MOCK.map(c => ({ cidade: c.cidade, cidade_label: c.cidade_label })).sort((a,b) => a.cidade_label.localeCompare(b.cidade_label)),
                error: null,
              }),
            }),
          };
          return builder;
        },
      };
    }
    if(table === 'config'){
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { valor: 'FAKE_KEY' }, error: null }) }) }) };
    }
    return { select: () => ({ order: () => ({ then: () => {} }) }) };
  },
  functions: { invoke: async () => ({data:{},error:null}) },
}) };

window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;
window.jspdf = { jsPDF: function(){ return {}; } };
window.fetch = async () => ({ json: async () => ({ status: 'OK', results: [] }) });

// --- stub do Google Maps JS: só o mínimo pra Map/Marker/OverlayView existirem ---
window.__mapCalls = [];
window.__markerCalls = [];
function StubLatLng(lat, lng){ this.lat = lat; this.lng = lng; }
function StubMap(el, opts){ window.__mapCalls.push(opts); this.setCenter = function(c){ this.__center = c; }; this.setZoom = function(z){ this.__zoom = z; }; }
function StubMarker(opts){ window.__markerCalls.push(opts); this.setMap = function(m){ this.__mapSetTo = m; }; }
function StubOverlayView(){}
StubOverlayView.prototype.setMap = function(m){ this.__mapSetTo = m; };
StubOverlayView.prototype.getMap = function(){ return this.__mapSetTo; };
window.google = { maps: {
  LatLng: StubLatLng,
  Map: StubMap,
  Marker: StubMarker,
  SymbolPath: { CIRCLE: 0 },
  OverlayView: StubOverlayView,
} };

const testScript = `
(async () => {
try{
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'admin' };
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // espiona criarCoberturaOverlay (definida no código real) sem simular canvas/projeção de verdade
  window.__overlayCalls = [];
  criarCoberturaOverlay = function(gmaps, pontos, corRGB, raioMetros){
    const chamada = { pontos: pontos.slice(), corRGB, raioMetros };
    window.__overlayCalls.push(chamada);
    const overlay = new gmaps.OverlayView();
    overlay.__chamada = chamada;
    return overlay;
  };

  // --- 1) lista de cidades popula o select, ordenada, com placeholder ---
  await carregarListaCidadesCobertura();
  const sel = document.getElementById('covCidadeMapa');
  assert(sel.options.length === 3, 'select tem placeholder + 2 cidades (' + sel.options.length + ')');
  assert(sel.options[0].value === '', 'primeira opção é o placeholder vazio');
  assert(sel.options[1].textContent === 'Campinas', 'Campinas vem antes de Rio Claro (ordem alfabética)');
  assert(sel.options[2].textContent === 'Rio Claro', 'Rio Claro é a segunda cidade');

  // --- 2) renderMapaCobertura separa pontos HFC/GPON e usa as cores/raio certos ---
  window.__overlayCalls.length = 0;
  window.__mapCalls.length = 0;
  await renderMapaCobertura('CAMPINAS');
  assert(window.__mapCalls.length === 1, 'mapa criado uma vez (' + window.__mapCalls.length + ')');
  assert(window.__overlayCalls.length === 2, 'duas camadas de overlay criadas (HFC + GPON)');
  assert(window.__overlayCalls[0].pontos.length === 2, 'Campinas: 2 pontos HFC no primeiro overlay (' + window.__overlayCalls[0].pontos.length + ')');
  assert(window.__overlayCalls[0].corRGB === '255,140,0', 'HFC usa laranja (255,140,0), veio ' + window.__overlayCalls[0].corRGB);
  assert(window.__overlayCalls[1].pontos.length === 2, 'Campinas: 2 pontos GPON no segundo overlay (' + window.__overlayCalls[1].pontos.length + ')');
  assert(window.__overlayCalls[1].corRGB === '0,120,255', 'GPON/fibra usa azul (0,120,255), veio ' + window.__overlayCalls[1].corRGB);
  assert(window.__overlayCalls[0].raioMetros === RAIO_COBERTURA_M, 'raio do overlay = raio de cobertura (' + window.__overlayCalls[0].raioMetros + ')');
  assert(mapaCoberturaState.overlayHfc.__mapSetTo === mapaCoberturaState.map, 'overlay HFC visível por padrão (checkbox marcado)');

  // --- 3) trocar de cidade reaproveita a mesma instância do mapa (não recria) ---
  await renderMapaCobertura('RIO CLARO');
  assert(window.__mapCalls.length === 1, 'mapa NÃO foi recriado ao trocar de cidade (continua 1)');
  assert(window.__overlayCalls.length === 4, 'novos overlays criados pra Rio Claro (total 4 chamadas acumuladas)');

  // --- 4) checkbox HFC desmarcado esconde a camada ---
  const hfcCheckbox = document.getElementById('covShowHfc');
  hfcCheckbox.checked = false;
  hfcCheckbox.dispatchEvent(new window.Event('change'));
  assert(mapaCoberturaState.overlayHfc.__mapSetTo === null, 'desmarcar HFC chama setMap(null)');
  hfcCheckbox.checked = true;
  hfcCheckbox.dispatchEvent(new window.Event('change'));
  assert(mapaCoberturaState.overlayHfc.__mapSetTo === mapaCoberturaState.map, 'remarcar HFC volta a mostrar a camada');

  // --- 5) marcarEnderecoNoMapa: cidade com KMZ cadastrado cria marcador colorido ---
  window.__markerCalls.length = 0;
  const geoRioClaro = { lat: -22.3905, lng: -47.5706, enderecoFormatado: 'Av. 48, Rio Claro - SP', cidade: 'Rio Claro' };
  await marcarEnderecoNoMapa(geoRioClaro, { status: 'coberto', distanciaM: 30, rede: 'HFC' });
  assert(document.getElementById('covCidadeMapa').value === 'RIO CLARO', 'select passou a mostrar Rio Claro automaticamente');
  assert(window.__markerCalls.length === 1, 'marcador criado no mapa');
  assert(window.__markerCalls[0].icon.fillColor === '#16a34a', 'marcador verde quando coberto (' + window.__markerCalls[0].icon.fillColor + ')');

  window.__markerCalls.length = 0;
  await marcarEnderecoNoMapa(geoRioClaro, { status: 'sem_cobertura', distanciaM: 300, rede: 'HFC' });
  assert(window.__markerCalls[0].icon.fillColor === '#dc2626', 'marcador vermelho quando sem cobertura (' + window.__markerCalls[0].icon.fillColor + ')');

  // --- 6) marcarEnderecoNoMapa: cidade SEM KMZ cadastrado não mexe no mapa ---
  window.__markerCalls.length = 0;
  const selAntes = document.getElementById('covCidadeMapa').value;
  const geoSemKmz = { lat: -10, lng: -40, enderecoFormatado: 'Rua X, Cidade Sem KMZ', cidade: 'Cidade Sem KMZ' };
  await marcarEnderecoNoMapa(geoSemKmz, { status: 'sem_dados' });
  assert(window.__markerCalls.length === 0, 'nenhum marcador criado pra cidade sem KMZ cadastrado');
  assert(document.getElementById('covCidadeMapa').value === selAntes, 'select não muda quando a cidade não tem KMZ');

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
