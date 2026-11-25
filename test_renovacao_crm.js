// Testa a §165 — CRM de acompanhamento na Renovação: funil 0–9, prioridade P1–P5, campos novos, painel por consultor,
// leitor da Carteira Consolidada. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-25'; rnHoraSP = () => '10:00';
  const AG = { data: '2026-11-25', hora: '10:00' };

  // ==== funil e regras ====
  eq(Object.keys(RN_STATUS).map(Number), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'etapas 0 a 9');
  eq(rnStatusRotulo(8), '8-Perdido', 'rótulo da etapa 8');
  eq([rnValidarFechamento(8, {}), rnValidarFechamento(8, { motivo_perda: 'Preço' }), rnValidarFechamento(6, {}), rnValidarFechamento(7, { linhas_renovadas: 2 }), rnValidarFechamento(9, {})],
     ['Escolha o motivo da perda.', null, 'Informe quantas linhas foram fechadas.', null, null], 'perdido exige motivo; ganho (6 e 7) exige linhas; desqualificado não exige');
  eq([rnEstadoRetorno({ status: 5, prox_retorno: '2026-11-20' }, AG), rnEstadoRetorno({ status: 9, prox_retorno: '2026-11-20' }, AG), rnEstadoRetorno({ status: 7, prox_retorno: '2026-11-20' }, AG)],
     ['atrasado', null, null], 'retorno só vale para etapas abertas (0–5)');
  eq([rnFixaViavel('HP CABEADO', 'SIM', 'VENDA LIBERADA'), rnFixaViavel('HP CABEADO', 'SIM', '-3'), rnFixaViavel('HP CABEADO', 'SIM', 'VENDA BLOQUEADA'),
      rnFixaViavel('HP CABEADO', 'SIM', 'FORA/BAIXADO'), rnFixaViavel('HP CABEADO', 'SIM', 'VENDA NAO LIBERADA'), rnFixaViavel('HP CABEADO', 'NÃO', 'VENDA LIBERADA'),
      rnFixaViavel('HP NÃO CABEADO/ FORA RSI / CNPJ INATIVO', 'SIM', 'VENDA LIBERADA')],
     [true, true, false, false, false, false, false], 'fixa viável: cabeado + livre + situação');
  eq([rnEhApto('APTO'), rnEhApto('1 MÊS PARA APTO'), rnEhApto('2 MESES PARA APTO'), rnEhApto('NÃO APTO'), rnEhApto('INATIVO')], [true, true, true, false, false], 'apto = APTO, 1 MÊS ou 2 MESES');
  eq(rnStatusPlanilha('7-Perdido'), 8, 'planilha antiga: 7 vira 8');

  // ==== carteira: prioridade, filtro, ordem, sem contato ====
  const L = (o) => Object.assign({ cnpj_digits: '00000000000500', razao_social: 'Zz', nome_adm: 'Zz Adm', linhas_voz: 1, apto: 'APTO', cidade: 'Zz Cidade', ddd: '19',
    consultor_id: 'u-a', status: 0, na_base: true, a_completar: false, prioridade: 'P3', fatura: 100 }, o);
  const base = () => [
    L({ id: 1, razao_social: 'Zz P3', prioridade: 'P3', linhas_voz: 50 }),
    L({ id: 2, razao_social: 'Zz P1 menor', prioridade: 'P1', fatura: 400, linhas_voz: 5 }),
    L({ id: 3, razao_social: 'Zz P1 maior', prioridade: 'P1', fatura: 900, linhas_voz: 2 }),
    L({ id: 4, razao_social: 'Zz P2 sem toque', prioridade: 'P2', status: 2, data_contato: '2026-11-10' }),
    L({ id: 5, razao_social: 'Zz Desq', prioridade: 'P5', status: 9, data_contato: '2026-11-01' }),
    L({ id: 6, razao_social: 'Zz Recente', prioridade: 'P2', status: 1, data_contato: '2026-11-24' }),
    L({ id: 7, razao_social: 'Zz Fora', na_base: false }),
  ];
  const ids = (f) => rnFiltrar(base(), Object.assign(rnFiltrosVazios(), f), AG).map(r => r.id);
  eq(ids({}), [3, 2, 4, 6, 1, 5], 'ordem padrão: prioridade, depois maior fatura');
  eq(ids({ prioridade: 'P1' }), [3, 2], 'filtro por prioridade');
  eq(ids({ visao: 'sem7' }), [4], 'sem contato há mais de 7 dias (só etapas 1–5)');
  eq(ids({ visao: 'nao' }), [3, 2, 1], 'não trabalhados = etapa 0');
  eq(ids({ visao: 'perdidos' }), [5], 'perdidos / desqualificados');
  eq(ids({ ordem: 'linhas' })[0], 1, 'ordem por linhas continua disponível');
  eq(rnFila(base(), AG, '').sugeridos.map(r => r.id), [3, 2, 1], 'sugeridos: etapa 0, apto, melhor prioridade primeiro');

  // ==== tela: ficha com os campos novos, salvar, tentativa ====
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = base().filter(r => r.consultor_id === 'u-a');
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }];
  window.__tabelas.propostas = []; window.__tabelas.renovacao_historico = [];
  await rnCarregar(); await espera(40);
  rnTrocarAba('carteira');
  const linhas = () => [...document.querySelectorAll('#rnTbody tr[data-rn-id]')].map(t => t.dataset.rnId);
  eq(linhas(), ['3', '2', '4', '6', '1', '5'], 'carteira abre por prioridade');
  assert(/P1/.test(document.querySelector('#rnTbody tr[data-rn-id="3"]').textContent), 'coluna de prioridade');
  await rnAbrirFicha(2);
  const form = () => document.getElementById('rnFichaForm');
  ['tentativas', 'falou_decisor', 'produto_ofertado', 'concorrente', 'linhas_propostas', 'valor_proposta', 'prox_acao', 'canal'].forEach(n => assert(!!form().elements[n], 'campo ' + n));
  form().querySelector('[data-rn-contato="1"]').click();
  eq(form().elements.tentativas.value, '1', 'tentativa soma 1');
  form().elements.falou_decisor.value = 'Não'; form().elements.produto_ofertado.value = 'Renovação + Fixa';
  form().elements.valor_proposta.value = '650.5'; form().elements.linhas_propostas.value = '12'; form().elements.prox_acao.value = 'WhatsApp';
  window.__escritas.length = 0;
  form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await espera(30);
  const w = window.__escritas.find(x => x.tabela === 'renovacao_carteira');
  eq([w.patch.status, w.patch.tentativas, w.patch.falou_decisor, w.patch.produto_ofertado, w.patch.valor_proposta, w.patch.linhas_propostas, w.patch.prox_acao, w.patch.data_contato],
     [1, 1, 'Não', 'Renovação + Fixa', 650.5, 12, 'WhatsApp', '2026-11-25'], 'grava os campos de acompanhamento');
  // ganho (ativado) com pedido
  await rnAbrirFicha(2);
  form().querySelector('[data-rn-contato="7"]').click();
  assert(!document.querySelector('[data-rn-grupo="renovou"]').hidden, 'ganho mostra linhas e pedido');
  form().elements.linhas_renovadas.value = '12'; form().elements.numero_pedido.value = 'Zz-123';
  window.__escritas.length = 0;
  form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await espera(30);
  const w2 = window.__escritas.find(x => x.tabela === 'renovacao_carteira');
  eq([w2.patch.status, w2.patch.linhas_renovadas, w2.patch.numero_pedido], [7, 12, 'Zz-123'], 'ganho (ativado) grava linhas e nº do pedido');

  // ==== Resumo por consultor: cobertura, funil por etapa, sem contato, valor ganho ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = base();
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }];
  window.__tabelas.renovacao_resumo = [{ consultor_id: 'u-a', consultor_nome: 'Zza Teste', carteira: 6, contatados: 3, efetivo_mais: 1, propostas_mais: 0, renovados: 0, perdidos: 0,
    linhas_renovadas: 0, bl_vendida: 0, sol_digitais: 0, retornos_atrasados: 0, a_completar: 0, desqualificados: 1, ganho_pedido: 0, ganho_ativado: 0, valor_ganho: 1500, sem_contato_7d: 1, prioritarios: 4, prioritarios_sem_toque: 2 }];
  await rnCarregar(); rnTrocarAba('resumo'); await espera(40);
  const res = document.getElementById('rnResumo').textContent.replace(/\\s+/g, ' ');
  assert(/sem contato há \\+7 dias/.test(res) && /valor ganho/.test(res), 'cartões novos do resumo');
  assert(/Funil por etapa/.test(res) && /9-Desqualificado/.test(res) && /0-Não trabalhado/.test(res), 'funil por etapa');
  const cab = [...document.querySelectorAll('#rnResumo .rnResumoTbl thead th')].map(t => t.textContent);
  assert(cab.includes('Sem contato +7d') && cab.includes('P1/P2 sem toque') && cab.includes('Valor ganho') && cab.includes('Linhas ganhas'), 'colunas do painel por consultor: ' + cab.join('|'));
  const linhaA = [...document.querySelectorAll('#rnResumo .rnFunilTbl tbody tr')].find(t => /Zza/.test(t.textContent));
  assert(!!linhaA && /Zza Teste/.test(linhaA.textContent), 'funil por etapa tem a linha do consultor');

  // ==== leitor da Carteira Consolidada ====
  const X = window.XLSX;
  const cab2 = ['PRIOR.', 'CONSULTOR', 'RAZÃO SOCIAL', 'MOVIMENTAÇÃO 25/11', 'OPORTUNIDADE', 'APTO RENOV.', 'LINHAS VOZ', 'FATURA R$/MÊS', 'FIXA VIÁVEL?', 'TELEFONE', 'ADM / CONTATO',
    'ETAPA DO FUNIL ▼', 'Nº TENTAT.', '1º CONTATO', 'ÚLT. CONTATO', 'PRÓX. AÇÃO ▼', 'DATA PRÓX. AÇÃO', 'FALOU C/ DECISOR? ▼', 'PRODUTO OFERTADO ▼', 'LINHAS PROPOSTAS',
    'VALOR PROPOSTA R$/MÊS', 'CONCORRENTE ▼', 'MOTIVO PERDA ▼', 'Nº PEDIDO', 'DATA FECHAM.', 'OBSERVAÇÕES', 'DIAS S/ CONTATO', 'CNPJ', 'Código Claro', 'Meses contrato voz',
    'Classificação', 'Desconto Claro', 'Cliente fixa Claro?', 'HP cabeado', 'HP livre venda', 'Situação comercial fixa', 'Consultor anterior', 'Histórico (ORIGEM)', 'Cidade', 'DDD', 'Score'];
  const lin = (o) => cab2.map(c => (c in o ? o[c] : ''));
  const aoa = [cab2,
    lin({ 'PRIOR.': 'P1', CONSULTOR: 'Zzbruno', 'RAZÃO SOCIAL': 'Zz Um', 'MOVIMENTAÇÃO 25/11': 'NOVO 25/11', OPORTUNIDADE: 'Renovação + Fixa', 'APTO RENOV.': 'APTO', 'LINHAS VOZ': 18,
      'FATURA R$/MÊS': 660.72, TELEFONE: 11900000001, 'ADM / CONTATO': 'Zz Adm', 'ETAPA DO FUNIL ▼': '0-Não trabalhado', CNPJ: '19.252.622/0001-35', 'Meses contrato voz': 28,
      'Cliente fixa Claro?': 'NÃO TEM FIXA', 'HP cabeado': 'HP CABEADO', 'HP livre venda': 'SIM', 'Situação comercial fixa': 'VENDA LIBERADA', 'Consultor anterior': 'Zzsilvana',
      'Histórico (ORIGEM)': 'Nova atribuição', Cidade: 'ZZ CIDADE', DDD: 19, Score: 780 }),
    lin({ CONSULTOR: 'Zzfabiana', 'RAZÃO SOCIAL': 'Zz Dois', 'MOVIMENTAÇÃO 25/11': 'SAIU da base 25/11', OPORTUNIDADE: 'Renovação', 'APTO RENOV.': 'NÃO APTO', 'LINHAS VOZ': 3,
      'FATURA R$/MÊS': 100, 'ETAPA DO FUNIL ▼': '1-Tentativa de contato', 'Nº TENTAT.': 2, '1º CONTATO': '02/10/2026', 'ÚLT. CONTATO': '02/10/2026', 'FALOU C/ DECISOR? ▼': 'Sim',
      'MOTIVO PERDA ▼': 'Cliente viajou', 'OBSERVAÇÕES': 'Hist.: whats 02/10', CNPJ: '00000000000102', 'Cliente fixa Claro?': 'TEM FIXA', 'HP cabeado': 'HP CABEADO', 'HP livre venda': 'SIM',
      'Situação comercial fixa': 'VENDA BLOQUEADA' }),
  ];
  const wb = X.read(X.write((() => { const w = X.utils.book_new(); X.utils.book_append_sheet(w, X.utils.aoa_to_sheet([['Painel']]), 'Painel'); X.utils.book_append_sheet(w, X.utils.aoa_to_sheet(aoa), 'Carteira'); return w; })(), { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true });
  const PERFIS = [{ id: 'u-b', nome: 'Zzbruno Teste', equipe: 'renovacao' }, { id: 'u-f', nome: 'Zzfabiana Teste', equipe: 'renovacao' }];
  const lido = rnLerArquivo(wb, PERFIS);
  eq([lido.formato, lido.erros, lido.linhas.length], ['consolidada', [], 2], 'reconhece a Carteira Consolidada');
  const a = lido.linhas[0], b = lido.linhas[1];
  eq([a.cnpj_digits, a.consultor_id, a.status, a.oportunidade, a.movimentacao, a.fatura, a.fixa_viavel, a.tem_fixa, a.consultor_anterior, a.hist_origem],
     ['19252622000135', 'u-b', 0, 'Renovação + Fixa', 'NOVO 25/11', 660.72, true, false, 'Zzsilvana', 'Nova atribuição'], 'campos da carteira e da regra de fixa viável');
  eq([b.consultor_id, b.status, b.tentativas, b.primeiro_contato, b.data_contato, b.falou_decisor, b.fixa_viavel, b.tem_fixa, b.movimentacao],
     ['u-f', 1, 2, '2026-10-02', '2026-10-02', 'Sim', false, true, 'SAIU da base 25/11'], 'atendimento anterior e fixa bloqueada');
  eq([b.motivo_perda, b.observacoes], ['Outro', 'Hist.: whats 02/10 · Motivo da perda: Cliente viajou'], 'motivo fora da lista vira Outro e vai para a observação');
  assert(a.dados_claro['CNPJ'] === '19.252.622/0001-35' && a.dados_claro['Score'] === 780, 'dados da Claro guardam as colunas da base');
  assert(a.dados_claro['ETAPA DO FUNIL ▼'] === undefined && a.dados_claro['RAZÃO SOCIAL'] === undefined, 'colunas de acompanhamento não vão para dados_claro');
  const p = rnPrevia(lido.linhas, []);
  eq([p.novos, p.saiu], [2, 1], 'prévia conta quem sai (movimentação SAIU)');
  // ==== Funil estilo Pipedrive: tela inicial, busca, prioridade, atalhos, coluna limitada ====
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  eq(rnEstado.aba, 'kanban', 'a Renovação abre no Funil');
  window.__tabelas.renovacao_carteira = Array.from({ length: 45 }, (_, i) => L({ id: 300 + i, razao_social: 'Zz Novo ' + i, prioridade: i < 5 ? 'P1' : 'P3', linhas_voz: i }))
    .concat([L({ id: 400, razao_social: 'Zz Atrasado', status: 2, prox_retorno: '2026-11-20', prioridade: 'P2', data_contato: '2026-11-10' })]);
  window.__tabelas.propostas = [];
  await rnCarregar(); await espera(30);
  rnTrocarAba('kanban');
  const col0 = () => document.querySelectorAll('#rnKanban [data-rn-coluna="0"] [data-rn-card]').length;
  eq([document.querySelectorAll('#rnKanban [data-rn-coluna]').length, col0()], [9, 20], 'colunas 0–8 e coluna 0 limitada a 20 cartões');
  document.querySelector('#rnKanban [data-rn-kb-mais="0"]').click();
  eq(col0(), 40, 'mostrar mais soma 20');
  document.getElementById('rnKbPrio').value = 'P1'; document.getElementById('rnKbPrio').dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(col0(), 5, 'filtro de prioridade no funil');
  document.getElementById('rnKbPrio').value = ''; document.getElementById('rnKbPrio').dispatchEvent(new window.Event('change', { bubbles: true }));
  document.querySelector('#rnKbChips [data-rn-kb-chip="atrasados"]').click();
  eq([col0(), document.querySelectorAll('#rnKanban [data-rn-coluna="2"] [data-rn-card]').length], [0, 1], 'atalho Atrasados');
  document.querySelector('#rnKbChips [data-rn-kb-chip="atrasados"]').click();
  const kbb = document.getElementById('rnKbBusca'); kbb.value = 'Novo 7'; kbb.dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(col0(), 1, 'busca no funil');
  assert(document.getElementById('rnKbKpis').textContent.includes('sem contato há +7 dias'), 'indicadores no topo do funil');
  fim();
`);
