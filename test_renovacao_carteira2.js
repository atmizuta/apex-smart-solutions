// Testa a §151 — Carteira redesenhada: visões, mais filtros, etiquetas, ordem, tabela sem edição. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-13'; rnHoraSP = () => '16:00';
  const AG = { data: '2026-11-13', hora: '16:00' };
  const L = (o) => Object.assign({ cnpj_digits: '00000000000400', razao_social: 'Zz', nome_adm: 'Zz Adm', linhas_voz: 1, apto: 'APTO', cidade: 'Zz Cidade', ddd: '19',
    consultor_id: 'u-a', status: 1, prox_retorno: null, retorno_hora: null, na_base: true, a_completar: false }, o);
  const base = () => [
    L({ id: 1, razao_social: 'Zz Ácido', linhas_voz: 3, status: 2, prox_retorno: '2026-11-13', retorno_hora: '15:00' }),
    L({ id: 2, razao_social: 'Zz Beta', linhas_voz: 30, status: 7, motivo_perda: 'Preço', cidade: 'Zz Outra' }),
    L({ id: 3, razao_social: 'Zz Gama', linhas_voz: 30, status: 6, linhas_renovadas: 2, consultor_id: 'u-b' }),
    L({ id: 4, razao_social: 'Zz Delta', linhas_voz: 8, status: 1, a_completar: true, consultor_id: null }),
    L({ id: 5, razao_social: 'Zz Fora', linhas_voz: 99, na_base: false }),
    L({ id: 6, razao_social: 'Zz Hoje', linhas_voz: 2, status: 4, prox_retorno: '2026-11-13', retorno_hora: '18:00', data_contato: '2026-11-10', canal: 'WhatsApp' }),
  ];
  const ids = (f) => rnFiltrar(base(), Object.assign(rnFiltrosVazios(), f), AG).map(r => r.id);
  eq(ids({}), [2, 3, 4, 1, 6], 'Todos: na base, mais linhas primeiro');
  eq([ids({ visao: 'nao' }), ids({ visao: 'andamento' }), ids({ visao: 'atrasados' }), ids({ visao: 'pendencias' }), ids({ visao: 'renovados' }), ids({ visao: 'perdidos' }), ids({ visao: 'fora' })],
     [[4], [1, 6], [1], [4], [3], [2], [5]], 'visões');
  eq(ids({ ordem: 'retorno' }), [1, 6, 2, 3, 4], 'retorno mais próximo primeiro (sem retorno no fim, por linhas)');
  eq(ids({ busca: 'acido' }), [1], 'busca sem acento');
  eq(rnContarVisoes(base(), rnFiltrosVazios(), AG), { todos: 5, nao: 1, andamento: 2, atrasados: 1, pendencias: 1, renovados: 1, perdidos: 1, fora: 1 }, 'contagem das visões');
  eq(rnValidarFechamento(7, {}), 'Escolha o motivo da perda.', 'perdido sem motivo');
  eq(rnValidarFechamento(6, { linhas_renovadas: 3 }), null, 'renovado com linhas');
  eq(rnStatusRotulo(3), '3-Contato efetivo', 'rótulo do status (histórico)');
  eq(rnUltimoContato(L({ data_contato: '2026-11-10', canal: 'WhatsApp' })), '10/11 · WhatsApp', 'último contato');

  // ==== tela (gestor) ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = base();
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }, { id: 'u-b', nome: 'Zzb Teste', equipe: 'renovacao' }];
  window.__tabelas.propostas = [];
  await rnCarregar();
  rnTrocarAba('carteira');
  const visoes = () => [...document.querySelectorAll('#rnVisoes [data-rn-visao]')].map(b => b.textContent.replace(/\\s+/g, ' ').trim());
  eq(visoes(), ['Todos 5', 'Não contatados 1', 'Em andamento 2', 'Atrasados 1', 'Pendências 1', 'Renovados 1', 'Perdidos 1', 'Fora da base 1'], 'pílulas com contagem');
  eq(document.querySelectorAll('#rnTbody select, #rnTbody input:not([type=checkbox])').length, 0, 'nada editável na linha');
  const linhas = () => [...document.querySelectorAll('#rnTbody tr[data-rn-id]')].map(t => t.dataset.rnId);
  eq(linhas(), ['2', '3', '4', '1', '6'], 'tabela na ordem');
  assert(/Zzb Teste/.test(document.querySelector('#rnTbody tr[data-rn-id="3"]').textContent), 'gestor vê o consultor na linha');
  assert(/⏱ era 15:00/.test(document.querySelector('#rnTbody tr[data-rn-id="1"]').textContent), 'próximo passo: atrasado');
  assert(/Retorno hoje 18:00/.test(document.querySelector('#rnTbody tr[data-rn-id="6"]').textContent), 'próximo passo: hoje');
  assert(/10\\/11 · WhatsApp/.test(document.querySelector('#rnTbody tr[data-rn-id="6"]').textContent), 'último contato');
  assert(/Primeiro contato/.test(document.querySelector('#rnTbody tr[data-rn-id="4"]').textContent), 'não contatado sem retorno');

  document.querySelector('#rnVisoes [data-rn-visao="atrasados"]').click();
  eq(linhas(), ['1'], 'clicar na visão filtra');
  document.querySelector('#rnVisoes [data-rn-visao="todos"]').click();

  const mf = document.getElementById('rnMaisFiltros');
  assert(mf.hidden, 'Mais filtros começa fechado');
  document.getElementById('rnMaisFiltrosBt').click();
  assert(!mf.hidden && document.getElementById('rnMaisFiltrosBt').getAttribute('aria-expanded') === 'true', 'abre Mais filtros');
  const cid = document.getElementById('rnFCidade'); cid.value = 'Zz Outra'; cid.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(linhas(), ['2'], 'filtra pela cidade');
  const chip = document.querySelector('#rnChips [data-rn-limpar="cidade"]');
  assert(!!chip && /Cidade: Zz Outra/.test(chip.textContent), 'etiqueta do filtro');
  chip.click();
  eq([linhas().length, document.querySelectorAll('#rnChips [data-rn-limpar]').length], [5, 0], 'tirar a etiqueta limpa o filtro');

  const ord = document.getElementById('rnOrdem'); ord.value = 'retorno'; ord.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(linhas(), ['1', '6', '2', '3', '4'], 'ordem por retorno');

  document.querySelector('#rnTbody tr[data-rn-id="6"] td:nth-child(3)').click();
  await espera(30);
  eq([rnEstado.fichaId, document.getElementById('rnFicha').classList.contains('aberta')], [6, true], 'clicar na linha abre a ficha');
  const cx = document.querySelector('#rnTbody [data-rn-sel="2"]'); cx.checked = true; cx.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(document.getElementById('rnSelN').textContent, '1 selecionado(s)', 'marcar não abre a ficha e conta');

  // 50 por página
  window.__tabelas.renovacao_carteira = Array.from({ length: 60 }, (_, i) => L({ id: 100 + i, linhas_voz: i }));
  rnEstado.carregado = false; await rnCarregar(); rnTrocarAba('carteira');
  eq([linhas().length, /Mostrar mais \\(10\\)/.test(document.getElementById('rnMais').textContent)], [50, true], '50 por vez');
  fim();
`);
