// Testa a §143.1 — aba Renovação: quem vê, carga, subabas e marcação do time na aba Consultores. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const btn = () => document.getElementById('tabBtnRenovacao');
  assert(!!btn() && btn().dataset.tab === 'renovacao', 'botão da aba existe');
  assert(!!document.getElementById('panel-renovacao'), 'painel existe');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao(); eq(btn().style.display, 'inline-block', 'time de renovação vê');
  currentUser = { id: 'u-x', nome: 'Zzx Teste', role: 'consultor', operacao: 'apex', equipe: null };
  rnAplicarPermissao(); eq(btn().style.display, 'none', 'consultor fora do time não vê');
  currentUser = { id: 'u-s', nome: 'Zzs Teste', role: 'supervisor', operacao: 'apex', equipe: null };
  rnAplicarPermissao(); eq(btn().style.display, 'inline-block', 'supervisor da Apex vê');
  currentUser = { id: 'u-c', nome: 'Zzc Teste', role: 'supervisor', operacao: 'campinas', equipe: null };
  rnAplicarPermissao(); eq(btn().style.display, 'none', 'supervisor de Campinas não vê');
  currentUser = { id: 'u-g', nome: 'Zzg Teste', role: 'agencia', operacao: 'apex', equipe: null };
  rnAplicarPermissao(); eq(btn().style.display, 'none', 'agência não vê');

  // carga ao abrir a aba
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [
    { id: 1, cnpj_digits: '00000000000101', razao_social: 'Zz Alfa', linhas_voz: 9, status: 2, prox_retorno: '2000-01-01', na_base: true, consultor_id: 'u-a' },
    { id: 2, cnpj_digits: '00000000000102', razao_social: 'Zz Beta', linhas_voz: 3, status: 7, prox_retorno: '2000-01-01', na_base: true, consultor_id: 'u-a' },
  ];
  btn().click();
  await espera(40);
  assert(rnEstado.carregado && rnEstado.lista.length === 2, 'abrir a aba carrega a carteira');
  eq(document.getElementById('rnBadgeMenu').textContent, '1', 'selo no menu = retornos vencidos (perdido não conta)');
  eq(document.getElementById('rnBadgeRetornos').textContent, '1', 'selo na subaba Retornos');
  eq(rnEstado.perfis.map(p => p.id), ['u-a'], 'consultor: lista de perfis é só ele');

  // subabas
  rnTrocarAba('resumo');
  assert(document.getElementById('rnCarteira').hidden && !document.getElementById('rnResumo').hidden, 'subaba Resumo aparece');
  assert(document.querySelector('#rnAbas [data-rn-aba="resumo"]').classList.contains('active'), 'botão da subaba ativo');
  document.querySelector('#rnAbas [data-rn-aba="carteira"]').click();
  assert(!document.getElementById('rnCarteira').hidden, 'clique volta para a Carteira');

  // aba Consultores: coluna Renovação, só admin marca, só consultor pode ser marcado
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  window.__tabelas.profiles = [
    { id: 'u-a', nome: 'Zza Teste', username: 'zz.a', role: 'consultor', equipe: 'renovacao' },
    { id: 'u-x', nome: 'Zzx Teste', username: 'zz.x', role: 'consultor', equipe: null },
    { id: 'u-s', nome: 'Zzs Teste', username: 'zz.s', role: 'supervisor', equipe: null },
  ];
  window.__tabelas.consultas_resumo = [];
  await renderUsersTable();
  const cx = (id) => document.querySelector('#usersTbody [data-rn-equipe="' + id + '"]');
  assert(cx('u-a').checked && !cx('u-a').disabled, 'admin vê marcado e pode mexer');
  assert(cx('u-s').disabled, 'supervisor não entra no time');
  window.__escritas.length = 0;
  cx('u-x').checked = true;
  cx('u-x').dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(20);
  const w = window.__escritas.find(e => e.tabela === 'profiles');
  assert(w && w.patch.equipe === 'renovacao' && JSON.stringify(w.filtros) === JSON.stringify([['eq', 'id', 'u-x']]), 'marcar grava equipe = renovacao');
  currentUser = { id: 'u-s', nome: 'Zzs Teste', role: 'supervisor', operacao: 'apex' };
  await renderUsersTable();
  assert(cx('u-a').disabled, 'supervisor vê mas não mexe');
  fim();
`);
