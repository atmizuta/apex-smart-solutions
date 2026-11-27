// Testa a §165 — "Atividade do time": linha do tempo de tudo que os consultores fizeram (admin/supervisor). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-26'; rnHoraSP = () => '10:00';
  const L = (o) => Object.assign({ razao_social: 'Zz', nome_adm: 'Zz Adm', linhas_voz: 1, apto: 'APTO', status: 1, na_base: true, consultor_id: 'u-a', cnpj_digits: '00000000000100' }, o);
  window.__tabelas.renovacao_carteira = [L({ id: 1, razao_social: 'Zz Um' }), L({ id: 2, razao_social: 'Zz Dois', consultor_id: 'u-b' })];
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }, { id: 'u-b', nome: 'Zzb Teste', equipe: 'renovacao' }, { id: 'u-adm', nome: 'Zzadm Teste' }];
  window.__tabelas.propostas = [];
  window.__tabelas.renovacao_notas = [
    { id: 1, carteira_id: 1, user_id: 'u-a', texto: 'Zz pediu desconto', fixada: false, criado_em: '2026-11-26T13:00:00Z' },
    { id: 2, carteira_id: 2, user_id: 'u-b', texto: 'Zz decisor viaja', fixada: true, criado_em: '2026-11-20T13:00:00Z' },
  ];
  window.__tabelas.renovacao_historico = [
    { id: 1, carteira_id: 1, user_id: 'u-a', campo: 'status', de: '0', para: '2', nota: null, criado_em: '2026-11-26T14:00:00Z' },
    { id: 2, carteira_id: 2, user_id: 'u-b', campo: 'atendimento', de: null, para: 'canal, observação', nota: 'Zz caixa postal', criado_em: '2026-11-26T15:00:00Z' },
    { id: 3, carteira_id: 2, user_id: 'u-b', campo: 'status', de: '0', para: '1', nota: null, criado_em: '2026-11-19T15:00:00Z' },
    { id: 4, carteira_id: 1, user_id: 'u-adm', campo: 'consultor', de: 'u-a', para: 'u-b', nota: null, criado_em: '2026-11-26T16:00:00Z' },
  ];
  window.__tabelas.renovacao_contatos = [{ id: 1, carteira_id: 1, nome: 'Zz Maria', telefone: '19999990002', cargo: 'Sócia', criado_por: 'u-a', criado_em: '2026-11-26T17:00:00Z' }];
  window.__tabelas.renovacao_anexos = [{ id: 1, carteira_id: 2, tipo: 'fatura', nome: 'zz.pdf', user_id: 'u-b', criado_em: '2026-11-26T18:00:00Z' }];
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
  rnTrocarAba('atividade'); await espera(80);
  const tipos = () => [...document.querySelectorAll('#rnAtividade .rnAtvItem')].map(li => li.querySelector('.rnTag').textContent);
  const textos = () => [...document.querySelectorAll('#rnAtividade .rnAtvItem')].map(li => li.querySelector('.rnNotaTxt').textContent);
  eq(tipos(), ['Anexo enviado', 'Contato cadastrado', 'Trocou o consultor', 'Atendimento salvo', 'Mudou de etapa', 'Anotação'], 'abre em Hoje, tudo o que foi feito, mais recente primeiro');
  eq(textos()[3], 'Alterou: canal, observação — “Zz caixa postal”', 'atendimento mostra o que mudou e a observação');
  assert(textos()[4].includes('→') && textos()[4].includes('0-') && textos()[4].includes('2-'), 'mudança de etapa: de e para');
  assert(textos()[2] === 'de Zza Teste para Zzb Teste', 'troca de consultor: de quem para quem');
  const sel = (k) => document.querySelector('#rnAtividade [data-rn-atv="' + k + '"]');
  const muda = (k, v) => { sel(k).value = v; sel(k).dispatchEvent(new window.Event('change', { bubbles: true })); };
  eq(document.querySelectorAll('#rnAtividade .rnAtvChip').length, 3, 'resumo por consultor (chips)');
  muda('tipo', 'etapa'); await espera(20);
  eq(tipos(), ['Mudou de etapa'], 'filtra por tipo');
  muda('tipo', ''); await espera(20);
  document.querySelector('#rnAtividade [data-rn-atv-autor="u-b"]').click(); await espera(20);
  eq(tipos(), ['Anexo enviado', 'Atendimento salvo'], 'clicar no consultor filtra');
  document.querySelector('#rnAtividade [data-rn-atv-autor="u-b"]').click(); await espera(20);
  muda('periodo', '30'); await espera(20);
  eq(tipos().length, 8, '30 dias inclui os dias anteriores');
  const bu = sel('busca'); bu.value = 'dois'; bu.dispatchEvent(new window.Event('input', { bubbles: true })); await espera(20);
  assert(tipos().length > 0 && textos().every((t, i) => true), 'busca pela empresa');
  const bu2 = sel('busca'); bu2.value = ''; bu2.dispatchEvent(new window.Event('input', { bubbles: true })); await espera(20);
  // nova atividade aparece ao atualizar
  window.__tabelas.renovacao_notas.push({ id: 9, carteira_id: 1, user_id: 'u-a', texto: 'Zz nova', fixada: false, criado_em: '2026-11-26T19:00:00Z' });
  muda('periodo', '1'); await espera(20);
  eq(tipos().length, 6, 'sem atualizar não vê a nova');
  document.querySelector('#rnAtividade [data-rn-atv-atualizar]').click(); await espera(80);
  eq(tipos()[0], 'Anotação', 'Atualizar traz a nova atividade');
  // exportar
  let saida = null; XLSX.writeFile = (wb, nome) => { saida = { wb, nome }; };
  document.querySelector('#rnAtividade [data-rn-atv-excel]').click();
  const linhas = XLSX.utils.sheet_to_json(saida.wb.Sheets['Atividade']);
  eq([saida.nome, linhas.length, linhas[0]['Tipo'], linhas[0]['Detalhe']], ['atividade_renovacao_2026-11-26.xlsx', 7, 'Anotação', 'Zz nova'], 'exporta o que está filtrado');
  // abrir a ficha do cliente
  document.querySelector('#rnAtividade [data-rn-atv-abrir="2"]').click(); await espera(40);
  eq([rnEstado.fichaId, document.getElementById('rnFicha').classList.contains('aberta')], [2, true], 'clicar no cliente abre a ficha');
  fim();
`);
