// Testa a aba TV Vendas: permissão, ranking, ciclo, Hoje | Mês, meta e sem conexão (§149). DADOS FICTÍCIOS.
const { rodar } = require('./tv_vendas_harness.js');
rodar(`
  Object.assign(TV_TEMPOS, { tick: 40, ranking: 100000, alternar: 100000, relogio: 100000, vendeu: 10, meta: 10, semConexao: 60 });
  const RANK = (per, linhas, extra) => ({ data: Object.assign({ periodo: per, de: '2026-11-01', ate: '2026-11-12', linhas,
    totais: { contatos: 120, vendas: 3, receita: 900, conversao: 2.5 }, meta: { dia: '2026-11-12', meta: 30, vendas_hoje: 3 },
    ultima: { nome: 'Zz Ana Teste', em: '2026-11-12T14:03:00-03:00' }, gerado_em: '2026-11-12T14:05:00-03:00' }, extra || {}), error: null });
  const L1 = [{ profile_id: 'a', nome: 'Zz Ana Teste', contatos: 50, vendas: 2, receita: 600, conversao: 4, posicao: 1 },
              { profile_id: 'b', nome: 'Zz Bia Teste', contatos: 70, vendas: 1, receita: 300, conversao: 1.4, posicao: 2 },
              { profile_id: 'c', nome: 'Zz Caio Teste', contatos: 0, vendas: 0, receita: 0, conversao: null, posicao: null }];
  window.__rpcRespostas.tv_ranking = (a) => RANK(a.p_periodo, L1);
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 10, cancelados_ids: [], meta: 30 }, error: null };
  window.__rpcRespostas.tv_vendas_desde = { data: [], error: null };

  const bt = document.getElementById('tabBtnTvVendas');
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor', operacao: 'apex' };
  tvAplicarPermissao(); eq(bt.style.display, 'none', 'consultor não vê a aba');
  currentUser = { id: 'u-sc', nome: 'Zz Sup Campinas', role: 'supervisor', operacao: 'campinas' };
  tvAplicarPermissao(); eq(bt.style.display, 'none', 'supervisor de Campinas não vê');
  currentUser = { id: 'u-sp', nome: 'Zz Sup Apex', role: 'supervisor', operacao: 'apex' };
  tvAplicarPermissao(); eq(bt.style.display, 'inline-block', 'supervisor da Apex vê');

  bt.click(); await espera(30);
  assert(tvEstado.ativo, 'clicar na aba liga a TV');
  eq(tvEstado.ultimoId, 10, 'primeira leitura só guarda o último id (não comemora venda antiga)');
  eq(chamadas('tv_vendas_desde').length, 0, 'sem festa na abertura');
  const cont = document.getElementById('tvConteudo');
  const linhas = cont.querySelectorAll('tbody tr');
  eq(linhas.length, 3, 'uma linha por consultor');
  assert(linhas[0].textContent.includes('Zz Ana Teste') && linhas[0].textContent.includes('4,0%') && linhas[0].textContent.includes(fmtBRL(600)), 'linha 1: nome, conversão, receita');
  assert(linhas[0].querySelector('.tvAvatar').textContent === 'ZT', 'iniciais');
  assert(linhas[2].textContent.includes('—'), 'sem contato = —');
  assert(cont.textContent.includes('3 de 30'), 'meta do dia no cabeçalho');
  assert(cont.textContent.includes('Zz Ana Teste') && cont.textContent.includes('14:03'), 'última venda');
  assert(document.getElementById('tvTitulo').textContent.includes('Hoje'), 'título com o período');

  // venda nova: busca vendas_desde a partir do último id, recarrega o ranking e mostra a seta
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 11, cancelados_ids: [], meta: 30 }, error: null };
  window.__rpcRespostas.tv_vendas_desde = { data: [{ id: 11, consultor_id: 'b', nome: 'Zz Bia Teste', receita: 300, vendas_hoje: 2, contatos_hoje: 70, conversao_hoje: 2.9, pos_antes: 2, pos_depois: 1 }], error: null };
  window.__rpcRespostas.tv_ranking = (a) => RANK(a.p_periodo, [Object.assign({}, L1[1], { vendas: 2, receita: 600, posicao: 1 }), Object.assign({}, L1[0], { posicao: 2 }), L1[2]]);
  const nRank = chamadas('tv_ranking').length;
  await espera(60);
  eq(chamadas('tv_vendas_desde')[0].args, { p_id: 10 }, 'pede vendas depois do último id');
  eq(tvEstado.ultimoId, 11, 'avança o último id');
  assert(chamadas('tv_ranking').length > nRank, 'ranking recarrega na venda');
  const l0 = document.querySelector('#tvConteudo tbody tr');
  assert(l0.textContent.includes('Zz Bia Teste') && l0.querySelector('.tvSeta.sobe'), 'quem subiu ganha seta ▲');

  // Hoje | Mês
  document.querySelector('[data-tv-periodo="mes"]').click(); await espera(20);
  eq(chamadas('tv_ranking').pop().args, { p_periodo: 'mes' }, 'botão Mês');
  assert(document.getElementById('tvTitulo').textContent.includes('Mês'), 'título Mês');
  document.getElementById('tvAlternar').click();
  eq(tvEstado.alternar, false, 'Alternar desliga');

  // meta
  window.__rpcRespostas.tv_meta_definir = { data: null, error: null };
  const campo = document.getElementById('tvMetaCampo'); campo.value = '35'; disparar(campo, 'change'); await espera();
  eq(chamadas('tv_meta_definir').pop().args, { p_meta: 35 }, 'gestor define a meta');
  const campo2 = document.getElementById('tvMetaCampo');   // o ranking redesenhou: o campo antigo saiu da tela
  campo2.value = '0'; disparar(campo2, 'change'); await espera();
  assert(window.__alertas.some(m => m.includes('Meta de 1 a 1000')), 'meta inválida não vai ao banco');

  // sem conexão: depois de TV_TEMPOS.semConexao aparece o aviso; volta e some
  window.__rpcRespostas.tv_ultima_venda = { data: null, error: { message: 'Failed to fetch' } };
  await espera(150);
  const av = document.getElementById('tvSemConexao');
  assert(!av.hidden && av.textContent.includes('Sem conexão'), 'aviso de sem conexão');
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 11, cancelados_ids: [], meta: 30 }, error: null };
  await espera(80);
  assert(av.hidden, 'aviso some quando volta');

  // virada do dia: reinicia sem comemorar vendas de ontem
  tvEstado.dia = '2026-11-11';
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 15, cancelados_ids: [], meta: 30 }, error: null };
  const nDesde = chamadas('tv_vendas_desde').length;
  await espera(150);
  eq(tvEstado.dia, hojeSP(), 'dia novo');
  eq(tvEstado.ultimoId, 15, 'último id relido do zero');
  eq(chamadas('tv_vendas_desde').length, nDesde, 'nada de festa na virada');

  // sair da aba para a TV
  document.querySelector('#tabsNav button[data-tab="busca"]').click();
  eq(tvEstado.ativo, false, 'trocar de aba desliga a TV');
  const nUlt = chamadas('tv_ultima_venda').length; await espera(120);
  eq(chamadas('tv_ultima_venda').length, nUlt, 'parou de consultar');
`);
