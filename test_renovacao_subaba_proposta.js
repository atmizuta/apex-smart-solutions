// Testa a §143.2 — subaba Proposta e fatura (mesmo conteúdo da aba Proposta, movido). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [];
  await rnCarregar();
  const dentro = (id) => document.getElementById('avTipo').closest('#' + id);
  assert(!!dentro('panel-proposta'), 'começa na aba Proposta');
  assert(!!document.querySelector('#rnAbas [data-rn-aba="proposta"]'), 'botão da subaba');
  eq([...document.querySelectorAll('#rnAbas [data-rn-aba]')].map(b => b.dataset.rnAba), ['carteira', 'kanban', 'proposta', 'retornos', 'resumo'], 'ordem das subabas');
  rnTrocarAba('proposta');
  assert(!!dentro('rnProposta') && !document.getElementById('rnProposta').hidden, 'formulário vai para a subaba');
  eq(document.getElementById('panel-proposta').children.length, 0, 'nada duplicado');
  document.querySelector('#tabsNav button[data-tab="proposta"]').click();
  await espera(20);
  assert(!!dentro('panel-proposta'), 'aba Proposta normal pega o formulário de volta');
  document.getElementById('tabBtnRenovacao').click();
  await espera(20);
  rnTrocarAba('proposta');
  assert(!!dentro('rnProposta'), 'e volta para a subaba de novo');
  fim();
`);
