// Testa a §143.2 — o time de renovação vê só a Renovação no lugar de Busca/Proposta/Funil/Agenda. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const vis = () => ['busca', 'proposta', 'funil', 'agenda', 'renovacao'].map(t => document.querySelector('#tabsNav button[data-tab="' + t + '"]').style.display);
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  eq(vis(), ['none', 'none', 'none', 'none', 'inline-block'], 'time: só a Renovação');
  currentUser = { id: 'u-x', nome: 'Zzx Teste', role: 'consultor', operacao: 'apex', equipe: null };
  rnAplicarPermissao();
  eq(vis(), ['', '', '', '', 'none'], 'consultor fora do time: abas antigas de volta');
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  eq(vis(), ['', '', '', '', 'inline-block'], 'admin vê tudo');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [];
  document.querySelector('#dashFunil [data-tab="funil"]').click();
  await espera(30);
  assert(document.getElementById('tabBtnRenovacao').classList.contains('active') && rnEstado.aba === 'kanban', '"Ver funil completo" leva o time ao Kanban');
  currentUser = { id: 'u-x', nome: 'Zzx Teste', role: 'consultor', operacao: 'apex', equipe: null };
  rnAplicarPermissao();
  document.querySelector('#dashFunil [data-tab="funil"]').click();
  await espera(30);
  assert(document.querySelector('#tabsNav button[data-tab="funil"]').classList.contains('active'), 'os demais continuam indo ao Funil');
  fim();
`);
