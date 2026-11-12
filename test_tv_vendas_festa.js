// Testa as comemorações da TV (§149): fila de VENDEU!, cancelada fora, META BATIDA! uma vez, som. DADOS FICTÍCIOS.
const { rodar } = require('./tv_vendas_harness.js');
rodar(`
  Object.assign(TV_TEMPOS, { tick: 100000, ranking: 100000, alternar: 100000, relogio: 100000, vendeu: 40, meta: 40 });
  const tocados = [];
  const P = () => ({ value: 0, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} });
  const no = () => ({ type: '', buffer: null, connect(){ return this; }, start(){ tocados.push(1); }, stop(){}, frequency: P(), gain: P(), Q: P(), detune: P() });
  window.AudioContext = function(){ this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = {};
    this.resume = () => Promise.resolve();
    this.createOscillator = no; this.createGain = no; this.createBiquadFilter = no; this.createBufferSource = no;
    this.createBuffer = (c, n) => ({ getChannelData: () => new Float32Array(n) }); };
  let metaVendas = 29;
  window.__rpcRespostas.tv_ranking = (a) => ({ data: { periodo: a.p_periodo, de: '2026-11-12', ate: '2026-11-12', linhas: [], totais: {}, meta: { dia: '2026-11-12', meta: 30, vendas_hoje: metaVendas }, ultima: null }, error: null });
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 10, cancelados_ids: [], meta: 30 }, error: null };
  currentUser = { id: 'u-ad', nome: 'Zz Admin', role: 'admin', operacao: 'apex' };
  tvAplicarPermissao();
  document.getElementById('tabBtnTvVendas').click(); await espera(30);

  // som: precisa de clique; guarda a escolha
  document.getElementById('tvSom').click();
  eq(document.getElementById('tvSom').textContent, 'Som ligado', 'som liga no clique');
  eq(window.localStorage.getItem('tvSom'), '1', 'escolha guardada');

  // 3 vendas novas, a do meio cancelada antes da vez
  const V = (id, nome, extra) => Object.assign({ id, consultor_id: 'p' + id, nome, receita: 474.95, vendas_hoje: 2, contatos_hoje: 40, conversao_hoje: 5, pos_antes: 3, pos_depois: 1 }, extra || {});
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 13, cancelados_ids: [], meta: 30 }, error: null };
  window.__rpcRespostas.tv_vendas_desde = { data: [V(11, 'Zz Ana Teste'), V(12, 'Zz Bia Teste'), V(13, 'Zz Caio Teste', { pos_antes: null, pos_depois: 4, conversao_hoje: null })], error: null };
  metaVendas = 30;
  window.__rpcRespostas.tv_meta_comemorar = { data: { comemorar: true, vendas: 30, meta: 30, pessoas: [{ nome: 'Zz Ana', vendas: 5 }, { nome: 'Zz Bia', vendas: 3 }] }, error: null };
  await tvTick();
  const f = document.getElementById('tvFesta');
  assert(!f.hidden && f.classList.contains('vendeu'), 'VENDEU! aparece');
  assert(f.textContent.includes('VENDEU!') && f.textContent.includes('Zz Ana Teste'), 'nome de quem vendeu');
  // §149.2: placar (posição, vendas hoje, receita contando, conversão) no lugar da frase; selo no lugar do círculo
  assert(f.textContent.includes('▲ subiu do 3º para o 1º lugar no mês') && f.querySelector('[data-tv-conta]').dataset.tvConta === '474.95' && f.textContent.includes('5,0%'), 'detalhes');
  eq([...f.querySelectorAll('.tvCasa b')][1].textContent, '2', 'vendas hoje no placar');
  eq(f.querySelector('.tvSelo').textContent, 'ZT', 'iniciais no selo');
  assert(!f.querySelector('.tvConfete') && !!f.querySelector('.tvApice'), 'sem confete; triângulo do ápice');
  assert(tocados.length >= 3, 'tocou o som da venda');
  // cancelaram a venda 12 enquanto a 11 comemorava
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 13, cancelados_ids: [12], meta: 30 }, error: null };
  await tvTick();
  eq(tvEstado.fila.map(v => v.id), [13], 'cancelada sai da fila');
  await espera(55);
  assert(f.textContent.includes('Zz Caio Teste') && f.textContent.includes('▲ entrou em 4º lugar no mês'), 'segunda festa = a 13');
  assert(!f.textContent.includes('Conversão hoje'), 'sem contato: sem casa de conversão');
  await espera(55);
  assert(!f.hidden && f.classList.contains('meta'), 'META BATIDA! depois da fila');
  assert(f.textContent.includes('META BATIDA!') && f.textContent.includes('30 vendas hoje') && f.textContent.includes('Meta do dia: 30 vendas'), 'texto da meta');
  const pes = [...f.querySelectorAll('.tvPessoa')];
  eq(pes.map(p => [p.querySelector('.tvAvatar').textContent, p.querySelector('b').textContent]), [['ZA', '5'], ['ZB', '3']], 'pessoas: iniciais e vendas, maior primeiro');
  eq(chamadas('tv_meta_comemorar').length, 1, 'perguntou uma vez');
  await espera(55);
  assert(f.hidden, 'festa termina');
  // nova venda depois da meta: não pergunta de novo no mesmo dia
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 14, cancelados_ids: [12], meta: 30 }, error: null };
  window.__rpcRespostas.tv_vendas_desde = { data: [V(14, 'Zz Dani Teste')], error: null };
  await tvTick(); await espera(60);
  eq(chamadas('tv_meta_comemorar').length, 1, 'META só uma vez por dia');
  // som desligado: não toca
  document.getElementById('tvSom').click();
  eq(document.getElementById('tvSom').textContent, 'Som desligado', 'som desliga');
  const n = tocados.length; tvTocar('venda'); eq(tocados.length, n, 'desligado não toca');
`);
