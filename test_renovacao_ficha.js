// Testa a §143.1 — ficha do cliente da Renovação: grupos da Claro, histórico, atendimento e legado a completar. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const dados = { 'Tempo de contrato (Voz)': 21, 'SCORE': 7, 'POSSUI MÓVEL TIM': 'SIM', 'CEP CABEADO?': 'NÃO', 'Coluna Rara': 'x', 'telefone_1': '' };
  const g = rnGruposFicha(dados);
  eq(g.map(x => x[0]), ['Contrato e linhas', 'Concorrência', 'Fixa e cabeamento', 'Tudo'], 'só grupos com dado, Tudo no fim');
  eq(g[0][1], [['Tempo de contrato (Voz)', 21], ['SCORE', 7]], 'itens do grupo na ordem do grupo');
  eq(g[3][1].map(x => x[0]), ['CEP CABEADO?', 'Coluna Rara', 'POSSUI MÓVEL TIM', 'SCORE', 'Tempo de contrato (Voz)'], 'Tudo: todas as colunas com valor, em ordem alfabética');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [
    { id: 1, cnpj_digits: '00000000000101', razao_social: 'Zz Alfa', telefone: '11900000001', cidade: 'Zz Cidade', linhas_voz: 4, status: 3, na_base: true, consultor_id: 'u-a', dados_claro: dados },
    { id: 2, cnpj_digits: '00000000000102', razao_social: 'Zz Legado', telefone: null, linhas_voz: 2, status: 7, motivo_perda: null, a_completar: true, na_base: true, consultor_id: 'u-a', dados_claro: {} },
  ];
  window.__tabelas.renovacao_historico = [
    { carteira_id: 1, campo: 'status', de: '1', para: '3', user_id: 'u-a', criado_em: '2026-11-05T15:00:00Z' },
  ];
  await rnCarregar();
  document.querySelector('#rnTbody [data-rn-abrir="1"]').click();
  await espera(40);
  const ficha = document.getElementById('rnFicha');
  assert(ficha.classList.contains('aberta'), 'clicar no nome abre a ficha');
  const corpo = document.getElementById('rnFichaCorpo');
  assert(/00\\.000\\.000\\/0001-01/.test(corpo.textContent), 'CNPJ formatado');
  assert(corpo.querySelector('a[href^="https://wa.me/5511900000001"]') && corpo.querySelector('a[href="tel:11900000001"]'), 'WhatsApp e Ligar');
  eq([...corpo.querySelectorAll('details.rnGrupo summary')].map(s => s.firstChild.textContent.trim()), ['Contrato e linhas', 'Concorrência', 'Fixa e cabeamento', 'Tudo'], 'grupos na ficha');
  assert(/05\\/11 · Zza Teste: 1-Não contatado → 3-Contato efetivo/.test(corpo.textContent), 'histórico legível');

  // salvar atendimento
  window.__escritas.length = 0;
  const form = document.getElementById('rnFichaForm');
  form.elements.prox_retorno.value = '2026-11-20';
  form.elements.observacoes.value = '  Zz ligar de manhã  ';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await espera(20);
  const p = window.__escritas[0].patch;
  eq([p.status, p.prox_retorno, p.observacoes, p.canal], [3, '2026-11-20', 'Zz ligar de manhã', null], 'grava o atendimento');

  // perdido sem motivo na ficha é barrado...
  window.__escritas.length = 0;
  document.getElementById('rnFichaForm').elements.status.value = '7';
  document.getElementById('rnFichaForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await espera(20);
  eq(document.getElementById('rnFichaErro').textContent, 'Escolha o motivo da perda.', 'ficha usa a mesma regra');
  eq(window.__escritas.length, 0, 'nada gravado');

  // ...mas o legado a completar salva só a observação sem mudar o status
  rnFecharFicha();
  assert(!ficha.classList.contains('aberta'), 'fechar a ficha');
  await rnAbrirFicha(2);
  const f2 = document.getElementById('rnFichaForm');
  assert(!document.querySelector('#rnFichaCorpo a[href^="https://wa.me"]') && /Sem telefone/.test(document.getElementById('rnFichaCorpo').textContent), 'sem telefone avisa');
  f2.elements.observacoes.value = 'Zz cliente fechou a empresa';
  f2.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await espera(20);
  eq(window.__escritas.length, 1, 'legado salva observação mesmo perdido sem motivo');
  fim();
`);
