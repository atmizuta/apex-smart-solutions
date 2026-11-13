// Testa os ajustes adiados da §143 (aba Renovação), feitos em 13/11. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-13';
  const L = (o) => Object.assign({ razao_social: 'Zz', linhas_voz: 1, na_base: true, consultor_id: 'u-a', status_desde: '2026-11-10T12:00:00Z', dados_claro: {}, cidade: 'Zz Cidade', ddd: '19' }, o);

  // ==== gestor: nomes de quem mexeu, DDD, redistribuir, cartão com a última aberta ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }, { id: 'u-b', nome: 'Zzb Teste', equipe: 'renovacao' },
                               { id: 'u-sup', nome: 'Zzsup Teste', equipe: null }];
  window.__tabelas.renovacao_carteira = [L({ id: 1, status: 5 }), L({ id: 2, status: 6, linhas_renovadas: 2, ddd: '11' }), L({ id: 3, status: 2, ddd: '11', razao_social: 'Zz Tres' })];
  window.__tabelas.propostas = [
    { id: 'p-fech', carteira_id: 1, valor_proposto: 999, estagio: 'fechado_perdido', criado_em: '2026-11-12T10:00:00Z' },
    { id: 'p-aber', carteira_id: 1, valor_proposto: 555, estagio: 'negociacao', criado_em: '2026-11-11T10:00:00Z' },
    { id: 'p-ganho', carteira_id: 2, valor_proposto: 777, estagio: 'fechado_ganho', criado_em: '2026-11-12T10:00:00Z' },
  ];
  window.__tabelas.renovacao_historico = [{ carteira_id: 3, campo: 'consultor', de: 'u-sup', para: 'u-a', user_id: 'u-sup', criado_em: '2026-11-12T15:00:00Z' }];
  await rnCarregar();
  eq(rnEstado.perfis.map(p => p.id), ['u-a', 'u-b'], 'Passar para / filtro: só o time');
  rnTrocarAba('kanban');
  const c1 = document.querySelector('#rnKanban [data-rn-card="1"]').textContent, c2 = document.querySelector('#rnKanban [data-rn-card="2"]').textContent;
  assert(/555,00/.test(c1) && !/999,00/.test(c1), 'cartão aberto mostra a última proposta ABERTA');
  assert(/777,00/.test(c2), 'cartão renovado mostra a proposta fechada (ganha)');
  await rnAbrirFicha(3);
  assert(/Zzsup Teste: passou de Zzsup Teste para Zza Teste/.test(document.getElementById('rnFichaCorpo').textContent), 'gestor vê o nome de quem não é do time');

  rnFecharFicha(); rnTrocarAba('carteira');
  const ddd = document.getElementById('rnFDdd');
  assert(!!ddd && [...ddd.options].map(o => o.value).join(',') === ',11,19', 'filtro de DDD com os DDDs da carteira');
  ddd.value = '11'; ddd.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq([...document.querySelectorAll('#rnTbody tr[data-rn-id]')].map(t => t.dataset.rnId).sort(), ['2', '3'], 'filtra por DDD');

  // redistribuir: destino não some ao marcar outro; selecionar todos pega todo o filtro; escondidos não passam
  const pp = document.getElementById('rnPassarPara');
  const marca = (id) => { const c = document.querySelector('#rnTbody [data-rn-sel="' + id + '"]'); c.checked = true; c.dispatchEvent(new window.Event('change', { bubbles: true })); };
  marca(2);
  document.getElementById('rnPassarPara').value = 'u-b';
  marca(3);
  eq(document.getElementById('rnPassarPara').value, 'u-b', 'destino continua escolhido depois de marcar outro');
  document.getElementById('rnFDdd').value = ''; document.getElementById('rnFDdd').dispatchEvent(new window.Event('change', { bubbles: true }));
  marca(1);
  document.getElementById('rnFDdd').value = '11'; document.getElementById('rnFDdd').dispatchEvent(new window.Event('change', { bubbles: true }));
  window.__escritas.length = 0;
  await rnRedistribuir();
  eq(window.__escritas[0].filtros[0][2].slice().sort(), [2, 3], 'só passa os selecionados que estão no filtro');
  rnEstado.pagina = 1;
  const sel = document.getElementById('rnSelTodos'); sel.checked = true; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq([...rnEstado.selecionados].sort(), [2, 3], 'selecionar todos pega todos do filtro');

  // ==== mensagem de erro diz o campo ====
  eq(rnMensagemErro({ message: 'new row for relation "renovacao_carteira" violates check constraint "renovacao_carteira_linhas_renovadas_check"' }), 'Linhas renovadas não pode ser negativo.', 'erro de linhas');
  eq(rnMensagemErro({ message: 'violates check constraint "renovacao_carteira_sol_digitais_check"' }), 'Soluções digitais não pode ser negativo.', 'erro de digitais');
  eq(rnMensagemErro({ message: 'timeout' }), 'Não foi possível salvar agora. Tente de novo.', 'erro técnico continua genérico');

  // ==== reabrir proposta fechada pela ficha cria uma nova ====
  await rnAbrirFicha(1);
  const abriu = []; const abrirOrig = abrirPropostaDoCard; abrirPropostaDoCard = (p) => abriu.push([p.id, p.carteira_id]);
  document.querySelector('#rnFichaCorpo [data-rn-proposta="p-fech"]').click();
  document.querySelector('#rnFichaCorpo [data-rn-proposta="p-aber"]').click();
  eq(abriu, [[null, 1], ['p-aber', 1]], 'fechada abre como proposta nova; aberta reabre a mesma');
  abrirPropostaDoCard = abrirOrig;

  // ==== histórico do funil grava o estágio que o banco calculou ====
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  window.__resp.propostas = (q) => q.op === 'insert' ? { data: Object.assign({ id: 'p-novo' }, q.patch, { estagio: 'negociacao' }), error: null }
    : q.op === 'update' ? { data: [{ id: 'p-aber', estagio: 'negociacao' }], error: null } : { data: [], error: null };
  proposalState = { client: { razao_social: 'Zz' }, avulsa: false, incluirRenovacao: true, propostaId: null, carteiraId: null };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(500, 600);
  eq(window.__escritas.filter(w => w.tabela === 'propostas_historico').map(w => w.patch.estagio_novo), ['negociacao'], 'inserir: histórico com o estágio do banco');
  proposalState = { client: { razao_social: 'Zz' }, avulsa: false, incluirRenovacao: true, propostaId: 'p-aber', carteiraId: null };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(500, 600);
  eq(window.__escritas.filter(w => w.tabela === 'propostas_historico').map(w => w.patch.estagio_novo), ['negociacao'], 'atualizar: histórico com o estágio do banco');
  delete window.__resp.propostas;

  // ==== consultor: quem não é do time aparece como Supervisão; carga atrasada de propostas é descartada ====
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [L({ id: 3, status: 2 })];
  await rnCarregar();
  await rnAbrirFicha(3);
  assert(/Supervisão: passou de Supervisão para Zza Teste/.test(document.getElementById('rnFichaCorpo').textContent), 'consultor vê "Supervisão" no lugar do traço');
  let solta; window.__resp.propostas = () => new Promise(r => { solta = r; });
  const atrasada = rnCarregarPropostas();
  await espera(5);   // a resposta falsa só é criada quando o pedido é de fato feito
  rnEstado.geracao++;   // troca de usuário no meio
  rnEstado.propostas = [];
  solta({ data: [{ id: 'velha', carteira_id: 3 }], error: null });
  await atrasada;
  eq(rnEstado.propostas.length, 0, 'resposta atrasada não entra no estado');
  delete window.__resp.propostas;

  // ==== detalhes visuais ====
  assert(/colspan="7" class="spinnerNote isLoading">Carregando/.test(document.getElementById('usersTbody').outerHTML) || document.getElementById('usersTbody').querySelector('td') === null || document.getElementById('usersTbody').querySelector('td').getAttribute('colspan') === '7', 'Carregando da aba Consultores com 7 colunas');
  fim();
`);
