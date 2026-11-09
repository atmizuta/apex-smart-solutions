// Testa a §143.2 — Kanban da Renovação. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-09';
  const agora = new Date('2026-11-09T15:00:00Z').getTime();
  eq([rnDiasNoStatus({ status_desde: '2026-11-06T15:00:00Z' }, agora), rnDiasNoStatus({ status_desde: '2026-11-09T10:00:00Z' }, agora), rnDiasNoStatus({}, agora)], [3, 0, null], 'dias no status');
  const L = (o) => Object.assign({ razao_social: 'Zz', linhas_voz: 1, na_base: true, consultor_id: 'u-a', status_desde: '2026-11-08T12:00:00Z' }, o);
  const lista = [L({ id: 1, status: 3, linhas_voz: 5 }), L({ id: 2, status: 3, linhas_voz: 9 }), L({ id: 3, status: 5 }), L({ id: 4, status: 1 }),
                 L({ id: 5, status: 7, motivo_perda: 'Preço' }), L({ id: 6, status: 4, na_base: false }), L({ id: 7, status: 6, linhas_renovadas: 2, consultor_id: 'u-b' })];
  const cols = rnKanbanColunas(lista, rnFiltrosVazios(), '2026-11-09');
  eq(cols.map(c => [c.status, c.itens.map(r => r.id)]), [[3, [2, 1]], [4, []], [5, [3]], [6, [7]], [7, [5]]], 'colunas 3–7, só na base, mais linhas primeiro');
  eq(rnKanbanColunas(lista, Object.assign(rnFiltrosVazios(), { consultor: 'u-b' }), '2026-11-09').map(c => c.itens.length), [0, 0, 0, 1, 0], 'respeita o filtro de consultor');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = lista.filter(r => r.consultor_id === 'u-a');
  window.__tabelas.propostas = [{ id: 'p1', carteira_id: 3, valor_proposto: 1234.5, criado_em: '2026-11-08T10:00:00Z' }];
  await rnCarregar();
  assert(!!document.querySelector('#rnAbas [data-rn-aba="kanban"]'), 'botão da subaba Kanban');
  rnTrocarAba('kanban');
  assert(!document.getElementById('rnKanban').hidden && document.getElementById('rnCarteira').hidden, 'subaba Kanban aparece');
  const colunas = [...document.querySelectorAll('#rnKanban [data-rn-coluna]')];
  eq(colunas.map(c => c.dataset.rnColuna), ['3', '4', '5', '6', '7'], '5 colunas');
  const card3 = document.querySelector('#rnKanban [data-rn-card="3"]').textContent.replace(/\\s+/g, ' ');
  assert(/1.234,50/.test(card3), 'cartão mostra o valor da proposta: ' + card3);
  assert(/no status/.test(card3), 'cartão mostra os dias no status');

  // arrastar 3 → 5 grava o status
  window.__escritas.length = 0;
  const arrastar = (id, para) => {
    document.querySelector('#rnKanban [data-rn-card="' + id + '"]').dispatchEvent(new window.Event('dragstart', { bubbles: true }));
    document.querySelector('#rnKanban [data-rn-coluna="' + para + '"]').dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true }));
  };
  arrastar(1, 5);
  await espera(30);
  eq(window.__escritas.map(w => w.patch), [{ status: 5 }], 'soltar em outra coluna grava o status');
  assert(!!document.querySelector('#rnKanban [data-rn-coluna="5"] [data-rn-card="1"]'), 'cartão mudou de coluna');
  // soltar em Perdido abre a janela, não grava direto
  window.__escritas.length = 0;
  arrastar(2, 7);
  await espera(20);
  assert(document.getElementById('rnFechamento').classList.contains('active') && !!document.getElementById('rnFechMotivo'), 'Perdido abre a janela do motivo');
  eq(window.__escritas.length, 0, 'nada gravado antes do motivo');
  document.querySelector('#rnFechamento [data-rn-fech-cancelar]').click();
  await espera(200);
  // mesma coluna não grava
  arrastar(3, 5);
  await espera(20);
  eq(window.__escritas.length, 0, 'mesma coluna não grava');

  // botões do cartão
  const gerou = []; const gerarOrig = rnGerarProposta; rnGerarProposta = (id) => { gerou.push(id); };
  document.querySelector('#rnKanban [data-rn-card="3"] [data-rn-gerar]').click();
  eq(gerou, [3], 'Gerar proposta no cartão');
  rnGerarProposta = gerarOrig;
  document.querySelector('#rnKanban [data-rn-card="3"] [data-rn-abrir]').click();
  await espera(30);
  assert(document.getElementById('rnFicha').classList.contains('aberta'), 'clicar no nome abre a ficha');
  fim();
`);
