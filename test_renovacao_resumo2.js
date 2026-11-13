// Testa a §151 — Resumo redesenhado (fórmulas da planilha) e Funil com "parado há". DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const rows = [
    { consultor_id: 'u-b', consultor_nome: 'Zzbruno', carteira: 414, contatados: 32, efetivo_mais: 16, propostas_mais: 4, renovados: 2, perdidos: 11, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: 0, retornos_atrasados: 2, a_completar: 0 },
    { consultor_id: 'u-f', consultor_nome: 'Zzfabiana', carteira: 414, contatados: 84, efetivo_mais: 20, propostas_mais: 11, renovados: 4, perdidos: 24, linhas_renovadas: 19, bl_vendida: 1, sol_digitais: 0, retornos_atrasados: 22, a_completar: 0 },
    { consultor_id: 'u-s', consultor_nome: 'Zzsilvana', carteira: 414, contatados: 165, efetivo_mais: 17, propostas_mais: 8, renovados: 2, perdidos: 17, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: '0.00', retornos_atrasados: 0, a_completar: 0 },
  ];
  const r = rnLinhasResumo(rows);
  eq([r.total.carteira, r.total.contatados, r.total.cobertura, r.total.efetivo, r.total.propostas, r.total.renovados, r.total.perdidos, r.total.conversao, r.total.linhas, r.total.atrasados],
     [1242, 281, 22.6, 53, 23, 8, 52, 15.1, 19, 24], 'TOTAL igual à planilha');

  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = []; window.__tabelas.profiles = []; window.__tabelas.propostas = [];
  window.__tabelas.renovacao_resumo = rows;
  await rnCarregar();
  rnTrocarAba('resumo'); await espera(30);
  const kpis = [...document.querySelectorAll('#rnResumo .rnKpi')].map(k => k.textContent.replace(/\\s+/g, ' ').trim());
  eq(kpis, ['1.242 clientes na carteira', '22,6% contatados (281)', '15,1% conversão (8 de 53)', '24 retornos atrasados'], 'cartões do Resumo');
  const tr = [...document.querySelectorAll('#rnResumo tbody tr')].map(t => [...t.children].map(td => td.textContent.replace(/\\s+/g, ' ').trim()));
  eq(tr.length, 4, '3 consultores + TOTAL');
  eq(tr[3].slice(0, 7), ['TOTAL', '1242', '22,6%', '15,1%', '23', '8', '52'], 'linha TOTAL');
  const ov = document.getElementById('rnImportar');
  assert(!!ov && !ov.classList.contains('active') && !!document.getElementById('rnArquivo'), 'importação fica numa janela fechada');
  document.querySelector('#rnResumo [data-rn-abrir-importar]').click();
  assert(ov.classList.contains('active'), 'botão abre a importação');
  currentUser = { id: 'u-s', nome: 'Zzs Teste', role: 'supervisor', operacao: 'apex' };
  await rnRenderResumo();
  assert(!document.querySelector('#rnResumo [data-rn-abrir-importar]'), 'supervisor não importa');

  // Funil: parado há N dias, vermelho a partir de 7 em 3–5
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  const dias = (n) => new Date(Date.now() - n * 86400000).toISOString();
  window.__tabelas.renovacao_carteira = [
    { id: 1, razao_social: 'Zz Parado', linhas_voz: 3, status: 3, na_base: true, consultor_id: 'u-a', status_desde: dias(8) },
    { id: 2, razao_social: 'Zz Recente', linhas_voz: 3, status: 4, na_base: true, consultor_id: 'u-a', status_desde: dias(2) },
    { id: 3, razao_social: 'Zz Ganho', linhas_voz: 3, status: 6, linhas_renovadas: 3, na_base: true, consultor_id: 'u-a', status_desde: dias(30) },
  ];
  await rnCarregar(); rnTrocarAba('kanban');
  const p1 = document.querySelector('#rnKanban [data-rn-card="1"] .rnParado'), p2 = document.querySelector('#rnKanban [data-rn-card="2"] .rnParado');
  assert(p1 && p1.classList.contains('late') && /parado há 8 dias/.test(p1.textContent), 'parado há 8 dias em vermelho');
  assert(p2 && !p2.classList.contains('late') && /parado há 2 dias/.test(p2.textContent), 'parado há 2 dias sem alarme');
  assert(!document.querySelector('#rnKanban [data-rn-card="3"] .rnParado') && /3 renovadas/.test(document.querySelector('#rnKanban [data-rn-card="3"]').textContent), 'renovado sem "parado", com as linhas');
  assert(/Contato efetivo/.test(document.querySelector('#rnKanban [data-rn-coluna="3"] .rnKbHead').textContent), 'coluna com a etiqueta da etapa');
  fim();
`);
