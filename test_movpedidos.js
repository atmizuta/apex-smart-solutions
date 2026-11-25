// Testa a §166 — aba Movimentações (feed, tempo, VP) e gaveta do pedido. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const clicar = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const q = (s) => document.querySelector(s);
  const chamadas = (n) => window.__rpcCalls.filter(c => c.nome === n);
  const agoraIso = new Date().toISOString();
  window.__rpcRespostas.movimentacoes_feed = () => ({ data: { itens: [
      { em: '2026-11-20T12:51:00Z', numero: 'ZZM1', cliente: 'ZZ CLIENTE', consultor: 'ZZ CONS A', tipo: 'bko_status', etapa: 'CREDITO', quem: null, status: 'CONSULTA NÃO APROVADA', descricao: 'REPROVADO TESTE', vp_categoria: null },
      { em: '2026-11-20T12:00:00Z', numero: 'ZZM1', cliente: 'ZZ CLIENTE', consultor: 'ZZ CONS A', tipo: 'etapa', etapa: 'CREDITO', quem: 'ZZ BKO', status: null, descricao: null, vp_categoria: null } ],
    kpis: { movimentacoes: 4, anotacoes_bko: 1, entradas_vp: 1 }, atualizado_em: agoraIso, consultores: ['ZZ CONS A'], etapas: ['CREDITO'] }, error: null });

  // permissão
  currentUser = { id: 'u-c', nome: 'Zzc', role: 'consultor', operacao: 'apex', equipe: null }; mpAplicarPermissao();
  eq(q('#tabBtnMovPedidos').style.display, 'none', 'consultor não vê a aba');
  currentUser = { id: 'u-s', nome: 'Zzs', role: 'supervisor', operacao: 'campinas', equipe: null }; mpAplicarPermissao();
  eq(q('#tabBtnMovPedidos').style.display, 'inline-block', 'supervisor vê a aba');

  // feed
  clicar(q('#tabsNav button[data-tab="movpedidos"]')); await espera(40);
  assert(q('#panel-movpedidos').classList.contains('active'), 'abre a aba');
  eq(chamadas('movimentacoes_feed')[0].args.p_tipo, null, 'feed sem filtro de tipo');
  const txt = q('#mpConteudo').textContent;
  assert(/CONSULTA NÃO APROVADA/.test(txt) && /ZZ BKO/.test(txt) && /ZZM1/.test(txt), 'lista do feed');
  assert(/4/.test(q('#mpConteudo .kpiGrid').textContent), 'kpis');
  assert(!q('#mpAtualizado').classList.contains('mpAtrasado'), 'sincronização recente não fica em alerta');
  assert(mpEstado.timer, 'agendou a releitura');

  // filtro de tipo chama de novo
  const sel = q('#mpFiltros [data-mp-filtro="tipo"]'); sel.value = 'bko_status'; sel.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(30);
  eq(chamadas('movimentacoes_feed').at(-1).args.p_tipo, 'bko_status', 'filtro de tipo');

  // sincronização velha → alerta; feed vazio avisa
  window.__rpcRespostas.movimentacoes_feed = () => ({ data: { itens: [], kpis: { movimentacoes: 0, anotacoes_bko: 0, entradas_vp: 0 }, atualizado_em: '2026-11-20T00:00:00Z', consultores: [], etapas: [] }, error: null });
  await mpCarregar(); await espera(10);
  assert(q('#mpAtualizado').classList.contains('mpAtrasado'), 'sincronização de mais de 30 min fica em alerta');
  assert(/Nada neste dia/.test(q('#mpConteudo').textContent), 'feed vazio avisa');

  // sair da aba para a releitura
  clicar(q('#tabsNav button[data-tab="busca"]')); await espera(10);
  assert(!mpEstado.timer, 'parou ao sair da aba');
  // Task 7 — tempo por etapa e parados
  window.__rpcRespostas.movimentacoes_tempo_etapa = () => ({ data: { etapas: [
    { etapa: 'CREDITO', passagens: 12, mediana_h: 6, p90_h: 26, fora_sla_pct: 18, parados: 3 } ], consultores: ['ZZ CONS A'] }, error: null });
  window.__rpcRespostas.movimentacoes_parados = () => ({ data: { itens: [{ numero: 'ZZM2', cliente: 'ZZ CLIENTE 2', consultor: 'ZZ CONS C', desde: '2026-11-21T11:00:00Z', sla_horas: 8 }] }, error: null });
  clicar(q('#tabsNav button[data-tab="movpedidos"]')); await espera(30);
  clicar(q('#panel-movpedidos [data-mp-sub="tempo"]')); await espera(30);
  const t = q('#mpConteudo').textContent;
  assert(/CREDITO/.test(t) && /6 h/.test(t) && /1 d 2 h/.test(t) && /18%/.test(t), 'tabela do tempo por etapa');
  clicar(q('#mpConteudo [data-mp-parados="CREDITO"]')); await espera(30);
  eq(chamadas('movimentacoes_parados').at(-1).args, { p_etapa: 'CREDITO' }, 'parados da etapa');
  assert(/ZZM2/.test(q('#mpParados').textContent) && q('#mpParados .mpAlerta'), 'lista de parados com alerta de SLA');
  // (Tasks 8 e 9 acrescentam aqui)
  fim();
`);
