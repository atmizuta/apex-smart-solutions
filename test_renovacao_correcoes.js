// Testa as correções da revisão final da §143.1 (aba Renovação). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const X = window.XLSX;
  const montar = (abas) => {
    const wb = X.utils.book_new();
    abas.forEach(([nome, aoa]) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), nome));
    return X.read(X.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true });
  };
  const PERFIS = [{ id: 'u-b', nome: 'Zzbruno Teste', equipe: 'renovacao' }];
  const base = [
    ['CONSULTOR', 'CNPJ', 'Razão Social', 'STATUS', 'CANAL'],
    ['Zzbruno', '00000000000101', 'Zz Um', 'ATIVO', 'INDIRETO'],
    ['Zzbruno', '00000000000102', 'Zz Dois', 'ATIVO', 'INDIRETO'],
  ];

  // ==== #1 coluna da Claro com o mesmo nome depois das amarelas não apaga o atendimento ====
  const time = [
    ['Razão Social', 'STATUS ▼', 'CANAL ▼', 'LINHAS RENOV.', 'MOTIVO PERDA ▼', 'CNPJ', 'STATUS', 'CANAL'],
    ['Zz Um', '6-Renovado', 'WhatsApp', 3, '', '00000000000101', 'ATIVO', 'INDIRETO'],
    ['Zz Dois', '7-Perdido', 'Ligação', '', 'Preço', '00000000000102', 'ATIVO', 'INDIRETO'],
  ];
  let lido = rnLerArquivo(montar([['Base Completa', base], ['Zzbruno', time]]), PERFIS);
  eq(lido.linhas.map(l => [l.status, l.canal, l.linhas_renovadas, l.motivo_perda]), [[6, 'WhatsApp', 3, null], [7, 'Ligação', null, 'Preço']],
     'coluna amarela vence a coluna da Claro de mesmo nome');

  // ==== base nova da Claro com CONSULTOR de fora do time: entra sem consultor, sem travar ====
  lido = rnLerArquivo(montar([['Plan1', [['CONSULTOR', 'CNPJ', 'Razão Social'], ['Zz Gerente Conta', '00000000000103', 'Zz Três']]]]), PERFIS);
  eq([lido.formato, lido.erros, lido.linhas[0].consultor_id], ['base', [], null], 'base nova: CONSULTOR da Claro é ignorado');

  // ==== #2 prévia: contagem por status e por consultor, e aviso do atendimento que não será aplicado ====
  lido = rnLerArquivo(montar([['Base Completa', base], ['Zzbruno', time]]), PERFIS);
  const p = rnPrevia(lido.linhas, [{ cnpj_digits: '00000000000101', na_base: true }]);
  eq([p.novos, p.atualizados, p.ignorados], [1, 1, 1], 'atendimento de quem já existe é contado como não aplicado');
  eq(p.porStatus, { 6: 1, 7: 1 }, 'contagem por status do arquivo');
  eq(p.porConsultor, { 'u-b': 2 }, 'contagem por consultor do arquivo');
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [{ id: 9, cnpj_digits: '00000000000101', na_base: true, status: 1 }];
  window.__tabelas.profiles = PERFIS;
  window.__tabelas.renovacao_resumo = [];
  await rnCarregar();
  rnTrocarAba('resumo');
  await espera(30);
  const buf = X.write((() => { const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(base), 'Base Completa'); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(time), 'Zzbruno'); return wb; })(), { type: 'array', bookType: 'xlsx' });
  await rnPrepararImportacao({ arrayBuffer: async () => buf });
  const prev = document.getElementById('rnPrevia').textContent.replace(/\\s+/g, ' ');
  assert(/atendimento das abas NÃO será aplicado a 1 cliente/.test(prev), 'prévia avisa o atendimento ignorado: ' + prev);
  assert(/6-Renovado: 1/.test(prev) && /7-Perdido: 1/.test(prev), 'prévia mostra a contagem por status');
  assert(/Zzbruno Teste: 2/.test(prev), 'prévia mostra a contagem por consultor');

  // ==== #3 data digitada na lista só grava ao sair do campo, e ano absurdo não grava ====
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [{ id: 1, cnpj_digits: '00000000000101', razao_social: 'Zz Um', linhas_voz: 2, status: 2, prox_retorno: null, na_base: true, consultor_id: 'u-a' }];
  await rnCarregar();
  const dt = () => document.querySelector('#rnTbody tr[data-rn-id="1"] [data-rn-campo="prox_retorno"]');
  window.__escritas.length = 0;
  dt().value = '2026-11-02'; dt().dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(20);
  eq(window.__escritas.length, 0, 'change no meio da digitação não grava');
  dt().value = '0002-11-15'; dt().dispatchEvent(new window.Event('focusout', { bubbles: true }));
  await espera(20);
  eq(window.__escritas.length, 0, 'ano antes de 2020 não grava');
  dt().value = '2026-11-15'; dt().dispatchEvent(new window.Event('focusout', { bubbles: true }));
  await espera(20);
  eq(window.__escritas.map(w => w.patch), [{ prox_retorno: '2026-11-15' }], 'sair do campo grava a data');
  window.__escritas.length = 0;
  dt().dispatchEvent(new window.Event('focusout', { bubbles: true }));
  await espera(20);
  eq(window.__escritas.length, 0, 'sair sem mudar não grava de novo');

  // ==== #4 carteira recarrega ao entrar na aba se estiver velha; ficha manda só o que mudou ====
  window.__tabelas.renovacao_carteira.push({ id: 2, cnpj_digits: '00000000000102', razao_social: 'Zz Redistribuído', linhas_voz: 1, status: 1, na_base: true, consultor_id: 'u-a' });
  document.getElementById('tabBtnRenovacao').click();
  await espera(30);
  eq(rnEstado.lista.length, 1, 'carga recente: só redesenha');
  rnEstado.carregadoEm = Date.now() - 3 * 60 * 1000;
  document.getElementById('tabBtnRenovacao').click();
  await espera(30);
  eq(rnEstado.lista.length, 2, 'carga velha: recarrega e traz o redistribuído');

  await rnAbrirFicha(1);
  window.__escritas.length = 0;
  const f = document.getElementById('rnFichaForm');
  f.elements.observacoes.value = 'Zz ligar cedo';
  f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await espera(20);
  eq(window.__escritas.map(w => w.patch), [{ observacoes: 'Zz ligar cedo' }], 'ficha manda só o campo alterado');
  window.__escritas.length = 0;
  let aviso = null; const avisoOrig = mostrarAviso; mostrarAviso = (m, t) => { aviso = [m, t]; };
  document.getElementById('rnFichaForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await espera(20);
  eq([window.__escritas.length, aviso], [0, ['Nada mudou no atendimento.', 'info']], 'sem mudança não grava');
  mostrarAviso = avisoOrig;
  fim();
`);
