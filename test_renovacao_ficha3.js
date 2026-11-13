// Testa a §151 — ficha nova: "Como foi o contato?", retorno com hora, canal, salvar e próximo, abas. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-13'; rnHoraSP = () => '16:00';
  const L = (o) => Object.assign({ razao_social: 'Zz', nome_adm: 'Zz Adm', telefone: '19900000001', linhas_voz: 1, apto: 'APTO', status: 3, na_base: true, consultor_id: 'u-a', dados_claro: { SCORE: 7 } }, o);
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [
    L({ id: 1, razao_social: 'Zz Um', prox_retorno: '2026-11-10' }), L({ id: 2, razao_social: 'Zz Dois', prox_retorno: '2026-11-11' }),
    L({ id: 3, razao_social: 'Zz Tres', prox_retorno: '2026-11-13', retorno_hora: '18:00' }), L({ id: 4, razao_social: 'Zz Perdido', status: 7, motivo_perda: 'Preço' }),
  ];
  window.__tabelas.propostas = []; window.__tabelas.renovacao_historico = [];
  await rnCarregar(); await espera(40);
  eq(rnEstado.fichaId, 1, 'ficha no primeiro atrasado');
  const form = () => document.getElementById('rnFichaForm');
  const bt = (s) => document.querySelector('#rnFichaForm [data-rn-contato="' + s + '"]');
  eq([...document.querySelectorAll('#rnFichaForm [data-rn-contato]')].map(b => b.textContent.trim()),
     ['Não atendeu', 'Falei com o responsável', 'Mandei proposta', 'Negociando', 'Renovou ✓', 'Perdido'], 'botões do contato');
  assert(bt(3).classList.contains('on') && form().elements.status.value === '3', 'status atual marcado');

  // Não atendeu sugere amanhã na mesma hora; trocar de botão não perde o texto nem grava
  form().elements.prox_retorno.value = '';
  form().elements.observacoes.value = 'Zz caixa postal';
  bt(2).click();
  eq([form().elements.status.value, form().elements.prox_retorno.value, form().elements.retorno_hora.value], ['2', '2026-11-14', '16:00'], 'Não atendeu: amanhã, mesma hora');
  bt(7).click();
  assert(!document.querySelector('[data-rn-grupo="perdido"]').hidden && document.querySelector('[data-rn-grupo="retorno"]').hidden, 'Perdido mostra o motivo no lugar do retorno');
  bt(2).click();
  eq([form().elements.observacoes.value, window.__escritas.length], ['Zz caixa postal', 0], 'trocar de botão não perde o texto nem grava');

  // WhatsApp marca o canal
  document.querySelector('#rnFichaCorpo [data-rn-canal="WhatsApp"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  eq(form().elements.canal.value, 'WhatsApp', 'clicar em WhatsApp marca o canal');

  // Perdido sem motivo e Renovou sem linhas são barrados
  bt(7).click(); form().elements.motivo_perda.value = '';
  form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await espera(10);
  eq([document.getElementById('rnFichaErro').textContent, window.__escritas.length], ['Escolha o motivo da perda.', 0], 'perdido exige motivo');
  bt(6).click();
  form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await espera(10);
  eq(document.getElementById('rnFichaErro').textContent, 'Informe quantas linhas foram renovadas.', 'renovou exige linhas');

  // Salvar e próximo: grava status/retorno/hora/canal/obs e abre o próximo da fila
  bt(2).click();
  form().elements.prox_retorno.value = '2026-11-20'; form().elements.retorno_hora.value = '09:30';
  document.querySelector('#rnFichaForm [data-rn-proximo]').click();
  await espera(40);
  const w = window.__escritas.find(x => x.tabela === 'renovacao_carteira');
  eq(w.patch, { status: 2, data_contato: '2026-11-13', prox_retorno: '2026-11-20', retorno_hora: '09:30', canal: 'WhatsApp', observacoes: 'Zz caixa postal' }, 'grava o atendimento com o contato de hoje');
  eq(rnEstado.fichaId, 2, 'abre o próximo (o 1 saiu da fila)');
  assert(!document.querySelector('#rnFilaLista [data-rn-abrir="1"]'), 'o cliente salvo saiu da fila');
  window.__escritas.length = 0;
  document.querySelector('#rnFichaForm [data-rn-proximo]').click();
  await espera(40);
  eq([window.__escritas.length, rnEstado.fichaId], [0, 3], 'sem mudança: não grava e vai para o próximo');

  // abas da ficha
  const aba = (k) => document.querySelector('#rnFichaCorpo [data-rn-ficha-aba="' + k + '"]');
  aba('dados').click();
  assert(!document.querySelector('[data-rn-ficha-sec="dados"]').hidden && document.querySelector('[data-rn-ficha-sec="atendimento"]').hidden, 'aba Dados da Claro');
  assert(/SCORE/.test(document.querySelector('[data-rn-ficha-sec="dados"]').textContent), 'mostra os dados da Claro');
  aba('atendimento').click();

  // perdido: sem Gerar proposta; fora da Central só "Salvar"
  rnTrocarAba('carteira'); await rnAbrirFicha(4);
  assert(!document.querySelector('#rnFichaCorpo [data-rn-gerar]') && /Reabra o status/.test(document.getElementById('rnFichaCorpo').textContent), 'perdido sem Gerar proposta');
  assert(!document.querySelector('#rnFichaForm [data-rn-proximo]'), 'fora da Central não tem Salvar e próximo');
  fim();
`);
