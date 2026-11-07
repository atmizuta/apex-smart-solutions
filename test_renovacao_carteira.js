// Testa a §143.1 — Carteira da Renovação: filtros, cores, edição, janela de fechamento e redistribuição. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const L = (o) => Object.assign({ id: 0, cnpj_digits: '00000000000100', razao_social: 'Zz', nome_adm: 'Zz Adm', linhas_voz: 1, apto: 'APTO',
    cidade: 'Zz Cidade', consultor_id: 'u-a', status: 1, prox_retorno: null, canal: null, linhas_renovadas: null, motivo_perda: null,
    observacoes: null, na_base: true, a_completar: false }, o);
  const HOJE = '2026-11-07';
  const base = () => [
    L({ id: 1, cnpj_digits: '00000000000101', razao_social: 'Zz Ácido Ltda', linhas_voz: 3, status: 2, prox_retorno: '2026-11-01' }),
    L({ id: 2, cnpj_digits: '00000000000102', razao_social: 'Zz Beta', linhas_voz: 30, status: 7, motivo_perda: 'Preço', prox_retorno: '2026-11-01', cidade: 'Zz Outra' }),
    L({ id: 3, cnpj_digits: '00000000000103', razao_social: 'Zz Gama', linhas_voz: 30, status: 6, linhas_renovadas: 2, consultor_id: 'u-b' }),
    L({ id: 4, cnpj_digits: '00000000000104', razao_social: 'Zz Delta', linhas_voz: 8, status: 7, a_completar: true, consultor_id: null }),
    L({ id: 5, cnpj_digits: '00000000000105', razao_social: 'Zz Fora', linhas_voz: 99, na_base: false }),
  ];

  // ==== funções puras ====
  eq(rnFiltrar(base(), rnFiltrosVazios(), HOJE).map(r => r.id), [2, 3, 4, 1], 'só na base, mais linhas primeiro, empate por nome');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { foraBase: true }), HOJE).map(r => r.id), [5], 'Fora da base mostra só eles');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { busca: 'acido' }), HOJE).map(r => r.id), [1], 'busca sem acento');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { busca: '0103' }), HOJE).map(r => r.id), [3], 'busca por pedaço do CNPJ');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { soVencido: true }), HOJE).map(r => r.id), [1], 'vencido ignora perdido');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { pendencias: true }), HOJE).map(r => r.id), [4], 'Pendências');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { consultor: '-' }), HOJE).map(r => r.id), [4], 'Sem consultor');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { consultor: 'u-b' }), HOJE).map(r => r.id), [3], 'por consultor');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { status: '7', cidade: 'Zz Outra' }), HOJE).map(r => r.id), [2], 'status + cidade');
  eq(rnContadores(base(), HOJE), { total: 4, pctNaoContatado: 0, vencidos: 1, pendencias: 1 }, 'contadores');
  eq([rnClasseLinha({ status: 7 }), rnClasseLinha({ status: 6 }), rnClasseLinha({ status: 3 })], ['rnPerdido', 'rnRenovado', ''], 'cores');
  eq(rnValidarFechamento(7, {}), 'Escolha o motivo da perda.', 'perdido sem motivo');
  eq(rnValidarFechamento(7, { motivo_perda: 'Preço' }), null, 'perdido com motivo');
  eq(rnValidarFechamento(6, { linhas_renovadas: 0 }), 'Informe quantas linhas foram renovadas.', 'renovado sem linhas');
  eq(rnValidarFechamento(6, { linhas_renovadas: 3 }), null, 'renovado com linhas');
  eq(rnStatusRotulo(3), '3-Contato efetivo', 'rótulo do status');

  // ==== consultor: render e edição ====
  rnHoje = () => HOJE;   // a tela usa o "hoje" de SP; o teste fixa a data
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = base().filter(r => r.consultor_id === 'u-a');
  await rnCarregar();
  const linhas = () => [...document.querySelectorAll('#rnTbody tr[data-rn-id]')];
  eq(linhas().map(t => t.dataset.rnId), ['2', '1'], 'consultor vê os dele na base');
  assert(linhas()[0].classList.contains('rnPerdido'), 'linha do perdido fica vermelha');
  eq(document.querySelectorAll('#rnTbody [data-rn-sel]').length, 0, 'consultor não seleciona para redistribuir');
  assert(document.getElementById('rnFConsultor').style.display === 'none', 'consultor não tem filtro de consultor');
  assert(/2<\\/b> clientes/.test(document.getElementById('rnContadores').innerHTML), 'contador de clientes');

  window.__escritas.length = 0;
  const canal = linhas()[1].querySelector('[data-rn-campo="canal"]');
  canal.value = 'WhatsApp'; canal.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(20);
  eq(window.__escritas.map(w => [w.patch, w.filtros]), [[{ canal: 'WhatsApp' }, [['eq', 'id', 1]]]], 'canal grava na hora');
  eq(rnEstado.lista.find(r => r.id === 1).canal, 'WhatsApp', 'lista local atualizada com o que voltou do banco');

  // mudar para Perdido abre a janela; cancelar volta o select e não grava
  window.__escritas.length = 0;
  let st = document.querySelector('#rnTbody tr[data-rn-id="1"] [data-rn-campo="status"]');
  st.value = '7'; st.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(10);
  const ov = document.getElementById('rnFechamento');
  assert(ov && ov.classList.contains('active') && !!document.getElementById('rnFechMotivo'), 'Perdido abre a janela com motivo');
  document.querySelector('#rnFechamento [data-rn-fech-cancelar]').click();
  await espera(200);
  eq(window.__escritas.length, 0, 'cancelar não grava');
  eq(document.querySelector('#rnTbody tr[data-rn-id="1"] [data-rn-campo="status"]').value, '2', 'cancelar volta o status');

  // salvar sem motivo avisa; com motivo grava status + motivo juntos
  st = document.querySelector('#rnTbody tr[data-rn-id="1"] [data-rn-campo="status"]');
  st.value = '7'; st.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(10);
  document.querySelector('#rnFechamento [data-rn-fech-salvar]').click();
  await espera(10);
  eq(document.getElementById('rnFechErro').textContent, 'Escolha o motivo da perda.', 'sem motivo não salva');
  eq(window.__escritas.length, 0, 'nada gravado sem motivo');
  document.getElementById('rnFechMotivo').value = 'Sem interesse';
  document.querySelector('#rnFechamento [data-rn-fech-salvar]').click();
  await espera(20);
  eq(window.__escritas[0].patch, { status: 7, motivo_perda: 'Sem interesse', observacoes: null }, 'grava status e motivo juntos');

  // Renovado pede linhas
  window.__escritas.length = 0;
  st = document.querySelector('#rnTbody tr[data-rn-id="2"] [data-rn-campo="status"]');
  st.value = '6'; st.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(10);
  document.getElementById('rnFechLinhas').value = '5';
  document.getElementById('rnFechBl').value = '1';
  document.querySelector('#rnFechamento [data-rn-fech-salvar]').click();
  await espera(20);
  eq(window.__escritas[0].patch, { status: 6, linhas_renovadas: 5, bl_vendida: 1, sol_digitais: null }, 'renovado grava linhas, BL e digitais');

  // erro do banco vira aviso
  let aviso = null; const avisoOrig = mostrarAviso; mostrarAviso = (m, t) => { aviso = [m, t]; };
  window.__resp.renovacao_carteira = (q) => q.op === 'update' ? { data: null, error: { message: 'Perdido precisa do motivo' } } : { data: window.__tabelas.renovacao_carteira, error: null };
  const salvou = await rnSalvar(1, { status: 7 });
  eq([salvou, aviso], [false, ['Perdido precisa do motivo', 'erro']], 'mensagem da regra do banco aparece');
  window.__resp.renovacao_carteira = (q) => q.op === 'update' ? { data: null, error: { message: 'connection reset' } } : { data: window.__tabelas.renovacao_carteira, error: null };
  await rnSalvar(1, { canal: 'Visita' });
  eq(aviso, ['Não foi possível salvar agora. Tente de novo.', 'erro'], 'erro técnico vira mensagem simples');
  delete window.__resp.renovacao_carteira; mostrarAviso = avisoOrig;

  // ==== gestor: filtro de consultor, seleção e redistribuição ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = base();
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }, { id: 'u-b', nome: 'Zzb Teste', equipe: 'renovacao' }];
  await rnCarregar();
  assert(document.getElementById('rnFConsultor').style.display === '', 'gestor tem filtro de consultor');
  assert(/Zzb Teste/.test(document.querySelector('#rnTbody tr[data-rn-id="3"]').textContent), 'gestor vê a coluna Consultor');
  const sel = (id) => { const c = document.querySelector('#rnTbody [data-rn-sel="' + id + '"]'); c.checked = true; c.dispatchEvent(new window.Event('change', { bubbles: true })); };
  sel(4); sel(1);
  assert(document.getElementById('rnRedistribuir').style.display === '', 'barra de redistribuir aparece com seleção');
  document.getElementById('rnPassarPara').value = 'u-b';
  window.__escritas.length = 0;
  await rnRedistribuir();
  const w = window.__escritas[0];
  eq([w.patch, w.filtros[0][0], w.filtros[0][2].slice().sort()], [{ consultor_id: 'u-b' }, 'in', [1, 4]], 'passa os selecionados de uma vez');
  eq(rnEstado.lista.filter(r => r.consultor_id === 'u-b').map(r => r.id).sort(), [1, 3, 4], 'lista local atualizada');
  eq(rnEstado.selecionados.size, 0, 'seleção limpa');
  fim();
`);
