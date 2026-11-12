// Testa as funções puras da §149 (TV Vendas). Spec: docs/superpowers/specs/2026-11-12-tv-vendas-design.md.
// DADOS FICTÍCIOS (repo público).
const { rodar } = require('./tv_vendas_harness.js');
rodar(`
  const ofs = vdOfertas();
  eq(ofs.length, OFFERS_MOBILE.length, 'uma opção por oferta do Gerar Proposta');
  const o100 = ofs.find(o => o.id === 'p57-100');
  eq(o100.valor, OFFERS_MOBILE.find(o => o.id === 'p57-100').valor, 'valor já com o Monitor incluso');
  assert(o100.rotulo.indexOf('100GB · ') === 0 && o100.rotulo.includes(fmtBRL(o100.valor)), 'rótulo: GB e preço');
  assert(ofs.find(o => o.id === 'p59-6').rotulo.includes('Portabilidade'), 'oferta de portabilidade identificada');

  eq(vdReceita([{ valor_linha: 94.99, linhas: 5 }, { valor_linha: 59.99, linhas: 2 }]), 594.93, 'receita de pedido misto');
  eq(vdReceita([{ valor_linha: 0.1, linhas: 3 }]), 0.3, 'soma em centavos');
  eq(vdReceita([]), 0, 'sem itens');

  eq(vdItensErro([]), 'Escolha pelo menos um plano.', 'lista vazia');
  eq(vdItensErro([{ plano_id: '', linhas: 1 }]), 'Plano 1: escolha o plano.', 'sem plano');
  eq(vdItensErro([{ plano_id: 'p57-40', linhas: 0 }]), 'Plano 1: linhas de 1 a 300.', 'zero linhas');
  eq(vdItensErro([{ plano_id: 'p57-40', linhas: 2.5 }]), 'Plano 1: linhas de 1 a 300.', 'linhas quebradas');
  eq(vdItensErro([{ plano_id: 'p57-40', linhas: 3 }, { plano_id: 'p57-70', linhas: NaN }]), 'Plano 2: linhas de 1 a 300.', 'erro aponta o plano certo');
  eq(vdItensErro([{ plano_id: 'p57-40', linhas: 200 }, { plano_id: 'p57-70', linhas: 101 }]), 'No máximo 300 linhas por pedido.', 'total acima de 300');
  eq(vdItensErro(new Array(11).fill({ plano_id: 'p57-40', linhas: 1 })), 'No máximo 10 planos por pedido.', 'mais de 10 planos');
  eq(vdItensErro([{ plano_id: 'p57-40', linhas: 3 }]), '', 'válido');

  eq(tvIniciais('Zz Ana Claudia Teste'), 'ZT', 'primeira e última');
  eq(tvIniciais('  zz  '), 'Z', 'um nome, maiúscula');
  eq(tvIniciais(''), '?', 'vazio');

  eq(tvConversaoTxt(null), '—', 'sem contato');
  eq(tvConversaoTxt(undefined), '—', 'sem dado');
  eq(tvConversaoTxt(4.2), '4,2%', 'vírgula');
  eq(tvConversaoTxt(10), '10,0%', 'uma casa');

  eq(tvTextoSubida({ pos_antes: 7, pos_depois: 5 }), '▲ subiu do 7º para o 5º lugar no mês', 'subiu');
  eq(tvTextoSubida({ pos_antes: null, pos_depois: 3 }), '▲ entrou em 3º lugar no mês', 'entrou');
  eq(tvTextoSubida({ pos_antes: 1, pos_depois: 1 }), 'manteve o 1º lugar no mês', 'manteve');
  eq(tvTextoSubida({ pos_antes: null, pos_depois: null }), '', 'sem posição');

  const antes = [{ profile_id: 'a', posicao: 1 }, { profile_id: 'b', posicao: 2 }, { profile_id: 'c', posicao: null }];
  const depois = [{ profile_id: 'b', posicao: 1 }, { profile_id: 'a', posicao: 2 }, { profile_id: 'c', posicao: 3 }, { profile_id: 'd', posicao: null }];
  eq(tvSetas(antes, depois), { b: 1, a: -1, c: null, d: 0 }, 'subiu, desceu, entrou, sem venda');

  eq(tvFiltrarFila([{ id: 1 }, { id: 2 }, { id: 3 }], [2, 9]).map(v => v.id), [1, 3], 'cancelada sai da fila');
  eq(tvFiltrarFila([{ id: 1 }], null).map(v => v.id), [1], 'sem lista de canceladas');
`);
