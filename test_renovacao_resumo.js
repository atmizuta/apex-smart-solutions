// Testa a §143.1 — Retornos e Resumo da Renovação (fórmulas iguais às da planilha). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  eq(rnSomarDias('2026-11-28', 7), '2026-12-05', 'soma dias virando o mês');
  const L = (o) => Object.assign({ razao_social: 'Zz', linhas_voz: 1, status: 2, na_base: true, consultor_id: 'u-a' }, o);
  const lista = [
    L({ id: 1, prox_retorno: '2026-11-01' }), L({ id: 2, prox_retorno: '2026-11-07' }), L({ id: 3, prox_retorno: '2026-11-14' }),
    L({ id: 4, prox_retorno: '2026-11-15' }), L({ id: 5, prox_retorno: '2026-11-01', status: 6 }), L({ id: 6, prox_retorno: '2026-11-02', na_base: false }),
    L({ id: 7, prox_retorno: '2026-10-30', linhas_voz: 5 }),
  ];
  const g = rnRetornos(lista, '2026-11-07');
  eq([g.vencidos.map(r => r.id), g.hoje.map(r => r.id), g.proximos.map(r => r.id)], [[7, 1], [2], [3]], 'vencidos (mais antigo primeiro), hoje, próximos 7 dias');

  // mesmos números do Resumo da planilha em 07/11 (Bruno/Fabiana/Silvana)
  const rows = [
    { consultor_id: 'u-b', consultor_nome: 'Zzbruno', carteira: 414, contatados: 32, efetivo_mais: 16, propostas_mais: 4, renovados: 2, perdidos: 11, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: 0, retornos_atrasados: 2, a_completar: 0 },
    { consultor_id: 'u-f', consultor_nome: 'Zzfabiana', carteira: 414, contatados: 84, efetivo_mais: 20, propostas_mais: 11, renovados: 4, perdidos: 24, linhas_renovadas: 19, bl_vendida: 1, sol_digitais: 0, retornos_atrasados: 22, a_completar: 0 },
    { consultor_id: 'u-s', consultor_nome: 'Zzsilvana', carteira: 414, contatados: 165, efetivo_mais: 17, propostas_mais: 8, renovados: 2, perdidos: 17, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: '0.00', retornos_atrasados: 0, a_completar: 0 },
  ];
  const r = rnLinhasResumo(rows);
  eq(r.corpo.map(l => [l.nome, l.cobertura, l.conversao]), [['Zzbruno', 7.7, 12.5], ['Zzfabiana', 20.3, 20], ['Zzsilvana', 39.9, 11.8]], '% cobertura e % conversão por consultor');
  eq([r.total.carteira, r.total.contatados, r.total.cobertura, r.total.efetivo, r.total.propostas, r.total.renovados, r.total.perdidos, r.total.conversao, r.total.linhas, r.total.bl, r.total.atrasados],
     [1242, 281, 22.6, 53, 23, 8, 52, 15.1, 19, 1, 24], 'linha TOTAL igual à da planilha');
  eq(rnLinhasResumo([{ consultor_id: null, carteira: 3, contatados: 0, efetivo_mais: 0, propostas_mais: 0, renovados: 0, perdidos: 0, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: 0, retornos_atrasados: 0 }]).corpo[0].nome, 'Sem consultor', 'carteira sem dono aparece');

  // telas
  rnHoje = () => '2026-11-07';   // a tela usa o "hoje" de SP; o teste fixa a data
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'supervisor', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = lista;
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }];
  window.__tabelas.renovacao_resumo = rows;
  await rnCarregar();
  rnTrocarAba('retornos');
  await espera(20);
  const blocos = [...document.querySelectorAll('#rnRetornos .rnRetBloco h3')].map(h => h.textContent.replace(/\\s+/g, ' ').trim());
  eq(blocos, ['Vencidos 2', 'Hoje 1', 'Próximos 7 dias 1'], 'blocos de retorno com contagem');
  assert(/Zza Teste/.test(document.getElementById('rnRetornos').textContent), 'gestor vê de quem é o retorno');
  rnTrocarAba('resumo');
  await espera(30);
  const trs = [...document.querySelectorAll('#rnResumo tbody tr')].map(t => [...t.children].map(td => td.textContent));
  eq(trs.length, 4, '3 consultores + TOTAL');
  eq(trs[3].slice(0, 9), ['TOTAL', '1242', '281', '22,6%', '53', '23', '8', '52', '15,1%'], 'TOTAL formatado como na planilha');
  assert(!document.getElementById('rnArquivo'), 'supervisor não importa');
  window.__resp.renovacao_resumo = () => ({ data: null, error: { message: 'x' } });
  await rnRenderResumo();
  assert(/Não foi possível carregar o resumo/.test(document.getElementById('rnResumo').textContent), 'erro do resumo avisa');
  fim();
`);
