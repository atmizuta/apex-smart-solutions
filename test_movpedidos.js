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
  // (Tasks 7, 8 e 9 acrescentam aqui)
  fim();
`);
