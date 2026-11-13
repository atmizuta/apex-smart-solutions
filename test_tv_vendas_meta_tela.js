// Testa §149.3: META BATIDA! uma vez por TELA (não uma vez no total) e o campo da meta que não se apaga enquanto alguém
// digita. DADOS FICTÍCIOS (repo público).
const { rodar } = require('./tv_vendas_harness.js');
rodar(`
  Object.assign(TV_TEMPOS, { tick: 100000, ranking: 100000, alternar: 100000, relogio: 100000, vendeu: 30, meta: 30, conta: 10, troca: 10 });
  window.__rpcRespostas.tv_ranking = (a) => ({ data: { periodo: a.p_periodo, de: '2026-11-13', ate: '2026-11-13', linhas: [], totais: {}, meta: { dia: '2026-11-13', meta: 30, vendas_hoje: 30 }, ultima: null }, error: null });
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 10, cancelados_ids: [], meta: 30 }, error: null };
  window.__rpcRespostas.tv_meta_comemorar = { data: { comemorar: false, vendas: 30, meta: 30 }, error: null };
  currentUser = { id: 'u-ad', nome: 'Zz Admin', role: 'admin', operacao: 'apex' };
  tvAplicarPermissao();
  document.getElementById('tabBtnTvVendas').click(); await espera(40);

  // 1) cada tela tem um id próprio, guardado, e vai junto no tv_meta_comemorar
  const tela = tvIdTela();
  assert(/^[a-z0-9-]{8,}$/.test(tela), 'id da tela gerado: ' + tela);
  eq(tvIdTela(), tela, 'mesmo id nas próximas chamadas');
  eq(window.localStorage.getItem('tvTela'), tela, 'id guardado no navegador');
  tvEstado.metaFeita = null;
  await tvVerificarMeta();
  eq(chamadas('tv_meta_comemorar').pop().args, { p_tela: tela }, 'manda a tela ao perguntar a META');

  // 2) campo da meta: quem está digitando não perde o que digitou quando o ranking redesenha
  const c = document.getElementById('tvMetaCampo');
  c.focus(); c.value = '45';
  await tvCarregarRanking();
  const c2 = document.getElementById('tvMetaCampo');
  eq(c2.value, '45', 'valor digitado continua depois do redesenho');
  eq(document.activeElement, c2, 'o campo continua com o foco');
  c2.blur();
  await tvCarregarRanking();
  eq(document.getElementById('tvMetaCampo').value, '30', 'sem foco: mostra a meta do banco');
  tvParar();
`);
