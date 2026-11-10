// Testa a §143.2 — funil antigo com proposta ligada à Renovação. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  funilCache = [
    { id: 'pL', cliente_nome: 'Zz Ligada', estagio: 'negociacao', carteira_id: 7, consultor_id: 'u-a', estagio_entrada_em: '2026-11-08T12:00:00Z' },
    { id: 'pS', cliente_nome: 'Zz Solta', estagio: 'proposta_enviada', carteira_id: null, consultor_id: 'u-a', estagio_entrada_em: '2026-11-08T12:00:00Z' },
  ];
  renderFunil();
  const cL = document.querySelector('.kanbanCard[data-id="pL"]'), cS = document.querySelector('.kanbanCard[data-id="pS"]');
  eq([cL.getAttribute('draggable'), cS.getAttribute('draggable')], ['false', 'true'], 'ligada não arrasta');
  assert(/Renovação/.test(cL.textContent) && !/Renovação/.test(cS.textContent), 'selo Renovação só na ligada');

  let aviso = null; const avisoOrig = mostrarAviso; mostrarAviso = (m, t) => { aviso = [m, t]; };
  window.__escritas.length = 0;
  await moverCard('pL', 'fechado_ganho');
  eq([window.__escritas.length, aviso && aviso[1]], [0, 'info'], 'mover a ligada não grava e avisa');
  assert(/aba Renovação/.test(aviso[0]), 'aviso manda para a Renovação');
  await moverCard('pS', 'negociacao');
  eq(window.__escritas.filter(w => w.tabela === 'propostas').map(w => w.patch.estagio), ['negociacao'], 'a solta continua movendo');
  mostrarAviso = avisoOrig;

  window.__tabelas.propostas_historico = [];
  await abrirCardFunil('pL');
  await espera(20);
  assert(!document.getElementById('funilCardEstagioSelect'), 'ligada sem "Mover para"');
  const abriu = []; const abrirOrig = rnAbrirNaRenovacao; rnAbrirNaRenovacao = (id) => abriu.push(id);
  document.getElementById('btnAbrirNaRenovacao').click();
  eq(abriu, [7], 'Abrir na Renovação leva o cliente certo');
  rnAbrirNaRenovacao = abrirOrig;
  await abrirCardFunil('pS');
  await espera(20);
  assert(!!document.getElementById('funilCardEstagioSelect') && !document.getElementById('btnAbrirNaRenovacao'), 'solta continua com "Mover para"');

  // rnAbrirNaRenovacao abre a aba e a ficha
  window.__tabelas.renovacao_carteira = [{ id: 7, cnpj_digits: '00000000000207', razao_social: 'Zz Ligada', status: 5, na_base: true, consultor_id: 'u-a', dados_claro: {} }];
  window.__tabelas.renovacao_historico = [];
  rnAplicarPermissao();
  await rnAbrirNaRenovacao(7);
  await espera(40);
  assert(document.getElementById('tabBtnRenovacao').classList.contains('active') && document.getElementById('rnFicha').classList.contains('aberta'), 'abre a aba e a ficha');
  fim();
`);
