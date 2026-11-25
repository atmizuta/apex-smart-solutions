// Testa a §165 — "Atividade do time": anotações de todos os consultores para admin/supervisor. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-25'; rnHoraSP = () => '10:00';
  const L = (o) => Object.assign({ razao_social: 'Zz', nome_adm: 'Zz Adm', linhas_voz: 1, apto: 'APTO', status: 1, na_base: true, consultor_id: 'u-a', cnpj_digits: '00000000000100' }, o);
  window.__tabelas.renovacao_carteira = [L({ id: 1, razao_social: 'Zz Um' }), L({ id: 2, razao_social: 'Zz Dois', consultor_id: 'u-b' })];
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }, { id: 'u-b', nome: 'Zzb Teste', equipe: 'renovacao' }, { id: 'u-adm', nome: 'Zzadm Teste' }];
  window.__tabelas.propostas = [];
  window.__tabelas.renovacao_notas = [
    { id: 1, carteira_id: 1, user_id: 'u-a', texto: 'Zz pediu desconto', fixada: false, criado_em: '2026-11-25T13:00:00Z' },
    { id: 2, carteira_id: 2, user_id: 'u-b', texto: 'Zz decisor viaja', fixada: true, criado_em: '2026-11-20T13:00:00Z' },
    { id: 3, carteira_id: 1, user_id: 'u-a', texto: 'Zz nota antiga', fixada: false, criado_em: '2026-09-01T13:00:00Z' },
  ];
  // consultor não vê a aba
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  eq(document.getElementById('rnAbaAtividade').style.display, 'none', 'consultor não vê Atividade do time');
  rnTrocarAba('atividade'); eq(rnEstado.aba, 'kanban', 'consultor não entra na visão por script');
  // admin
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  eq(document.getElementById('rnAbaAtividade').style.display, '', 'admin vê Atividade do time');
  await rnCarregar();
  rnTrocarAba('atividade'); await espera(60);
  const cards = () => [...document.querySelectorAll('#rnAtividade .rnAtvItem')].map(li => li.querySelector('.rnNotaTxt').textContent);
  eq(cards(), ['Zz pediu desconto', 'Zz decisor viaja'], '7 dias: só as recentes');
  assert(document.querySelector('#rnAtividade .rnAtvItem').textContent.includes('Zza Teste') && document.querySelector('#rnAtividade .rnAtvItem').textContent.includes('Zz Um'), 'mostra consultor e empresa');
  const sel = (k) => document.querySelector('#rnAtividade [data-rn-atv="' + k + '"]');
  sel('periodo').value = '1'; sel('periodo').dispatchEvent(new window.Event('change', { bubbles: true })); await espera(20);
  eq(cards(), ['Zz pediu desconto'], 'período Hoje');
  sel('periodo').value = '0'; sel('periodo').dispatchEvent(new window.Event('change', { bubbles: true })); await espera(20);
  eq(cards().length, 3, 'todo o período');
  sel('autor').value = 'u-b'; sel('autor').dispatchEvent(new window.Event('change', { bubbles: true })); await espera(20);
  eq(cards(), ['Zz decisor viaja'], 'filtra por consultor');
  sel('autor').value = ''; sel('autor').dispatchEvent(new window.Event('change', { bubbles: true })); await espera(20);
  const bu = sel('busca'); bu.value = 'dois'; bu.dispatchEvent(new window.Event('input', { bubbles: true })); await espera(20);
  eq(cards(), ['Zz decisor viaja'], 'busca pela empresa');
  const bu2 = sel('busca'); bu2.value = ''; bu2.dispatchEvent(new window.Event('input', { bubbles: true })); await espera(20);
  sel('fixadas').checked = true; sel('fixadas').dispatchEvent(new window.Event('change', { bubbles: true })); await espera(20);
  eq(cards(), ['Zz decisor viaja'], 'só fixadas');
  sel('fixadas').checked = false; sel('fixadas').dispatchEvent(new window.Event('change', { bubbles: true })); await espera(20);
  // exportar
  let saida = null; XLSX.writeFile = (wb, nome) => { saida = { wb, nome }; };
  document.querySelector('#rnAtividade [data-rn-atv-excel]').click();
  const linhas = XLSX.utils.sheet_to_json(saida.wb.Sheets['Anotações']);
  eq([saida.nome, linhas.length, linhas[0]['Consultor'], linhas[0]['Cliente'], linhas[0]['Anotação']], ['atividade_renovacao_2026-11-25.xlsx', 3, 'Zza Teste', 'Zz Um', 'Zz pediu desconto'], 'exporta o que está filtrado');
  // abrir a ficha do cliente
  document.querySelector('#rnAtividade [data-rn-atv-abrir="2"]').click(); await espera(40);
  eq([rnEstado.fichaId, document.getElementById('rnFicha').classList.contains('aberta')], [2, true], 'clicar no cliente abre a ficha');
  fim();
`);
