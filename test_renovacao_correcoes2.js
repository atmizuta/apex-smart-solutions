// Testa as correções da revisão final da §143.2 (aba Renovação). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const L = (o) => Object.assign({ razao_social: 'Zz', linhas_voz: 1, na_base: true, consultor_id: 'u-a', status_desde: '2026-11-08T12:00:00Z', dados_claro: {} }, o);
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [L({ id: 1, status: 3, razao_social: 'Zz Do A' }), L({ id: 2, status: 7, motivo_perda: 'Preço' }), L({ id: 3, status: 6, linhas_renovadas: 2 })];
  window.__tabelas.propostas = []; window.__tabelas.renovacao_historico = [];
  await rnCarregar();

  // ==== I4: cliente renovado ou perdido não gera proposta (nasceria fechada) ====
  rnTrocarAba('kanban');
  eq(['1', '2', '3'].map(id => !!document.querySelector('#rnKanban [data-rn-card="' + id + '"] [data-rn-gerar]')), [true, false, false], 'cartão em 6/7 sem Gerar proposta');
  await rnAbrirFicha(2);
  assert(!document.querySelector('#rnFichaCorpo [data-rn-gerar]') && /Reabra o status/.test(document.getElementById('rnFichaCorpo').textContent), 'ficha de perdido explica como gerar');
  let aviso = null; const avisoOrig = mostrarAviso; mostrarAviso = (m, t) => { aviso = [m, t]; };
  const chamadas = []; const openOrig = openProposal; openProposal = (c, o) => chamadas.push(o);
  await rnGerarProposta(2);
  eq([chamadas.length, aviso && aviso[1]], [0, 'info'], 'gerar em perdido avisa e não abre');
  mostrarAviso = avisoOrig; openProposal = openOrig;

  // ==== I3: ficha aberta mostra a proposta recém-gerada ====
  await rnAbrirFicha(1);
  window.__tabelas.propostas.push({ id: 'pN', carteira_id: 1, valor_atual: 100, valor_proposto: 90, estagio: 'proposta_enviada', criado_em: '2026-11-09T12:00:00Z' });
  await rnPropostaGerada(1);
  await espera(20);
  eq(document.querySelectorAll('#rnFichaCorpo [data-rn-proposta]').length, 1, 'ficha mostra a proposta nova');

  // ==== I2: troca de usuário na mesma aba não deixa Kanban nem formulário da proposta do anterior ====
  rnFecharFicha();
  rnTrocarAba('kanban');
  assert(/Zz Do A/.test(document.getElementById('rnKanban').textContent), 'kanban de A na tela');
  rnTrocarAba('proposta');
  assert(!!document.getElementById('avTipo').closest('#rnProposta'), 'formulário na subaba');
  currentUser = { id: 'u-b', nome: 'Zzb Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  eq([document.getElementById('rnKanban').innerHTML, document.getElementById('rnKanban').hidden, document.getElementById('rnCarteira').hidden],
     ['', true, false], 'kanban limpo e carteira visível para o próximo usuário');
  eq(document.querySelector('#rnAbas .active').dataset.rnAba, 'carteira', 'subaba ativa volta para Carteira');
  assert(!!document.getElementById('avTipo').closest('#panel-proposta'), 'formulário volta para a aba Proposta');

  // ==== M6 (re-graduado): nome no cartão do funil antigo é escapado ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  funilConsultores = { 'u-x': { nome: '<b>Zz</b> X' } };
  funilCache = [{ id: 'pX', cliente_nome: '<img src=x onerror="window.__xss=1">Zz', estagio: 'proposta_enviada', consultor_id: 'u-x', estagio_entrada_em: '2026-11-08T12:00:00Z' }];
  renderFunil();
  const card = document.querySelector('.kanbanCard[data-id="pX"]');
  assert(!card.querySelector('img') && !card.querySelector('.kcConsultor b') && /<img/.test(card.textContent), 'cliente e consultor escapados no cartão do funil');
  fim();
`);
