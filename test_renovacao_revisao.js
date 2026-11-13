// Testa as correções da revisão final da §151 (redesign da Renovação). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-13'; rnHoraSP = () => '16:00';
  const L = (o) => Object.assign({ razao_social: 'Zz', nome_adm: 'Zz Adm', telefone: '19900000001', linhas_voz: 1, apto: 'APTO', status: 3, na_base: true, consultor_id: 'u-a', dados_claro: {} }, o);
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [
    L({ id: 1, razao_social: 'Zz A', prox_retorno: '2026-11-10' }), L({ id: 2, razao_social: 'Zz B', prox_retorno: '2026-11-11' }),
    L({ id: 3, razao_social: 'Zz C', prox_retorno: '2026-11-12' }), L({ id: 4, razao_social: 'Zz D', prox_retorno: '2026-11-13', retorno_hora: '18:00' }),
  ];
  window.__tabelas.propostas = []; window.__tabelas.renovacao_historico = [];
  await rnCarregar(); await espera(40);
  const form = () => document.getElementById('rnFichaForm');
  const bt = (s) => document.querySelector('#rnFichaForm [data-rn-contato="' + s + '"]');
  const proximo = async () => { document.querySelector('#rnFichaForm [data-rn-proximo]').click(); await espera(40); };
  eq(rnEstado.fichaId, 1, 'começa no mais atrasado (A)');

  // ==== Não atendeu num atrasado sugere amanhã na mesma hora ====
  bt(2).click();
  eq([form().elements.prox_retorno.value, form().elements.retorno_hora.value], ['2026-11-14', '16:00'], 'Não atendeu em cliente atrasado sugere amanhã');

  // ==== Salvar e próximo segue a ordem que estava na tela ====
  bt(5).click(); form().elements.prox_retorno.value = '2026-11-13'; form().elements.retorno_hora.value = '15:00';
  await proximo();   // A continua atrasado, mas desce para depois do C
  eq(rnEstado.fichaId, 2, 'A → B (não pula para o D)');
  await rnAbrirFicha(3); await espera(20);
  form().elements.prox_retorno.value = '2026-11-20';
  await proximo();   // fila na tela era B, C, A, D
  eq(rnEstado.fichaId, 1, 'C → A (o seguinte na tela; não volta para o B)');

  // ==== o que foi digitado na ficha não se perde ====
  form().elements.observacoes.value = 'Zz digitando';
  const bh = document.getElementById('rnHojeBusca'); bh.value = 'Zz'; bh.dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(form().elements.observacoes.value, 'Zz digitando', 'buscar na fila não apaga o que foi digitado');
  rnTrocarAba('carteira'); rnTrocarAba('hoje');
  eq(form().elements.observacoes.value, 'Zz digitando', 'ir à Carteira e voltar não apaga');
  window.__resp.renovacao_carteira = (q) => (q.op === 'update' ? { data: null, error: { message: 'x' } } : { data: window.__tabelas.renovacao_carteira.map(l => Object.assign({}, l)), error: null });
  form().elements.prox_retorno.value = '2026-11-21';
  form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await espera(30);
  eq([form().elements.observacoes.value, form().elements.prox_retorno.value], ['Zz digitando', '2026-11-21'], 'falha ao salvar não apaga o formulário');
  delete window.__resp.renovacao_carteira;
  await rnAbrirFicha(2); await espera(20);
  eq(form().elements.observacoes.value, '', 'abrir outro cliente mostra a ficha dele');

  // ==== Resumo no celular: cabeçalho fica e a tabela rola de lado ====
  const css = [...document.querySelectorAll('style')].map(s => s.textContent).join(' ');
  assert(css.includes('#rnCarteira .rnTabela thead{display:none;}') && !css.replace('#rnCarteira .rnTabela thead{display:none;}', '').includes('.rnTabela thead{display:none;}'), 'só a Carteira esconde o cabeçalho no celular');
  assert(/\\.rnTabelaCasa\\{[^}]*overflow-x:auto/.test(css), 'tabela larga rola de lado');
  fim();
`);
