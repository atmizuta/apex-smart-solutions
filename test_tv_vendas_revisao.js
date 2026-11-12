// Testa os achados da revisão final da §149: venda em dobro logo depois de confirmar, VENDEU! repetido com rede lenta,
// botão Vendi! por cima do Caderno e TV com sessão vencida. DADOS FICTÍCIOS (repo público).
const { rodar } = require('./tv_vendas_harness.js');
rodar(`
  // 1) depois de confirmar, a janela ainda some devagar no navegador (150 ms): um segundo clique não pode gravar outra venda
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor', operacao: 'apex' };
  vdAplicarPermissao();
  window.__rpcRespostas.vendi = { data: { id: 51, receita: 474.95, linhas: 5, aviso: null }, error: null };
  const preencher = () => {
    document.getElementById('vdCnpj').value = '11.222.333/0001-81';
    const sel = document.querySelector('#vdModal [data-vd-plano]'); sel.value = 'p57-100'; disparar(sel, 'change');
  };
  document.getElementById('btnVendi').click(); preencher();
  document.getElementById('vdConfirmar').click(); await espera(30);
  document.getElementById('vdConfirmar').click(); await espera(30);
  eq(chamadas('vendi').length, 1, 'clique depois do sucesso não grava outra venda');
  document.getElementById('btnVendi').click(); preencher();
  document.getElementById('vdConfirmar').click(); await espera(30);
  eq(chamadas('vendi').length, 2, 'abrir a janela de novo libera outra venda');
  vdFecharDesfazer();

  // 2) consulta lenta (> intervalo): não sobrepõe e não comemora a mesma venda duas vezes
  Object.assign(TV_TEMPOS, { tick: 30, ranking: 100000, alternar: 100000, relogio: 100000, vendeu: 30, meta: 30, semConexao: 100000 });
  window.__rpcRespostas.tv_ranking = (a) => ({ data: { periodo: a.p_periodo, de: '2026-11-12', ate: '2026-11-12', linhas: [], totais: {}, meta: {}, ultima: null }, error: null });
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 10, cancelados_ids: [], meta: null }, error: null };
  currentUser = { id: 'u-ad', nome: 'Zz Admin', role: 'admin', operacao: 'apex' };
  tvAplicarPermissao();
  document.getElementById('tabBtnTvVendas').click(); await espera(20);
  let festas = 0; const mostrar = tvMostrarFesta;
  tvMostrarFesta = (tipo, html) => { if(tipo === 'vendeu') festas++; mostrar(tipo, html); };
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 11, cancelados_ids: [], meta: null }, error: null };
  window.__rpcRespostas.tv_vendas_desde = () => new Promise(res => setTimeout(() => res({ data: [{ id: 11, consultor_id: 'a', nome: 'Zz Ana', receita: 100, vendas_hoje: 1, contatos_hoje: 10, conversao_hoje: 10, pos_antes: null, pos_depois: 1 }], error: null }), 120));
  await espera(400);
  eq(festas, 1, 'uma venda = um VENDEU!, mesmo com a consulta lenta');
  eq(chamadas('tv_vendas_desde').length, 1, 'não dispara outra consulta enquanto a anterior não volta');

  // 4) sessão vencida: avisa na hora, sem esperar os 2 min de "sem conexão"
  window.__rpcRespostas.tv_ultima_venda = { data: null, error: { message: 'JWT expired', code: 'PGRST301', status: 401 } };
  await espera(80);
  const av = document.getElementById('tvSemConexao');
  assert(!av.hidden && av.textContent.includes('Sessão expirou'), 'sessão vencida avisa para entrar de novo');
  tvParar();

  // 3) o botão Vendi! não pode ficar por cima do Caderno nem das janelas
  const css = document.getElementById('tvStyles').textContent;
  const regra = (css.match(/\\.vdFab\\{([^}]*)\\}/) || [])[1] || '';
  const z = Number((regra.match(/z-index:(\\d+)/) || [])[1]);
  const fundo = Number((regra.match(/bottom:(\\d+)px/) || [])[1]);
  assert(z < 50, 'Vendi! fica abaixo das janelas (.overlay z 50): z-index ' + z);
  assert(fundo >= 96, 'Vendi! acima do botão do Caderno (bottom 32 + 56): bottom ' + fundo);
`);
