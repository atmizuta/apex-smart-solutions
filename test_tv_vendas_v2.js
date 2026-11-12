// Testa o pedido de 12/11 à noite (§149.2): Desfazer com campo de motivo, lista "Vendas de hoje" do gestor,
// tela do VENDEU! no visual do Apex (sem emoji) e som mais longo. DADOS FICTÍCIOS (repo público).
const { rodar } = require('./tv_vendas_harness.js');
rodar(`
  Object.assign(TV_TEMPOS, { tick: 100000, ranking: 100000, alternar: 100000, relogio: 100000, vendeu: 400, meta: 400, conta: 30, troca: 20, mini: 10 });

  // ===== 1) Desfazer: abre o campo do motivo antes de cancelar =====
  currentUser = { id: 'u-ad', nome: 'Zz Admin', role: 'admin', operacao: 'apex' };
  vdAplicarPermissao();
  window.__rpcRespostas.vendi = { data: { id: 61, receita: 474.95, linhas: 5, aviso: null }, error: null };
  document.getElementById('btnVendi').click();
  document.getElementById('vdCnpj').value = '11.222.333/0001-81';
  const sel = document.querySelector('#vdModal [data-vd-plano]'); sel.value = 'p57-100'; disparar(sel, 'change');
  document.getElementById('vdConfirmar').click(); await espera(30);
  const faixa = document.getElementById('vdDesfazer');
  faixa.querySelector('[data-vd-desfazer]').click(); await espera();
  eq(chamadas('vendi_cancelar').length, 0, 'Desfazer não cancela antes de confirmar');
  const mot = document.getElementById('vdDesfazerMotivo');
  assert(!!mot && mot.placeholder.includes('opcional'), 'aparece o campo do motivo (opcional)');
  window.__rpcRespostas.vendi_cancelar = { data: null, error: { message: 'Escreva o motivo (pelo menos 3 letras).', code: '22023' } };
  document.querySelector('#vdDesfazer [data-vd-desfazer-ok]').click(); await espera();
  eq(chamadas('vendi_cancelar')[0].args, { p_id: 61, p_motivo: null }, 'motivo vazio vai como nulo');
  assert(document.getElementById('vdDesfazerErro').textContent.includes('Escreva o motivo'), 'erro do banco aparece na faixa');
  assert(!!document.getElementById('vdDesfazer'), 'faixa continua aberta no erro');
  window.__rpcRespostas.vendi_cancelar = { data: null, error: null };
  document.getElementById('vdDesfazerMotivo').value = '  marquei errado ';
  document.querySelector('#vdDesfazer [data-vd-desfazer-ok]').click(); await espera();
  eq(chamadas('vendi_cancelar')[1].args, { p_id: 61, p_motivo: 'marquei errado' }, 'motivo digitado vai limpo');
  assert(!document.getElementById('vdDesfazer'), 'faixa fecha depois de desfazer');
  assert(window.__alertas.some(m => m.includes('Venda desfeita')), 'aviso de venda desfeita');

  // ===== 2) Lista "Vendas de hoje" na aba TV (gestor) =====
  window.__rpcRespostas.tv_ranking = (a) => ({ data: { periodo: a.p_periodo, de: '2026-11-12', ate: '2026-11-12', linhas: [], totais: {}, meta: {}, ultima: null }, error: null });
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 10, cancelados_ids: [], meta: null }, error: null };
  window.__rpcRespostas.tv_conferencia = { data: [], error: null };
  window.__rpcRespostas.tv_vendas_hoje = { data: [
    { id: 12, em: '2026-11-12T20:21:00-03:00', nome: 'Zz Admin', origem: 'discador', cnpj: '11222333000181', linhas: 5, receita: 474.95, cancelada: false, motivo: null },
    { id: 11, em: '2026-11-12T18:17:00-03:00', nome: 'Zz Ana Teste', origem: 'lead', cnpj: null, linhas: 0, receita: 300, cancelada: false, motivo: null },
    { id: 10, em: '2026-11-12T17:00:00-03:00', nome: 'Zz Bia Teste', origem: 'renovacao', cnpj: '11444777000161', linhas: 1, receita: 64.99, cancelada: true, motivo: 'marquei errado' }], error: null };
  tvAplicarPermissao();
  document.getElementById('tabBtnTvVendas').click(); await espera(40);
  const vh = document.getElementById('tvVendasHoje');
  const lin = vh.querySelectorAll('tbody tr');
  eq(lin.length, 3, 'uma linha por venda de hoje');
  assert(lin[0].textContent.includes('20:21') && lin[0].textContent.includes('Zz Admin') && lin[0].textContent.includes(fmtBRL(474.95)), 'linha com hora, nome e receita');
  assert(!lin[1].querySelector('[data-tv-vh-cancelar]') && lin[1].textContent.includes('status do lead'), 'venda de lead: sem Cancelar');
  assert(!lin[2].querySelector('[data-tv-vh-cancelar]') && lin[2].textContent.includes('marquei errado'), 'cancelada mostra o motivo');
  lin[0].querySelector('[data-tv-vh-cancelar]').click();
  const mv = document.getElementById('tvVhMotivo');
  assert(!!mv, 'Cancelar abre o campo do motivo');
  mv.value = 'x'; vh.querySelector('[data-tv-vh-ok]').click(); await espera();
  assert(vh.textContent.includes('pelo menos 3 letras'), 'motivo curto não vai');
  const nCanc = chamadas('vendi_cancelar').length;
  document.getElementById('tvVhMotivo').value = 'teste do Rafael';
  vh.querySelector('[data-tv-vh-ok]').click(); await espera(30);
  eq(chamadas('vendi_cancelar').slice(nCanc)[0].args, { p_id: 12, p_motivo: 'teste do Rafael' }, 'cancela com motivo');
  assert(chamadas('tv_vendas_hoje').length >= 2, 'lista recarrega');
  tvParar();

  // ===== 3) VENDEU! no visual do Apex =====
  document.getElementById('tabBtnTvVendas').click(); await espera(30);
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 13, cancelados_ids: [], meta: null }, error: null };
  window.__rpcRespostas.tv_vendas_desde = { data: [{ id: 13, consultor_id: 'a', nome: 'Zz Ana Teste', receita: 474.95, vendas_hoje: 2, contatos_hoje: 40, conversao_hoje: 5, pos_antes: 7, pos_depois: 5 }], error: null };
  await tvTick();
  const f = document.getElementById('tvFesta');
  assert(!f.hidden && f.classList.contains('vendeu'), 'VENDEU! aparece');
  assert(!/[\\u{1F300}-\\u{1FAFF}]/u.test(f.innerHTML), 'sem emoji');
  assert(!f.querySelector('.tvConfete') && !f.querySelector('.tvFoguete'), 'sem confete e sem foguete');
  assert(!!f.querySelector('.tvApice'), 'triângulo do ápice');
  eq(f.querySelector('.tvSelo').textContent, 'ZT', 'iniciais no selo');
  assert(f.querySelector('.tvTitulo').textContent.includes('VENDEU') && f.textContent.includes('Zz Ana Teste'), 'título e nome');
  const casas = [...f.querySelectorAll('.tvCasa')].map(c => c.querySelector('span').textContent);
  eq(casas, ['Posição no mês', 'Vendas hoje', 'Receita', 'Conversão hoje'], 'placar com 4 casas');
  eq(f.querySelector('[data-tv-pos]').textContent, '7º', 'posição começa na antiga');
  await espera(250);
  eq(f.querySelector('[data-tv-pos]').textContent, '5º', 'posição troca para a nova');
  eq(f.querySelector('[data-tv-conta]').textContent, fmtBRL(474.95), 'receita termina no valor certo');
  assert(f.textContent.includes('▲ subiu do 7º para o 5º lugar no mês'), 'linha da subida');
  await espera(200);
  tvParar();

  // ===== 4) som mais longo =====
  const fins = [];
  const P = () => ({ value: 0, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} });
  const no = () => ({ type: '', buffer: null, connect(){ return this; }, start(){}, stop(t){ fins.push(t || 0); }, frequency: P(), gain: P(), Q: P(), detune: P() });
  tvAudio = { state: 'running', currentTime: 0, sampleRate: 44100, destination: {}, resume: () => Promise.resolve(),
    createOscillator: no, createGain: no, createBiquadFilter: no, createBufferSource: no,
    createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) };
  tvEstado.som = true;
  tvTocar('venda');
  assert(Math.max(...fins) >= 4.5, 'som do VENDEU! dura ~5 s (termina em ' + Math.max(...fins).toFixed(1) + ' s)');
  fins.length = 0;
  tvTocar('meta');
  assert(Math.max(...fins) >= 7.5, 'som da META dura ~8 s (termina em ' + Math.max(...fins).toFixed(1) + ' s)');
  assert(TV_TEMPOS_PADRAO.vendeu >= 9000 && TV_TEMPOS_PADRAO.meta >= 12000, 'telas duram o bastante para o som (9 s e 12 s)');
`);
