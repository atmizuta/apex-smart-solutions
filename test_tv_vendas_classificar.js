// Testa o seletor de plano × linhas no Classificar do lead (§149). DADOS FICTÍCIOS (repo público).
const { rodar } = require('./tv_vendas_harness.js');
rodar(`
  const OPC = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }];
  const F = { aba: 'NOVEMBRO', lead_id: 'c1', nome: 'Zz Oficina', cidade: 'Campinas', uf: 'SP', qtd_linhas: '4', tipo_empresa: 'MEI', telefone: '11900000041',
    email: 'zz@teste.invalid', cnpj: '11222333000181', status: 'EM NEGOCIAÇÂO', categoria: 'andamento', obs: '', campanha: 'Zz Campanha',
    criado_em_lead: '2026-11-12T09:14:00-03:00', livre: false, dono_id: 'u-zz', dono_nome: 'Zzkcon Teste', ligacoes: 1 };
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor', operacao: 'apex' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = OPC;
  window.__tabelas.cnpj_consultas = [];
  window.__rpcRespostas.leads_kanban3 = { data: [Object.assign({}, F)], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_conferir_neo = { data: [], error: null };
  window.__rpcRespostas.leads_ficha = { data: [Object.assign({}, F)], error: null };
  window.__rpcRespostas.leads_ficha_detalhes = { data: { anuncio: {}, resumo: { ligacoes: 1, atendidas: 0, cliques: 0, ultimo: null }, eventos: [] }, error: null };
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  window.__rpcRespostas.venda_itens_lead = { data: null, error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  kbTrocarAba('quadro');
  await espera(60);
  await kbAbrirFicha('NOVEMBRO', 'c1', { forcar: true });
  await espera(40);
  const fx = (s) => document.querySelector('#kbFicha ' + s);

  assert(!!fx('#kbClassItens [data-vd-plano]'), 'bloco de venda tem o seletor de plano');
  fx('#kbClassStatus').value = 'PEDIDO CONCLUIDO (VENDA)'; kbClassAjustar();
  const v70 = OFFERS_MOBILE.find(o => o.id === 'p57-70').valor;
  const sel = fx('#kbClassItens [data-vd-plano]'); sel.value = 'p57-70'; disparar(sel, 'change');
  const lin = fx('#kbClassItens [data-vd-linhas]'); lin.value = '4'; disparar(lin, 'input');
  eq(fx('#kbClassReceita').value, vdReceita([{ valor_linha: v70, linhas: 4 }]).toFixed(2).replace('.', ','), 'seletor preenche a receita');
  fx('#kbClassReceita').value = '350,00';
  assert(!fx('#kbClassReceita').readOnly, 'receita continua editável');

  const okSalvo = await kbSalvarClassificacao();
  assert(okSalvo, 'salvou');
  eq(chamadas('leads_classificar').pop().args.p_receita, 350, 'receita digitada vale (§140)');
  const it = chamadas('venda_itens_lead');
  eq(it.length, 1, 'itens enviados depois de classificar');
  eq([it[0].args.p_aba, it[0].args.p_id, it[0].args.p_itens[0].plano_id, it[0].args.p_itens[0].linhas], ['NOVEMBRO', 'c1', 'p57-70', 4], 'argumentos dos itens');

  // venda sem plano escolhido: classifica, mas não manda itens
  await kbAbrirFicha('NOVEMBRO', 'c1', { forcar: true }); await espera(40);
  fx('#kbClassStatus').value = 'PEDIDO CONCLUIDO (VENDA)'; kbClassAjustar();
  fx('#kbClassReceita').value = '120,00';
  await kbSalvarClassificacao();
  eq(chamadas('venda_itens_lead').length, 1, 'sem plano: não chama venda_itens_lead');

  // status que não é venda: nada de itens
  await kbAbrirFicha('NOVEMBRO', 'c1', { forcar: true }); await espera(40);
  fx('#kbClassStatus').value = 'EM NEGOCIAÇÂO'; kbClassAjustar();
  await kbSalvarClassificacao();
  eq(chamadas('venda_itens_lead').length, 1, 'status sem venda: não chama');
`);
