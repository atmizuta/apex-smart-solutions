// Testa a §143.2 — Gerar proposta na Renovação e a ligação proposta ⇄ carteira. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const dados = { 'VL_CONTR_NO_MSISDN_C_DESC_RET': 812.5, 'VALOR POR LINHA / ARPU': 81.25, 'QT LINHAS SILENTES': 2, 'CEP CABEADO?': 'CEP Cabeado' };
  const L = { id: 1, cnpj_digits: '00000000000201', razao_social: 'Zz Dois Um', cidade: 'Zz Cidade', ddd: '19', linhas_voz: 10, tempo_contrato_voz: 22,
    apto: 'APTO', telefone: '19900000001', nome_adm: 'Zz Adm', status: 2, na_base: true, consultor_id: 'u-a' };
  const c = rnClienteDaCarteira(L, dados);
  eq([c.razao_social, c.cnpj, c.cnpj_digits, c.linhas_voz, c.tempo_contrato_voz, c.valor_contrato, c.arpu, c.qtde_silentes, c.cep_cabeado, c.apto_renovacao],
     ['Zz Dois Um', '00.000.000/0002-01', '00000000000201', 10, 22, 812.5, 81.25, 2, 'CEP Cabeado', 'APTO'], 'cliente montado da carteira no formato de clientes');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [Object.assign({ dados_claro: dados }, L), Object.assign({}, L, { id: 2, cnpj_digits: '00000000000202', razao_social: 'Zz Dois Dois', status: 5 })];
  window.__tabelas.propostas = [];
  await rnCarregar();
  const chamadas = []; const openOrig = openProposal;
  openProposal = (cli, opts) => { chamadas.push([cli, opts]); };

  // cliente que está em clientes: usa a linha de clientes (como a Busca)
  window.__tabelas.clientes = [{ cnpj_digits: '00000000000201', razao_social: 'Zz Dois Um (base)', valor_contrato: 900 }];
  await rnGerarProposta(1);
  eq([chamadas[0][0].razao_social, chamadas[0][1]], ['Zz Dois Um (base)', { carteiraId: 1 }], 'abre a proposta com a linha de clientes e o carteiraId');
  // cliente fora de clientes: monta da carteira
  await rnGerarProposta(2);
  eq([chamadas[1][0].razao_social, chamadas[1][0].cnpj_digits, chamadas[1][1]], ['Zz Dois Dois', '00000000000202', { carteiraId: 2 }], 'sem clientes, monta da carteira');
  openProposal = openOrig;

  // registrar no funil: liga carteira_id e sobe a carteira para 4 (só se estava em 1–3)
  proposalState = { client: { razao_social: 'Zz Dois Um', cnpj: '00.000.000/0002-01' }, avulsa: false, incluirRenovacao: true, propostaId: null, carteiraId: 1 };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(700, 812.5);
  await espera(20);
  const ins = window.__escritas.find(w => w.tabela === 'propostas' && w.op === 'insert');
  eq([ins.patch.carteira_id, ins.patch.estagio, ins.patch.tipo_proposta], [1, 'proposta_enviada', 'renovacao'], 'proposta gravada com carteira_id');
  eq(window.__escritas.filter(w => w.tabela === 'renovacao_carteira').map(w => w.patch), [{ status: 4 }], 'carteira sobe para 4');
  eq(rnPropostasDe(1).length, 1, 'propostas da carteira recarregadas');

  // segunda proposta para o mesmo cliente: liga de novo, mas a carteira já está em 4
  proposalState = { client: { razao_social: 'Zz Dois Um', cnpj: '00.000.000/0002-01' }, avulsa: false, incluirRenovacao: true, propostaId: null, carteiraId: 1 };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(650, 812.5);
  await espera(20);
  eq(window.__escritas.filter(w => w.tabela === 'renovacao_carteira').length, 0, 'não mexe na carteira de novo');
  eq(rnPropostasDe(1).length, 2, 'duas propostas ligadas');

  // carteira em 5 não volta para 4
  proposalState = { client: { razao_social: 'Zz Dois Dois' }, avulsa: false, incluirRenovacao: true, propostaId: null, carteiraId: 2 };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(500, 600);
  await espera(20);
  eq(window.__escritas.filter(w => w.tabela === 'renovacao_carteira').length, 0, 'status 5 continua 5');

  // proposta sem carteira (avulsa) segue igual
  proposalState = { client: { razao_social: 'Zz Avulsa' }, avulsa: true, tipoAvulsa: 'portabilidade', incluirRenovacao: true, propostaId: null, carteiraId: null };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(100, 0);
  await espera(20);
  const insAv = window.__escritas.find(w => w.tabela === 'propostas' && w.op === 'insert');
  assert(insAv && !('carteira_id' in insAv.patch), 'avulsa não leva carteira_id');

  // reabrir pelo cartão leva o carteiraId junto
  const abriu = []; openProposal = (cli, opts) => abriu.push(opts);
  abrirPropostaDoCard({ id: 'p9', carteira_id: 1, origem: 'base', dados: { client: { razao_social: 'Zz' }, avulsa: false } });
  eq([abriu[0].propostaId, abriu[0].carteiraId], ['p9', 1], 'abrirPropostaDoCard mantém a ligação');
  openProposal = openOrig;
  fim();
`);
