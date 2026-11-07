// Testa a §143.1 — importação da carteira: base da Claro e planilha do time (migração). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  // ==== conversões ====
  eq([rnDataPlanilha('29/09/26'), rnDataPlanilha('1/10/2026'), rnDataPlanilha('2026-11-03 00:00:00'), rnDataPlanilha(new Date(2026, 9, 26)), rnDataPlanilha('ontem')],
     ['2026-09-29', '2026-10-01', '2026-11-03', '2026-10-26', null], 'datas da planilha');
  eq([rnNumBR('1.234,56'), rnNumBR('0,00'), rnNumBR(12.5), rnNumBR(''), rnNumBR('R$ 10')], [1234.56, 0, 12.5, null, 10], 'números BR');
  eq([rnInt(21), rnInt('15'), rnInt(''), rnInt(21.6)], [21, 15, null, 22], 'inteiros (número cru não perde a casa)');
  eq([rnStatusPlanilha('3-Contato efetivo'), rnStatusPlanilha('9-x'), rnStatusPlanilha('')], [3, 1, 1], 'status da planilha');
  eq(rnChave('MOTIVO PERDA ▼'), rnChave('motivo  perda'), 'cabeçalho com ▼ e espaços');

  // ==== monta um .xlsx fictício igual ao da planilha do time ====
  const X = window.XLSX;
  const base = [
    ['CONSULTOR', 'ORIGEM', 'CNPJ', 'Razão Social', 'Telefone de Contato', 'Nome do ADM', 'Quantidade de linhas (Voz)', 'APTO RENOVAÇÃO', 'CIDADE', 'DDD', 'Tempo de contrato (Voz)', 'Classificação', 'Desconto Claro', 'STATUS', 'SCORE'],
    ['Zzbruno', 'Nova atribuição', 1234567000189, 'Zz Um Ltda', 11900000001, 'Zz Adm Um', 12, 'APTO', 'Zz Cidade', 11, 21, 'CE', 'Nulo', 'ATIVO', 7],
    ['Zzbruno', 'Nova atribuição', '00.000.000/0001-02', 'Zz Dois Ltda', '', 'Zz Adm Dois', 3, '1 MÊS PARA APTO', 'Zz Cidade', 11, 20, 'CE', 'Nulo', 'ATIVO', ''],
    ['Zzbruno', 'Já atribuído (mailing anterior)', '00000000000103', 'Zz Três', '', '', 1, 'APTO', 'Zz Outra', 12, 22, 'CG', 'Nulo', 'ATIVO', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const time = [
    ['Razão Social', 'Telefone', 'STATUS ▼', 'DATA CONTATO', 'PRÓX. RETORNO', 'CANAL ▼', 'LINHAS RENOV.', 'BL VENDIDA (qtd)', 'SOL. DIGITAIS (R$)', 'MOTIVO PERDA ▼', 'OBSERVAÇÕES', 'CONSULTOR', 'CNPJ'],
    ['Zz Um Ltda', '', '3-Contato efetivo', __dataNode(2026, 8, 29), '26/10/26', 'WhatsApp', '', '', '', '', 'Zz retornar', 'Zzbruno', 1234567000189],
    ['Zz Dois Ltda', '', '7-Perdido', '01/10/2026', '', 'Fax', '', '', '', '', '', 'Zzbruno', '00000000000102'],
    ['Zz Três', '', '6-Renovado', '', '', 'Ligação', 15, 1, '0,00', '', '', 'Zzbruno', '00000000000103'],
  ];
  const resumo = [['RESUMO DA REDISTRIBUIÇÃO DA CARTEIRA'], ['Consultor', 'Qtd. Clientes']];
  const montar = (abas) => {
    const wb = X.utils.book_new();
    abas.forEach(([nome, aoa]) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa, { cellDates: true }), nome));
    return X.read(X.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true });
  };
  const PERFIS = [{ id: 'u-b', nome: 'Zzbruno Teste', equipe: 'renovacao' }, { id: 'u-x', nome: 'Zzoutro Teste', equipe: 'renovacao' }];

  let lido = rnLerArquivo(montar([['Resumo', resumo], ['Base Completa', base], ['Zzbruno', time]]), PERFIS);
  eq(lido.erros, [], 'sem erros');
  eq([lido.formato, lido.abas], ['planilha', ['Zzbruno']], 'reconhece a planilha do time');
  eq(lido.linhas.map(l => l.cnpj_digits), ['01234567000189', '00000000000102', '00000000000103'], 'CNPJ numérico ganha o zero da frente; formatado vira dígitos; linha vazia ignorada');
  const um = lido.linhas[0];
  eq([um.razao_social, um.telefone, um.nome_adm, um.linhas_voz, um.apto, um.cidade, um.ddd, um.tempo_contrato_voz, um.classificacao, um.origem, um.consultor_id],
     ['Zz Um Ltda', '11900000001', 'Zz Adm Um', 12, 'APTO', 'Zz Cidade', '11', 21, 'CE', 'Nova atribuição', 'u-b'], 'colunas da Claro e consultor pelo nome da aba');
  eq([um.status, um.data_contato, um.prox_retorno, um.canal, um.observacoes], [3, '2026-09-29', '2026-10-26', 'WhatsApp', 'Zz retornar'], 'atendimento da aba do consultor');
  eq(um.dados_claro.SCORE, 7, 'dados_claro guarda as colunas da base');
  assert(!('Telefone de Contato' in lido.linhas[1].dados_claro), 'dados_claro não guarda célula vazia');
  eq([lido.linhas[1].status, lido.linhas[1].canal, lido.linhas[1].motivo_perda], [7, null, null], 'canal fora da lista vira vazio; perdido sem motivo segue para pendência');
  eq([lido.linhas[2].status, lido.linhas[2].linhas_renovadas, lido.linhas[2].bl_vendida, lido.linhas[2].sol_digitais], [6, 15, 1, 0], 'renovado com linhas, BL e digitais');

  // base da Claro sem as abas do time
  lido = rnLerArquivo(montar([['Plan1', base.map(r => r.slice(1))]]), PERFIS);
  eq([lido.formato, lido.erros, lido.linhas[0].consultor_id, lido.linhas[0].status], ['base', [], null, undefined], 'base pura: sem consultor e sem atendimento');

  // erros que bloqueiam
  lido = rnLerArquivo(montar([['Base Completa', base], ['Zzfabi', time.map((r, i) => i ? r.slice(0, 11).concat(['Zzfabi', r[12]]) : r)]]), PERFIS);
  assert(lido.erros.some(e => /"Zzfabi" não tem login no time de renovação/.test(e)), 'consultor sem login bloqueia');
  lido = rnLerArquivo(montar([['Qualquer', [['A', 'B'], [1, 2]]]]), PERFIS);
  eq(lido.erros, ['Não achei a base: falta uma aba com as colunas CNPJ e Razão Social.'], 'arquivo sem base');

  // prévia
  const linhas = rnLerArquivo(montar([['Base Completa', base], ['Zzbruno', time]]), PERFIS).linhas;
  eq(rnPrevia(linhas, [{ cnpj_digits: '00000000000103', na_base: true }, { cnpj_digits: '00000000000999', na_base: true }, { cnpj_digits: '00000000000998', na_base: false }]),
     { novos: 2, atualizados: 1, sairam: 1, completar: 1 }, 'prévia: novos, já existem, saem, pendências');

  // ==== tela: admin escolhe o arquivo, vê a prévia e importa em lotes ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [{ id: 9, cnpj_digits: '00000000000103', na_base: true, status: 6, linhas_renovadas: 15 }];
  window.__tabelas.profiles = PERFIS;
  window.__tabelas.renovacao_resumo = [];
  await rnCarregar();
  rnTrocarAba('resumo');
  await espera(30);
  assert(!!document.getElementById('rnArquivo'), 'admin vê Importar base');
  const buf = X.write((() => { const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(base), 'Base Completa'); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(time), 'Zzbruno'); return wb; })(), { type: 'array', bookType: 'xlsx' });
  await rnPrepararImportacao({ arrayBuffer: async () => buf });
  const prev = document.getElementById('rnPrevia').textContent.replace(/\\s+/g, ' ');
  assert(/3 CNPJs/.test(prev) && /2 novos/.test(prev) && /1 já existem/.test(prev), 'prévia na tela: ' + prev);
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.renovacao_importar = (a) => ({ data: { novos: a.p_linhas.length, atualizados: 0 }, error: null });
  window.__rpcRespostas.renovacao_marcar_fora = { data: 0, error: null };
  document.querySelector('#rnPrevia [data-rn-importar]').click();
  await espera(60);
  eq(window.__rpcCalls.map(c => c.nome), ['renovacao_importar', 'renovacao_marcar_fora'], 'importa e depois marca quem saiu');
  eq(window.__rpcCalls[1].args.p_cnpjs.length, 3, 'marcar_fora recebe todos os CNPJs do arquivo');
  eq(rnEstado.importacao, null, 'importação limpa depois de terminar');

  // falha no meio: para, avisa e não marca ninguém fora
  await rnPrepararImportacao({ arrayBuffer: async () => buf });
  let aviso = null; const avisoOrig = mostrarAviso; mostrarAviso = (m, t) => { aviso = [m, t]; };
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.renovacao_importar = { data: null, error: { message: 'timeout' } };
  document.querySelector('#rnPrevia [data-rn-importar]').click();
  await espera(40);
  eq(window.__rpcCalls.map(c => c.nome), ['renovacao_importar'], 'falha não chama marcar_fora');
  assert(aviso && aviso[1] === 'erro' && /importe o mesmo arquivo de novo/.test(aviso[0]), 'aviso explica como terminar');
  mostrarAviso = avisoOrig;
  fim();
`);
