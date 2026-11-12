// Testa o bloco Conferência da TV Vendas (§149). DADOS FICTÍCIOS.
const { rodar } = require('./tv_vendas_harness.js');
rodar(`
  Object.assign(TV_TEMPOS, { tick: 100000, ranking: 100000, alternar: 100000, relogio: 100000 });
  window.__rpcRespostas.tv_ranking = { data: { periodo: 'hoje', de: '2026-11-12', ate: '2026-11-12', linhas: [], totais: {}, meta: {}, ultima: null }, error: null };
  window.__rpcRespostas.tv_ultima_venda = { data: { ultimo_id: 1, cancelados_ids: [], meta: null }, error: null };
  window.__rpcRespostas.tv_conferencia = { data: [
    { id: 5, dia: '2026-11-05', cnpj: '11222333000181', receita: 474.95, origem: 'discador', neo_status: 'nao_encontrada', nome: 'Zz Ana Teste', aviso: 'Sem pedido na NEO em 3 dias úteis' },
    { id: 6, dia: '2026-11-06', cnpj: null, receita: 100, origem: 'lead', neo_status: 'nao_encontrada', nome: 'Zz Bia Teste', aviso: 'Sem pedido na NEO em 3 dias úteis' },
    { id: 7, dia: '2026-11-07', cnpj: '11444777000161', receita: 300, origem: 'renovacao', neo_status: 'confirmada', neo_receita: 900, neo_pedido: 'P-1', nome: 'Zz Caio Teste', aviso: 'Receita da NEO diferente (mais de 20%)' }], error: null };
  currentUser = { id: 'u-ad', nome: 'Zz Admin', role: 'admin', operacao: 'apex' };
  tvAplicarPermissao();
  document.getElementById('tabBtnTvVendas').click(); await espera(40);
  const box = document.getElementById('tvConferencia');
  const linhas = box.querySelectorAll('tbody tr');
  eq(linhas.length, 3, 'uma linha por venda a conferir');
  assert(box.textContent.includes('Conferência') && box.textContent.includes('3'), 'título com a contagem');
  assert(linhas[0].textContent.includes('11.222.333/0001-81') && linhas[0].textContent.includes('Sem pedido na NEO'), 'CNPJ com máscara e aviso');
  assert(linhas[1].textContent.includes('sem CNPJ'), 'lead sem CNPJ');
  assert(!linhas[1].querySelector('[data-tv-conf-acao="cancelar"]'), 'venda de lead: sem Cancelar (muda o status do lead)');
  assert(linhas[2].textContent.includes(fmtBRL(900)), 'receita da NEO na divergência');

  // decidir pede motivo
  linhas[0].querySelector('[data-tv-conf-acao="ok"]').click();
  const mot = box.querySelector('#tvConfMotivo');
  assert(!!mot, 'abre o campo do motivo');
  mot.value = 'x'; box.querySelector('[data-tv-conf-salvar]').click(); await espera();
  eq(chamadas('vendas_conferencia_decidir').length, 0, 'motivo curto não vai');
  assert(box.textContent.includes('pelo menos 3 letras'), 'erro do motivo');
  window.__rpcRespostas.vendas_conferencia_decidir = { data: null, error: null };
  window.__rpcRespostas.tv_conferencia = { data: [], error: null };
  box.querySelector('#tvConfMotivo').value = 'cliente fechou depois'; box.querySelector('[data-tv-conf-salvar]').click(); await espera(30);
  eq(chamadas('vendas_conferencia_decidir')[0].args, { p_id: 5, p_acao: 'ok', p_motivo: 'cliente fechou depois' }, 'decisão enviada');
  assert(box.textContent.includes('Nada para conferir'), 'lista recarrega vazia');
`);
