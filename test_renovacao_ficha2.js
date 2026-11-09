// Testa a §143.2 — ficha com Gerar proposta e Propostas ligadas. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [{ id: 1, cnpj_digits: '00000000000201', razao_social: 'Zz Dois Um', linhas_voz: 3, status: 5, na_base: true, consultor_id: 'u-a', dados_claro: {} },
                                          { id: 2, cnpj_digits: '00000000000202', razao_social: 'Zz Sem Proposta', linhas_voz: 1, status: 2, na_base: true, consultor_id: 'u-a', dados_claro: {} }];
  window.__tabelas.propostas = [
    { id: 'p2', carteira_id: 1, valor_atual: 800, valor_proposto: 650, estagio: 'negociacao', criado_em: '2026-11-08T13:00:00Z' },
    { id: 'p1', carteira_id: 1, valor_atual: 800, valor_proposto: 700, estagio: 'fechado_perdido', criado_em: '2026-11-01T13:00:00Z' },
  ];
  window.__tabelas.renovacao_historico = [];
  await rnCarregar();
  await rnAbrirFicha(1);
  const itens = [...document.querySelectorAll('#rnFichaCorpo [data-rn-proposta]')].map(b => b.closest('li').textContent.replace(/\\s+/g, ' '));
  eq(itens.length, 2, 'duas propostas ligadas');
  assert(/800,00 → R\\$\\s?650,00/.test(itens[0]) && /08\\/11\\/2026/.test(itens[0]) && /Negociação/.test(itens[0]), 'mais nova primeiro, com valores, data e estágio: ' + itens[0]);
  assert(/Fechado\\/Perdido/.test(itens[1]), 'estágio da antiga');

  const abriu = []; const abrirOrig = abrirPropostaDoCard; abrirPropostaDoCard = (p) => abriu.push(p.id);
  document.querySelector('#rnFichaCorpo [data-rn-proposta="p2"]').click();
  eq(abriu, ['p2'], 'clicar na proposta reabre no gerador');
  abrirPropostaDoCard = abrirOrig;
  const gerou = []; const gerarOrig = rnGerarProposta; rnGerarProposta = (id) => gerou.push(id);
  document.querySelector('#rnFichaCorpo [data-rn-gerar]').click();
  eq(gerou, [1], 'Gerar proposta na ficha');
  rnGerarProposta = gerarOrig;

  await rnAbrirFicha(2);
  assert(/Nenhuma proposta ainda/.test(document.getElementById('rnFichaCorpo').textContent), 'cliente sem proposta avisa');
  fim();
`);
