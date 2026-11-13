// Testa a §151 — base do redesign da Renovação: subabas, hora do retorno, selo. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const css = [...document.querySelectorAll('style')].map(s => s.textContent).join(' ');
  assert(/#panel-meusleads,#kbFicha,#kbPassar,#panel-renovacao,#rnFicha\\{--ml-ink/.test(css), 'tokens do §126 valem na Renovação');
  eq([...document.querySelectorAll('#rnAbas [data-rn-aba]')].map(b => [b.dataset.rnAba, b.childNodes[0].textContent.trim()]),
     [['hoje', 'Hoje'], ['carteira', 'Carteira'], ['kanban', 'Funil'], ['resumo', 'Resumo'], ['proposta', 'Proposta e fatura']], 'subabas na ordem');
  assert(!document.getElementById('rnRetornos'), 'Retornos deixou de ser subaba');

  const ag = { data: '2026-11-13', hora: '16:00' };
  const R = (o) => Object.assign({ status: 3, na_base: true }, o);
  eq([rnEstadoRetorno(R({ prox_retorno: '2026-11-12' }), ag), rnEstadoRetorno(R({ prox_retorno: '2026-11-13', retorno_hora: '15:00:00' }), ag),
      rnEstadoRetorno(R({ prox_retorno: '2026-11-13', retorno_hora: '17:00' }), ag), rnEstadoRetorno(R({ prox_retorno: '2026-11-13' }), ag),
      rnEstadoRetorno(R({ prox_retorno: '2026-11-14' }), ag), rnEstadoRetorno(R({ prox_retorno: '2026-11-01', status: 6 }), ag), rnEstadoRetorno(R({}), ag)],
     ['atrasado', 'atrasado', 'hoje', 'hoje', 'futuro', null, null], 'estado do retorno com hora');
  eq([rnRetornoVencido(R({ prox_retorno: '2026-11-13', retorno_hora: '10:00' }), '2026-11-13'), rnRetornoVencido(R({ prox_retorno: '2026-11-12' }), '2026-11-13')],
     [false, true], 'com só a data (texto) vale a regra antiga');
  eq([rnTextoAtraso(R({ prox_retorno: '2026-11-10' }), ag), rnTextoAtraso(R({ prox_retorno: '2026-11-12' }), ag), rnTextoAtraso(R({ prox_retorno: '2026-11-13', retorno_hora: '09:30:00' }), ag)],
     ['há 3 dias', 'há 1 dia', 'era 09:30'], 'texto do atraso');
  eq([rnIniciais('Padaria Pão Dourado Ltda'), rnIniciais('X'), rnIniciais('')], ['PP', 'X', '?'], 'iniciais');
  assert(/rnSt5/.test(rnEtapaHtml(5)) && /Em negociação/.test(rnEtapaHtml(5)), 'etiqueta da etapa');
  assert(/^\\d{2}:\\d{2}$/.test(rnHoraSP()) && rnAgora().data === rnHoje(), 'agora em SP');

  // tela inicial e selo com hora
  rnHoje = () => '2026-11-13'; rnHoraSP = () => '16:00';
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [R({ id: 1, prox_retorno: '2026-11-13', retorno_hora: '15:00', consultor_id: 'u-a' }), R({ id: 2, prox_retorno: '2026-11-13', retorno_hora: '18:00', consultor_id: 'u-a' }), R({ id: 3, prox_retorno: '2026-11-12', consultor_id: 'u-a' })];
  window.__tabelas.propostas = [];
  await rnCarregar();
  eq(rnEstado.aba, 'hoje', 'abre na Central');
  assert(!document.getElementById('rnHoje').hidden && document.getElementById('rnCarteira').hidden, 'Hoje visível');
  eq(document.querySelector('#rnAbas .active').dataset.rnAba, 'hoje', 'Hoje ativa');
  eq([document.getElementById('rnBadgeMenu').textContent, document.getElementById('rnBadgeRetornos').textContent], ['2', '2'], 'selo conta o atraso por hora');
  // ficha muda de casa conforme a subaba
  rnTrocarAba('carteira');
  eq([document.getElementById('rnFicha').parentElement.id, document.getElementById('rnFicha').classList.contains('noPainel')], ['panel-renovacao', false], 'fora da Central a ficha é gaveta');
  rnTrocarAba('hoje');
  eq([document.getElementById('rnFicha').parentElement.id, document.getElementById('rnFicha').classList.contains('noPainel')], ['rnHojeFicha', true], 'na Central a ficha fica ao lado da fila');
  fim();
`);
