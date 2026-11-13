// Testa a §151 — Central do dia: fila, cartões, ficha ao lado, gestor. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-13'; rnHoraSP = () => '16:00';
  const AG = { data: '2026-11-13', hora: '16:00' };
  const L = (o) => Object.assign({ razao_social: 'Zz', nome_adm: 'Zz Adm', linhas_voz: 1, apto: 'APTO', status: 3, na_base: true, consultor_id: 'u-a', dados_claro: {} }, o);
  const lista = [
    L({ id: 1, razao_social: 'Zz Ontem', prox_retorno: '2026-11-12' }),
    L({ id: 2, razao_social: 'Zz Semana', prox_retorno: '2026-11-06' }),
    L({ id: 3, razao_social: 'Zz Hoje Cedo', prox_retorno: '2026-11-13', retorno_hora: '10:00' }),
    L({ id: 4, razao_social: 'Zz Hoje Tarde', prox_retorno: '2026-11-13', retorno_hora: '17:30' }),
    L({ id: 5, razao_social: 'Zz Hoje Sem Hora', prox_retorno: '2026-11-13' }),
    L({ id: 6, razao_social: 'Zz Hoje 16h30', prox_retorno: '2026-11-13', retorno_hora: '16:30' }),
    L({ id: 7, razao_social: 'Zz Renovado', status: 6, linhas_renovadas: 12, status_desde: '2026-11-05T13:00:00Z', prox_retorno: '2026-11-01' }),
    L({ id: 8, razao_social: 'Zz Renovado Out', status: 6, linhas_renovadas: 99, status_desde: '2026-10-30T13:00:00Z' }),
    L({ id: 9, razao_social: 'Zz Negocia', status: 5 }),
    L({ id: 10, razao_social: 'Zz Do B', prox_retorno: '2026-11-10', consultor_id: 'u-b' }),
    L({ id: 11, razao_social: 'Zz Fora', prox_retorno: '2026-11-10', na_base: false }),
  ].concat(Array.from({ length: 12 }, (_, i) => L({ id: 20 + i, razao_social: 'Zz Sug ' + i, status: 1, linhas_voz: i + 1, apto: i === 11 ? '1 MÊS PARA APTO' : 'APTO' })));
  const f = rnFila(lista, AG, '');
  eq(f.atrasados.map(r => r.id), [2, 10, 1, 3], 'atrasados: mais antigo primeiro (inclui hoje com hora passada), na base');
  eq(f.hoje.map(r => r.id), [6, 4, 5], 'hoje: por hora, sem hora no fim');
  eq(f.sugeridos.map(r => r.id), [30, 29, 28, 27, 26, 25, 24, 23, 22, 21], 'sugeridos: 10 maiores APTO não contatados');
  eq(rnFila(lista, AG, 'u-b').atrasados.map(r => r.id), [10], 'filtra por consultor');
  eq(rnFilaPlana(f).length, 17, 'fila plana');
  const propostas = [{ id: 'p1', carteira_id: 9, valor_proposto: 1200, estagio: 'negociacao', criado_em: '2026-11-12T10:00:00Z' },
                     { id: 'p0', carteira_id: 9, valor_proposto: 999, estagio: 'fechado_perdido', criado_em: '2026-11-13T10:00:00Z' }];
  const k = rnKpis(lista, propostas, AG, '');
  eq([k.carteira, k.atrasados, k.vencemHoje, k.negociacao, k.valorNegociacao, k.linhasMes, k.clientesMes], [22, 4, 3, 1, 1200, 12, 1], 'cartões do topo');

  // ==== tela do consultor ====
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = lista.filter(r => r.consultor_id === 'u-a');
  window.__tabelas.propostas = propostas; window.__tabelas.renovacao_historico = [];
  await rnCarregar();
  await espera(40);
  const kpis = [...document.querySelectorAll('#rnKpis .rnKpi')].map(x => x.textContent.replace(/\\s+/g, ' ').trim());
  assert(/^21 clientes na carteira/.test(kpis[0]) && /^3 retornos atrasados/.test(kpis[1]) && /3 vencem hoje/.test(kpis[1]), 'cartões: carteira e atrasados: ' + kpis.join(' | '));
  assert(/^12 linhas renovadas no mês/.test(kpis[3]) && /1 cliente/.test(kpis[3]), 'cartão de linhas no mês');
  const grupos = [...document.querySelectorAll('#rnFilaLista .rnGrupoT')].map(g => g.textContent.replace(/\\s+/g, ' ').trim());
  eq(grupos, ['⏱ Atrasados 3', '● Hoje 3', '★ Sugeridos 10'], 'três blocos com contagem');
  assert(/há 7 dias/.test(document.querySelector('#rnFilaLista [data-rn-abrir="2"]').textContent), 'atrasado diz há quanto tempo');
  assert(/17:30/.test(document.querySelector('#rnFilaLista [data-rn-abrir="4"]').textContent), 'hoje diz a hora');
  eq([rnEstado.fichaId, document.getElementById('rnFicha').parentElement.id], [2, 'rnHojeFicha'], 'abre sozinha o primeiro da fila, ao lado');
  assert(document.querySelector('#rnFilaLista [data-rn-abrir="2"]').classList.contains('sel'), 'item aberto marcado');
  document.querySelector('#rnFilaLista [data-rn-abrir="4"]').click();
  await espera(30);
  eq(rnEstado.fichaId, 4, 'clicar abre outro');
  assert(document.querySelector('#rnFilaLista [data-rn-abrir="4"]').classList.contains('sel') && !document.querySelector('#rnFilaLista [data-rn-abrir="2"]').classList.contains('sel'), 'marcação acompanha');
  const bh = document.getElementById('rnHojeBusca'); bh.value = 'tarde'; bh.dispatchEvent(new window.Event('input', { bubbles: true }));
  eq([...document.querySelectorAll('#rnFilaLista [data-rn-abrir]')].map(b => b.dataset.rnAbrir), ['4'], 'busca na fila');
  document.getElementById('rnHojeFiltros').click();
  eq([rnEstado.aba, document.getElementById('rnBusca').value, rnEstado.filtros.busca], ['carteira', 'tarde', 'tarde'], 'Filtros leva a busca para a Carteira');
  rnEstado.filtros.busca = ''; document.getElementById('rnBusca').value = ''; rnTrocarAba('hoje');
  bh.value = ''; bh.dispatchEvent(new window.Event('input', { bubbles: true }));

  // trocar de subaba com a ficha aberta
  rnTrocarAba('carteira');
  assert(!document.getElementById('rnFicha').classList.contains('aberta'), 'na Carteira a gaveta fecha');
  rnTrocarAba('hoje');
  eq([rnEstado.fichaId, document.getElementById('rnFicha').parentElement.id], [4, 'rnHojeFicha'], 'de volta à Central, o mesmo cliente ao lado');

  // ==== gestor: Time todo e um consultor ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = lista;
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }, { id: 'u-b', nome: 'Zzb Teste', equipe: 'renovacao' }];
  await rnCarregar();
  await espera(40);
  const sel = document.getElementById('rnFConsultor');
  assert(sel.style.display === '' && sel.options[0].textContent === 'Time todo', 'seletor do gestor');
  assert(/Zzb Teste/.test(document.querySelector('#rnFilaLista [data-rn-abrir="10"]').textContent), 'Time todo mostra o consultor');
  sel.value = 'u-b'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(20);
  eq([...document.querySelectorAll('#rnFilaLista [data-rn-abrir]')].map(b => b.dataset.rnAbrir), ['10'], 'um consultor: só a fila dele');
  assert(/^1 retornos atrasados|^1 retorno/.test([...document.querySelectorAll('#rnKpis .rnKpi')][1].textContent.trim()), 'cartões do consultor escolhido');
  rnTrocarAba('carteira');
  eq([...document.querySelectorAll('#rnTbody tr[data-rn-id]')].map(t => t.dataset.rnId), ['10'], 'a Carteira respeita o consultor');

  // vazio
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [L({ id: 1, status: 6, linhas_renovadas: 2 })];
  await rnCarregar();
  assert(/Nada atrasado nem para hoje/.test(document.getElementById('rnFilaLista').textContent), 'fila vazia avisa');
  assert(/Escolha um cliente da fila/.test(document.getElementById('rnFichaCorpo').textContent), 'ficha vazia orienta');
  fim();
`);
