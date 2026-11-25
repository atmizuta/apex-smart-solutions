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
  // Task 8 — vendas perdidas
  window.__rpcRespostas.vendas_perdidas_auditoria = () => ({ data: {
    totais: { vp: 3, saiu: 1, devolvido: 1, confere: 1, diferente: 0, sem: 0, reais: 2 },
    por_consultor: [{ consultor: 'ZZ CONS A', vps: 3, alerta_pct: 33, categorias: ['Restrição de Crédito'] }],
    pedidos: [
      { numero: 'ZZM1', cliente: 'ZZ C1', consultor: 'ZZ CONS A', entrou_em: '2026-11-20T14:05:00Z', categoria: 'Restrição de Crédito', bko_status: null, bko_descricao: null, bko_em: null, selo: 'devolvido', motivo_real: null },
      { numero: 'ZZM5', cliente: 'ZZ C5', consultor: 'ZZ CONS A', entrou_em: '2026-11-20T15:00:00Z', categoria: null, bko_status: null, bko_descricao: null, bko_em: null, selo: 'saiu', motivo_real: null },
      { numero: 'ZZM6', cliente: 'ZZ C6', consultor: 'ZZ CONS A', entrou_em: '2026-11-20T13:00:00Z', categoria: 'Restrição de Crédito', bko_status: 'CONSULTA NÃO APROVADA', bko_descricao: 'X', bko_em: '2026-11-20T12:30:00Z', selo: 'confere', motivo_real: 'Restrição de Crédito' } ] }, error: null });
  clicar(q('#panel-movpedidos [data-mp-sub="vp"]')); await espera(30);
  const v = q('#mpConteudo').textContent;
  assert(/VP reais/.test(v) && /ZZ CONS A/.test(v) && /33%/.test(v), 'totais e por consultor');
  eq(q('#mpConteudo').querySelectorAll('tbody tr[data-mp-linha]').length, 3, 'três pedidos');
  clicar(q('#mpConteudo [data-mp-selo="devolvido"]')); await espera(10);
  eq(q('#mpConteudo').querySelectorAll('tbody tr[data-mp-linha]').length, 1, 'filtra pelo selo clicado');
  assert(/Devolvido e perdido/.test(q('#mpConteudo tbody tr[data-mp-linha]').textContent), 'linha do selo');
  // Task 9 — gaveta "Linha do tempo do pedido" e motivo real
  window.__rpcRespostas.pedido_linha_do_tempo = (a) => a.p_numero === 'ZZM9'
    ? { data: null, error: { message: 'sem permissão para ver este pedido', code: '42501' } }
    : { data: { cabecalho: a.p_numero === 'ZZM3' ? null : { numero: 'ZZM1', cliente: 'ZZ CLIENTE', consultor: 'ZZ CONS A', valor: 100, etapa: 'VENDA PERDIDA (NEOCRM)' },
      passagens: a.p_numero === 'ZZM3' ? [] : [
        { etapa: 'CREDITO', entrou_em: '2026-11-20T12:00:00Z', saiu_em: '2026-11-20T23:00:00Z', entrou_por: 'ZZ CONS A', saiu_por: 'ZZ BKO', sla_horas: 8, texto: null, vp_categoria: null },
        { etapa: 'VENDA PERDIDA', entrou_em: '2026-11-21T14:05:00Z', saiu_em: null, entrou_por: 'ZZ CONS A', saiu_por: null, sla_horas: null, texto: null, vp_categoria: null } ],
      anotacoes: a.p_numero === 'ZZM3' ? [] : [{ em: '2026-11-20T22:51:00Z', tipo: 'bko_status', status: 'CONSULTA NÃO APROVADA', descricao: 'REPROVADO TESTE', vp_categoria: null, texto: 'x', autor_provavel: 'ZZ BKO' }],
      motivo_real: null, pode_decidir: true, categorias: ['Não responde', 'Restrição de Crédito'] }, error: null };
  window.__rpcRespostas.venda_perdida_definir_motivo = () => ({ data: { ok: true }, error: null });
  clicar(q('#mpConteudo [data-mp-pedido="ZZM1"]')); await espera(40);
  assert(q('#mpFicha').classList.contains('aberta'), 'abre a gaveta');
  const f = q('#mpFichaCorpo').textContent;
  assert(/ZZ CLIENTE/.test(f) && /provável: ZZ BKO/.test(f) && /CONSULTA NÃO APROVADA/.test(f) && /SLA 8 h/.test(f), 'cabeçalho, nota com autor provável e SLA estourado');
  eq(q('#mpFichaCorpo .mpBarra').querySelectorAll('i.fora').length, 1, 'barra marca a etapa fora do SLA');
  q('#mpMotivo').value = 'Restrição de Crédito'; q('#mpObs').value = 'BKO reprovou';
  clicar(q('[data-mp-salvar]')); await espera(30);
  eq(chamadas('venda_perdida_definir_motivo').at(-1).args, { p_numero: 'ZZM1', p_motivo: 'Restrição de Crédito', p_obs: 'BKO reprovou' }, 'salva o motivo real');
  mpAbrirPedido('ZZM3'); await espera(30);
  assert(/ZZM3/.test(q('#mpFichaCorpo').textContent) && /Histórico começa em 01/.test(q('#mpFichaCorpo').textContent), 'pedido sem histórico abre com o número e o aviso');
  mpAbrirPedido('ZZM9'); await espera(30);
  assert(/sem permissão/.test(q('#mpFichaCorpo').textContent), 'sem permissão avisa na gaveta');
  clicar(q('[data-mp-fechar]')); await espera(10);
  assert(!q('#mpFicha').classList.contains('aberta'), 'fecha');
  currentUser = { id: 'u-c', nome: 'Zzc', role: 'consultor', operacao: 'apex', equipe: null };
  mpAbrirPedido('ZZM1'); await espera(30);
  assert(q('#mpFicha').classList.contains('aberta'), 'consultor também abre a gaveta (a RPC decide)');
  fim();
`);
