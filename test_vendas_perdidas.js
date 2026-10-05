// Testa a sub-aba "Vendas Perdidas" do Dashboard de Produção (05/10/2026) — REGRAS_NEGOCIO.md §70.
// Spec: docs/superpowers/specs/2026-10-05-vendas-perdidas-adendo-dashboard.md (seção D).
// Parte 1: decodifica o template embutido de verdade (PRODUCAO_DASHBOARD_TPL_B64), preenche os placeholders com
// dados FICTÍCIOS e roda o script real num jsdom (mesma técnica de test_pedidos_alerta.js).
// Parte 2: roda loadProducaoDashboard() do _template.html com o Supabase mockado e confere o que é injetado.
// DADOS FICTÍCIOS — o repositório é público (nada de nome, telefone ou CNPJ real).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const XLSX = require('xlsx');
const { comRange } = require('./test_helper_mock.js');

const outerHtml = fs.readFileSync('_template.html', 'utf8');
const m = outerHtml.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/);
if(!m){ console.error('PRODUCAO_DASHBOARD_TPL_B64 nao encontrado'); process.exit(1); }
const tplRaw = Buffer.from(m[1], 'base64').toString('utf8');
const htmlNoScript = tplRaw.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = tplRaw.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script do template embutido nao encontrado'); process.exit(1); }
const jsOriginal = scriptMatch[1];

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// "Agora" fixo dos testes: seg 05/10/2026 15:00 em São Paulo.
const AGORA_PADRAO = Date.parse('2026-10-05T15:00:00-03:00');
const HORA = 3600000;
assert(jsOriginal.includes('__PERDIDAS__') && jsOriginal.includes('__PERDIDAS_SYNC__'), 'o template recebe __PERDIDAS__ e __PERDIDAS_SYNC__');
assert(jsOriginal.includes('function perdAgora(){ return Date.now(); }'), 'perdAgora() existe para fixar o relógio no teste');

function montar({ adminMode = true, perdidas = [], sync = new Date(AGORA_PADRAO - HORA).toISOString(), agora = AGORA_PADRAO, semPlaceholder = false } = {}){
  const html = htmlNoScript.replace('__ADMIN_BADGE__', '').replace('__APEX_B64__', '').replace('__CLARO_B64__', '').replace('__UPDATED_AT__', '05/10/2026, 14:59:00');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  w.alert = () => { w.__alertou = true; };
  w.confirm = () => true;
  w.__arquivos = [];
  w.XLSX = { utils: XLSX.utils, writeFile: (wb, nome) => { w.__arquivos.push({ wb, nome }); } };
  let js = jsOriginal
    .replace('let DATA = __DATA__;', 'let DATA = [];')
    .replace('__ADMIN_MODE__', adminMode ? 'true' : 'false')
    .replace('function perdAgora(){ return Date.now(); }', 'function perdAgora(){ return window.__agora; }');
  if(!semPlaceholder){
    js = js.replace('__PERDIDAS_SYNC__', () => JSON.stringify(sync)).replace('__PERDIDAS__', () => JSON.stringify(perdidas));
  }
  w.__agora = agora;
  w.eval(js);
  return w;
}
const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => [...w.document.querySelectorAll(sel)];
const txt = (w, sel) => ($(w, sel) || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
const kpi = (w, rotulo) => { const c = $$(w, '#perdKpis .card').find(x => x.querySelector('.label').textContent.trim() === rotulo); return c ? c.querySelector('.value').textContent.trim() : null; };
const pedidosTabela = w => $$(w, '#perdBody tr').map(tr => tr.children[0].textContent.trim());

const MALICIOSO = '<img src=x onerror=alert(1)>';
// Linha no formato da RPC vendas_perdidas v3 (fictícia).
const lp = o => Object.assign({ numero_pedido: 'P', usuario: 'CAIO TESTE', profile_id: null, cliente: 'EMPRESA FICTICIA LTDA', produtos: 'Plano Teste',
  valor: 100, perdido_em: '2026-10-02T10:00:00-03:00', categoria: null, subcategoria: null, tags: null, tag_pedido: null,
  grupo: 'VOZ - Novo', solicitacao: 'Ativação', cidade: 'CIDADE ALFA', cadastro: '2026-10-01T09:00:00-03:00' }, o);
const FIXTURE = [
  lp({ numero_pedido: 'P1', categoria: 'Restrição de Crédito', grupo: 'VOZ - Portabilidade', perdido_em: '2026-10-02T10:00:00-03:00', cadastro: '2026-10-01T09:00:00-03:00', valor: 100, tags: ['#credito'] }),  // 1 dia
  lp({ numero_pedido: 'P2', categoria: 'Restrição de Crédito', grupo: 'VOZ - Novo', perdido_em: '2026-10-03T11:00:00-03:00', cadastro: '2026-09-20T09:00:00-03:00', valor: 50 }),                          // 13 dias
  lp({ numero_pedido: 'P3', usuario: 'MARIA TESTE', categoria: 'Não responde', grupo: 'VOZ - Portabilidade', perdido_em: '2026-10-04T09:00:00-03:00', cadastro: '2026-09-01T09:00:00-03:00', valor: 200, cidade: 'CIDADE BETA' }), // 33 dias
  // UTC 05/10 01:30Z = 04/10 22:30 em São Paulo; sem cadastro (fora do tempo médio) e sem motivo
  lp({ numero_pedido: 'P4', usuario: 'MARIA TESTE', categoria: '  ', grupo: 'BANDA LARGA - Novo', perdido_em: '2026-10-05T01:30:00Z', cadastro: null, valor: 80, cidade: null, tag_pedido: '#retorno' }),
  // nome malicioso: tem de aparecer como texto, nunca virar HTML
  lp({ numero_pedido: 'P5', usuario: MALICIOSO, cliente: '<script>window.__xss=1</script>', categoria: 'Desconfiança', grupo: 'VOZ - Novo', perdido_em: '2026-10-01T00:30:00-03:00', cadastro: '2026-10-01T00:10:00-03:00', valor: 30, cidade: '"><b>CIDADE</b>' }), // 0 dia
  // mês passado
  lp({ numero_pedido: 'P6', categoria: 'Não responde', perdido_em: '2026-09-15T10:00:00-03:00', cadastro: '2026-09-10T10:00:00-03:00', valor: 70 }),
  // UTC 01/10 02:00Z = 30/09 23:00 em São Paulo → setembro, não outubro
  lp({ numero_pedido: 'P8', categoria: 'Duplicidade', perdido_em: '2026-10-01T02:00:00Z', valor: 10 }),
  // dentro dos 180 dias, fora de 90
  lp({ numero_pedido: 'P7', categoria: 'Duplicidade', perdido_em: '2026-06-01T10:00:00-03:00', cadastro: '2026-05-01T10:00:00-03:00', valor: 40 }),
];

// ---------------- regras puras ----------------
{
  const w = montar({ perdidas: FIXTURE });
  const per = (t, h) => JSON.stringify(w.perdPeriodo(t, h));
  assert(per('mes', '2026-10-05') === JSON.stringify({ de: '2026-10-01', ate: '2026-10-05' }), 'Este mês: 01/10 até hoje — ' + per('mes', '2026-10-05'));
  assert(per('mespassado', '2026-10-05') === JSON.stringify({ de: '2026-09-01', ate: '2026-09-30' }), 'Mês passado: setembro inteiro');
  assert(per('mespassado', '2027-01-15') === JSON.stringify({ de: '2026-12-01', ate: '2026-12-31' }), 'Mês passado em janeiro: dezembro do ano anterior — ' + per('mespassado', '2027-01-15'));
  assert(per('mespassado', '2028-03-10') === JSON.stringify({ de: '2028-02-01', ate: '2028-02-29' }), 'Mês passado em março de ano bissexto: fevereiro com 29 dias');
  assert(per('90d', '2026-10-05') === JSON.stringify({ de: '2026-07-08', ate: '2026-10-05' }), 'Últimos 90 dias: inclui hoje (07/07 + 90 = hoje) — ' + per('90d', '2026-10-05'));
  assert(per('180d', '2026-10-05') === JSON.stringify({ de: '2026-04-09', ate: '2026-10-05' }), 'Últimos 180 dias: inclui hoje — ' + per('180d', '2026-10-05'));
  assert(w.perdHoje() === '2026-10-05', 'hoje é o dia de São Paulo');
  w.__agora = Date.parse('2026-10-06T01:00:00Z'); // 05/10 22:00 em SP
  assert(w.perdHoje() === '2026-10-05', 'às 22h de SP (01h UTC do dia seguinte) ainda é o mesmo dia');
  w.__agora = AGORA_PADRAO;

  assert(w.perdDiasAtePerder(FIXTURE[0]) === 1, 'tempo até perder: 01/10 → 02/10 = 1 dia');
  assert(w.perdDiasAtePerder(FIXTURE[2]) === 33, 'tempo até perder: 01/09 → 04/10 = 33 dias');
  assert(w.perdDiasAtePerder(FIXTURE[3]) === null, 'sem cadastro → null (não vira 0)');
  assert(w.perdDiasAtePerder(FIXTURE[4]) === 0, 'cadastro e perda no mesmo dia = 0');
  assert(w.perdDiasAtePerder(lp({ cadastro: '2026-10-01T23:30:00-03:00', perdido_em: '2026-10-02T00:30:00-03:00' })) === 1, 'conta dias de calendário em SP, não horas');
  assert(w.perdFaixa(0) === 'f1' && w.perdFaixa(1) === 'f1' && w.perdFaixa(2) === 'f2' && w.perdFaixa(7) === 'f2' && w.perdFaixa(8) === 'f3'
    && w.perdFaixa(15) === 'f3' && w.perdFaixa(16) === 'f4' && w.perdFaixa(30) === 'f4' && w.perdFaixa(31) === 'f5', 'faixas 0–1, 2–7, 8–15, 16–30, 30+ nas fronteiras');
  assert(w.perdNivelPreenchimento(0.9) === 'ok' && w.perdNivelPreenchimento(0.89) === 'medio' && w.perdNivelPreenchimento(0.5) === 'medio' && w.perdNivelPreenchimento(0.49) === 'baixo', 'selos: ≥90% ok, 50–89% médio, <50% baixo');

  // período em SP: P8 (01/10 02:00Z) é setembro; P4 (05/10 01:30Z) é outubro
  const out = w.perdFiltrar(FIXTURE, { periodo: 'mes' }, '2026-10-05').map(l => l.numero_pedido).sort();
  assert(JSON.stringify(out) === JSON.stringify(['P1', 'P2', 'P3', 'P4', 'P5']), 'Este mês pega P1–P5 (P8 é 30/09 em SP) — ' + JSON.stringify(out));
  const set = w.perdFiltrar(FIXTURE, { periodo: 'mespassado' }, '2026-10-05').map(l => l.numero_pedido).sort();
  assert(JSON.stringify(set) === JSON.stringify(['P6', 'P8']), 'Mês passado pega P6 e P8 — ' + JSON.stringify(set));
  assert(w.perdFiltrar(FIXTURE, { periodo: '90d' }, '2026-10-05').length === 7, '90 dias: tudo menos o de junho');
  assert(w.perdFiltrar(FIXTURE, { periodo: '180d' }, '2026-10-05').length === 8, '180 dias: tudo');

  // KPIs de outubro
  const out5 = w.perdFiltrar(FIXTURE, { periodo: 'mes' }, '2026-10-05');
  const k = w.perdKpis(out5);
  assert(k.pedidos === 5 && k.valor === 460 && k.ticket === 92, 'KPIs: 5 pedidos, R$ 460, ticket R$ 92 — ' + JSON.stringify(k));
  assert(k.comMotivo === 4 && Math.abs(k.pctComMotivo - 0.8) < 1e-9, '80% com motivo (motivo só com espaços conta como sem motivo)');
  assert(k.maiorMotivo && k.maiorMotivo.motivo === 'Restrição de Crédito' && k.maiorMotivo.pedidos === 2 && Math.abs(k.maiorMotivo.pct - 0.5) < 1e-9, 'maior motivo: Restrição de Crédito, 50% das perdas com motivo');
  assert(Math.abs(k.tempoMedio - 11.75) < 1e-9 && k.nTempo === 4 && k.semCadastro === 1, 'tempo médio (0+1+13+33)/4 = 11,75; o sem cadastro fica fora');
  const k0 = w.perdKpis([]);
  assert(k0.pedidos === 0 && k0.ticket === 0 && k0.tempoMedio === null && k0.maiorMotivo === null, 'KPIs com 0 pedidos não dividem por zero');

  // ordem dos motivos: pedidos desc, depois valor desc; "Sem motivo informado" por último
  const ord = w.perdMotivos(out5).map(x => x.motivo);
  assert(JSON.stringify(ord) === JSON.stringify(['Restrição de Crédito', 'Não responde', 'Desconfiança', 'Sem motivo informado']), 'ordem dos motivos — ' + JSON.stringify(ord));
  const semGrande = w.perdMotivos([lp({ categoria: null }), lp({ categoria: null }), lp({ categoria: 'Duplicidade' })]).map(x => x.motivo);
  assert(semGrande[semGrande.length - 1] === 'Sem motivo informado', '"Sem motivo informado" fica por último mesmo sendo o maior');

  // matriz motivo × tipo
  const mz = w.perdMatriz(out5, w.perdMotivo, w.perdGrupo, 6);
  assert(JSON.stringify(mz.cols) === JSON.stringify(['VOZ - Novo', 'VOZ - Portabilidade', 'BANDA LARGA - Novo']), 'colunas por nº de pedidos (empate em ordem alfabética) — ' + JSON.stringify(mz.cols));
  const linha = nome => mz.rows.find(r => r.chave === nome);
  assert(JSON.stringify(linha('Restrição de Crédito').celulas) === JSON.stringify([1, 1, 0]) && linha('Restrição de Crédito').total === 2, 'Restrição: 1 Novo, 1 Portabilidade');
  assert(JSON.stringify(linha('Sem motivo informado').celulas) === JSON.stringify([0, 0, 1]), 'Sem motivo: 1 banda larga');
  assert(mz.rows[mz.rows.length - 1].chave === 'Sem motivo informado', 'linha "Sem motivo" por último na matriz');
  assert(JSON.stringify(mz.totCols) === JSON.stringify([2, 2, 1]) && mz.total === 5 && !mz.temOutros, 'totais das colunas');
  // corte em N colunas + "Outros"
  const muitos = [];
  ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'].forEach((g, i) => { for(let j = 0; j <= 8 - i; j++) muitos.push(lp({ categoria: 'Duplicidade', grupo: g })); });
  const mz2 = w.perdMatriz(muitos, w.perdMotivo, w.perdGrupo, 6);
  assert(mz2.cols.length === 6 && mz2.temOutros && JSON.stringify(mz2.outrasCols) === JSON.stringify(['G7', 'G8']) && mz2.totOutros === 3 + 2, 'mais de 7 colunas: 6 maiores + "Outros" (G7, G8)');
  assert(mz2.rows[0].outros === 5 && mz2.rows[0].total === muitos.length, '"Outros" soma as colunas cortadas');
  const mz7 = w.perdMatriz(muitos.filter(l => l.grupo !== 'G8'), w.perdMotivo, w.perdGrupo, 6);
  assert(mz7.cols.length === 7 && !mz7.temOutros, 'com 7 colunas mostra todas (não cria "Outros" com uma só)');

  // evolução semanal: 01/10/2026 é quinta → semana 01–04/10 (parcial) e 05/10 (segunda)
  const sm = w.perdSemanas(out5, '2026-10-01', '2026-10-05');
  assert(sm.semanas.length === 2, 'Este mês em 05/10: 2 semanas — ' + sm.semanas.length);
  assert(sm.semanas[0].inicio === '2026-10-01' && sm.semanas[0].fim === '2026-10-04' && sm.semanas[1].inicio === '2026-10-05' && sm.semanas[1].fim === '2026-10-05', 'semanas de segunda a domingo, recortadas no período');
  assert(sm.semanas[0].total === 5 && sm.semanas[1].total === 0, 'P4 (05/10 01:30 UTC) conta em 04/10 — semana 1 tem os 5');
  assert(sm.series[sm.series.length - 1] === 'Sem motivo informado' && sm.top[0] === 'Restrição de Crédito', 'séries: top motivos e "Sem motivo informado" no fim');
  const sm180 = w.perdSemanas([], '2026-04-09', '2026-10-05');
  assert(sm180.semanas.length === 27 && sm180.series.length === 0, '180 dias: 27 semanas, sem séries quando não há perdas');
  const top6 = [];
  ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach((c, i) => { for(let j = 0; j < 7 - i; j++) top6.push(lp({ categoria: 'Motivo ' + c })); });
  const smTop = w.perdSemanas(top6, '2026-10-01', '2026-10-05');
  assert(smTop.top.length === 5 && smTop.series.indexOf('Outros motivos') === 5 && smTop.semanas[0].cont['Outros motivos'] === 3, 'top 5 motivos + "Outros motivos" (F e G somados)');

  // tempo até perder por motivo
  const tp = w.perdTempoPorMotivo(out5);
  const tr = nome => tp.find(x => x.motivo === nome);
  assert(tr('Restrição de Crédito').faixas.f1 === 1 && tr('Restrição de Crédito').faixas.f3 === 1 && tr('Restrição de Crédito').media === 7, 'Restrição: 1 em 0–1 dia, 1 em 8–15, média 7');
  assert(tr('Não responde').faixas.f5 === 1 && tr('Desconfiança').faixas.f1 === 1, 'Não responde 30+; Desconfiança 0–1');
  assert(!tr('Sem motivo informado'), 'pedido sem cadastro fica fora do gráfico de tempo');

  // preenchimento por consultor (pior primeiro)
  const pr = w.perdPreenchimento(out5);
  assert(JSON.stringify(pr.map(x => x.consultor)) === JSON.stringify(['MARIA TESTE', 'CAIO TESTE', MALICIOSO]), 'preenchimento: pior primeiro, empate por mais perdas — ' + JSON.stringify(pr.map(x => x.consultor)));
  assert(pr[0].perdas === 2 && pr[0].comMotivo === 1 && pr[0].nivel === 'medio' && pr[0].maiorMotivo === 'Não responde', 'MARIA: 1 de 2, selo médio, maior motivo Não responde');
  assert(pr[1].nivel === 'ok' && pr[1].maiorMotivo === 'Restrição de Crédito', 'CAIO: 100%, selo ok');
  assert(w.perdPreenchimento([lp({ categoria: null }), lp({ categoria: null }), lp({ categoria: 'X' })])[0].nivel === 'baixo', '1 de 3 = selo baixo');

  // cidades
  const cid = w.perdCidades(out5, 10);
  assert(cid[0].cidade === 'CIDADE ALFA' && cid[0].pedidos === 2 && cid[0].motivo === 'Restrição de Crédito', 'top cidade: ALFA, 2 perdas, motivo principal Restrição');
  assert(!cid.some(x => x.cidade === 'Sem cidade'), 'pedidos sem cidade não entram no ranking');

  // sync
  assert(w.perdSyncAtrasada(null, AGORA_PADRAO) === true, 'nunca sincronizou → aviso');
  assert(w.perdSyncAtrasada(new Date(AGORA_PADRAO - 2 * HORA).toISOString(), AGORA_PADRAO) === false, 'sync há 2 h → sem aviso');
  assert(w.perdSyncAtrasada(new Date(AGORA_PADRAO - 3 * HORA - 60000).toISOString(), AGORA_PADRAO) === true, 'sync há mais de 3 h → aviso');
}

// ---------------- tela ----------------
{
  // aba só com ADMIN_MODE, logo depois de Pedidos em Alerta
  const wc = montar({ adminMode: false, perdidas: FIXTURE });
  assert(!$(wc, '[data-tab="perdidas"]') && !$(wc, '#tabPerdidas'), 'consultor: sem botão e sem painel de Vendas Perdidas');
  const w = montar({ perdidas: FIXTURE });
  const abas = $$(w, '.tabs .tab-btn').map(b => b.dataset.tab);
  assert(abas.indexOf('perdidas') === abas.indexOf('alertas') + 1, 'aba Vendas Perdidas logo depois de Pedidos em Alerta — ' + abas.join(','));
  assert($(w, '[data-tab="perdidas"]').textContent.trim() === 'Vendas Perdidas', 'rótulo do botão');
  w.switchTab('perdidas');
  assert($(w, '#tabPerdidas').classList.contains('active') && w.document.body.classList.contains('tab-perdidas'), 'switchTab(perdidas) mostra o painel e esconde os filtros laterais (body.tab-perdidas)');
  assert(!w.document.body.classList.contains('tab-alertas'), 'não liga a classe de Pedidos em Alerta');
  w.switchTab('overview');
  assert(!w.document.body.classList.contains('tab-perdidas'), 'voltar para a Visão Geral tira a classe');

  // KPIs (Este mês por padrão)
  assert($(w, '#perdFiltroPeriodo').value === 'mes', 'período padrão: Este mês');
  assert(kpi(w, 'Vendas perdidas') === '5', 'KPI vendas perdidas = 5 — ' + kpi(w, 'Vendas perdidas'));
  assert(kpi(w, 'Valor perdido') === w.fmtBRL(460), 'KPI valor perdido = R$ 460,00 — ' + kpi(w, 'Valor perdido'));
  assert(kpi(w, 'Ticket médio perdido') === w.fmtBRL(92), 'KPI ticket médio');
  assert(kpi(w, 'Com motivo informado') === '80%', 'KPI % com motivo = 80% — ' + kpi(w, 'Com motivo informado'));
  assert(kpi(w, 'Maior motivo') === 'Restrição de Crédito', 'KPI maior motivo');
  assert(kpi(w, 'Tempo médio até perder') === '11,8 dias', 'KPI tempo médio = 11,8 dias — ' + kpi(w, 'Tempo médio até perder'));

  // gráfico de motivos
  const nomes = $$(w, '#perdMotivos .comp-row .comp-name').map(e => e.textContent);
  assert(JSON.stringify(nomes) === JSON.stringify(['Restrição de Crédito', 'Não responde', 'Desconfiança', 'Sem motivo informado']), 'barras de motivos na ordem — ' + JSON.stringify(nomes));
  assert(txt(w, '#perdMotivos .comp-row .comp-total').startsWith('2 · 40%'), 'barra mostra pedidos e % do total — ' + txt(w, '#perdMotivos .comp-row .comp-total'));
  assert($(w, '#perdMotivos .comp-row .comp-seg').style.width === '100%', 'maior motivo com barra cheia');

  // clique no motivo filtra tudo; de novo limpa
  $$(w, '#perdMotivos [data-perd-motivo]')[1].click();
  assert(w.eval('PERD_FILTRO.motivo') === 'Não responde', 'clique na barra liga o filtro de motivo');
  assert(JSON.stringify(pedidosTabela(w)) === JSON.stringify(['P3']), 'tabela só com o motivo clicado — ' + JSON.stringify(pedidosTabela(w)));
  assert(kpi(w, 'Vendas perdidas') === '1', 'KPIs respeitam o filtro');
  assert($$(w, '#perdMotivos .comp-row').length === 4 && $$(w, '#perdMotivos .comp-row.perd-sel').length === 1, 'o gráfico de motivos continua mostrando todos, com o escolhido destacado');
  assert($$(w, '#perdChips .perd-chip').length === 1 && txt(w, '#perdChips').includes('Não responde'), 'chip do filtro ativo');
  $$(w, '#perdMotivos [data-perd-motivo]')[1].click();
  assert(w.eval('PERD_FILTRO.motivo') === '' && pedidosTabela(w).length === 5, 'clicar de novo limpa o filtro');

  // matriz motivo × tipo: contagens e clique na célula
  const cab = $$(w, '#perdMatrizTipo thead th').map(th => th.textContent.trim());
  assert(JSON.stringify(cab) === JSON.stringify(['Motivo', 'VOZ - Novo', 'VOZ - Portabilidade', 'BANDA LARGA - Novo', 'Total']), 'cabeçalho da matriz — ' + JSON.stringify(cab));
  const linhaRestricao = $$(w, '#perdMatrizTipo tbody tr').find(tr => tr.children[0].textContent === 'Restrição de Crédito');
  assert([...linhaRestricao.children].map(td => td.textContent.trim()).join('|') === 'Restrição de Crédito|1|1|·|2', 'linha Restrição na matriz');
  linhaRestricao.children[1].click();
  assert(w.eval('PERD_FILTRO.motivo') === 'Restrição de Crédito' && w.eval('PERD_FILTRO.grupo') === 'VOZ - Novo', 'clique na célula filtra motivo + tipo de venda');
  assert(JSON.stringify(pedidosTabela(w)) === JSON.stringify(['P2']), 'tabela com motivo × tipo — ' + JSON.stringify(pedidosTabela(w)));
  assert($$(w, '#perdMatrizTipo td.perd-sel').length === 1, 'célula escolhida destacada');
  $$(w, '#perdMatrizTipo tbody tr').find(tr => tr.children[0].textContent === 'Restrição de Crédito').children[1].click();
  assert(w.eval('PERD_FILTRO.motivo') === '' && w.eval('PERD_FILTRO.grupo') === '', 'clicar de novo na mesma célula desliga os dois filtros');

  // matriz consultor × motivo
  const linhasCons = $$(w, '#perdMatrizConsultor tbody tr').map(tr => tr.children[0].textContent);
  assert(linhasCons[0] === 'CAIO TESTE' || linhasCons[0] === 'MARIA TESTE', 'matriz de consultores: mais perdas primeiro — ' + JSON.stringify(linhasCons));
  const maria = $$(w, '#perdMatrizConsultor tbody tr').find(tr => tr.children[0].textContent === 'MARIA TESTE');
  const colsCons = $$(w, '#perdMatrizConsultor thead th').map(th => th.textContent.trim());
  const iNR = colsCons.indexOf('Não responde');
  maria.children[iNR].click();
  assert(w.eval('PERD_FILTRO.consultor') === 'MARIA TESTE' && w.eval('PERD_FILTRO.motivo') === 'Não responde', 'clique na matriz de consultores filtra consultor + motivo');
  assert(JSON.stringify(pedidosTabela(w)) === JSON.stringify(['P3']), 'filtros combinados consultor + motivo → P3');
  w.limparFiltrosPerdidas();

  // filtros combinados pelos selects
  $(w, '#perdFiltroConsultor').value = 'MARIA TESTE';
  w.onFiltroPerdidas();
  assert(JSON.stringify(pedidosTabela(w).sort()) === JSON.stringify(['P3', 'P4']), 'filtro de consultor: P3 e P4');
  $(w, '#perdFiltroGrupo').value = 'BANDA LARGA - Novo';
  w.onFiltroPerdidas();
  assert(JSON.stringify(pedidosTabela(w)) === JSON.stringify(['P4']), 'consultor + tipo de venda → P4');
  assert(txt(w, '#perdMsg').includes('Consultor: MARIA TESTE') && txt(w, '#perdMsg').includes('Tipo de venda: BANDA LARGA - Novo'), 'mensagem mostra os filtros');
  w.limparFiltrosPerdidas();
  assert(pedidosTabela(w).length === 5 && $(w, '#perdFiltroConsultor').value === '', 'Limpar filtros volta tudo (mantém o período)');

  // tabela de pedidos: mais recente primeiro, dias até perder, sem motivo
  assert(JSON.stringify(pedidosTabela(w)) === JSON.stringify(['P4', 'P3', 'P2', 'P1', 'P5']), 'tabela pela data da perda, mais recente primeiro — ' + JSON.stringify(pedidosTabela(w)));
  const p4 = $$(w, '#perdBody tr')[0];
  assert(p4.children[2].textContent.trim() === '—' && p4.children[10].textContent.includes('Sem motivo informado') && p4.children[11].textContent.includes('#retorno'), 'P4: sem dias (sem cadastro), sem motivo, tag do pedido como fallback');
  const p3 = $$(w, '#perdBody tr')[1];
  assert(p3.children[2].textContent.trim() === '33' && p3.children[5].textContent === 'CIDADE BETA' && p3.children[6].textContent === 'VOZ - Portabilidade' && p3.children[7].textContent === 'Ativação', 'P3: dias, cidade, tipo de venda e solicitação');

  // evolução semanal e faixas na tela
  assert($$(w, '#perdSemanas .perd-sem-col').length === 2, 'evolução: 2 colunas (semanas) em Este mês');
  assert($$(w, '#perdSemanas .perd-sem-total')[0].textContent === '5', 'total da 1ª semana = 5');
  assert($$(w, '#perdSemanasLegenda span').length === 4, 'legenda: 3 motivos + Sem motivo');
  const tempoNomes = $$(w, '#perdTempo .comp-row .comp-name').map(e => e.textContent);
  assert(tempoNomes.length === 3 && !tempoNomes.includes('Sem motivo informado'), 'tempo até perder: 3 motivos (o sem cadastro fica fora) — ' + JSON.stringify(tempoNomes));
  assert(txt(w, '#perdTempoNota').includes('1 pedido sem data de cadastro'), 'nota do pedido sem cadastro');
  assert($$(w, '#perdTempoLegenda span').length === 5, 'legenda com as 5 faixas');
  const serieNR = $$(w, '#perdSemanas [data-perd-serie]').find(s => w.eval('PERD_UI.semanas.series')[+s.dataset.perdSerie] === 'Não responde');
  serieNR.click();
  assert(w.eval('PERD_FILTRO.motivo') === 'Não responde', 'clique no trecho da semana filtra o motivo');
  w.limparFiltrosPerdidas();

  // preenchimento e selos na tela
  const prLinhas = $$(w, '#perdPreenchimento tr');
  assert(prLinhas[0].children[0].textContent === 'MARIA TESTE' && prLinhas[0].querySelector('.perd-selo-medio') && prLinhas[0].children[3].textContent === '50%', 'preenchimento: MARIA primeiro, 50%, selo amarelo');
  assert(prLinhas[1].querySelector('.perd-selo-ok'), 'CAIO com selo verde');
  prLinhas[0].click();
  assert(w.eval('PERD_FILTRO.consultor') === 'MARIA TESTE' && pedidosTabela(w).length === 2, 'clique no consultor filtra');
  w.limparFiltrosPerdidas();
  assert(txt(w, '#perdCidades .comp-row .comp-name') === 'CIDADE ALFA', 'top cidades: ALFA primeiro');

  // período pela tela
  $(w, '#perdFiltroPeriodo').value = 'mespassado';
  w.onFiltroPerdidas();
  assert(JSON.stringify(pedidosTabela(w)) === JSON.stringify(['P8', 'P6']), 'Mês passado na tela: P8 (30/09 23h SP) e P6 — ' + JSON.stringify(pedidosTabela(w)));
  assert(txt(w, '#perdSub').includes('01/09/2026 a 30/09/2026'), 'subtítulo mostra o período');
  $(w, '#perdFiltroPeriodo').value = '180d';
  w.onFiltroPerdidas();
  assert(pedidosTabela(w).length === 8 && $$(w, '#perdSemanas .perd-sem-col').length === 27 && $(w, '#perdSemanas .perd-semanas.perd-denso'), '180 dias: 8 pedidos, 27 semanas, rótulos alternados');
  // consultor escolhido que não existe no novo período volta para Todos
  $(w, '#perdFiltroConsultor').value = 'MARIA TESTE';
  w.onFiltroPerdidas();
  $(w, '#perdFiltroPeriodo').value = 'mespassado';
  w.onFiltroPerdidas();
  assert(w.eval('PERD_FILTRO.consultor') === '' && pedidosTabela(w).length === 2, 'consultor sem perdas no novo período volta para "Todos"');

  // período Mês passado em janeiro, na tela
  const wj = montar({ perdidas: [lp({ numero_pedido: 'D1', categoria: 'Duplicidade', perdido_em: '2026-12-20T10:00:00-03:00' }), lp({ numero_pedido: 'J1', categoria: 'Duplicidade', perdido_em: '2027-01-03T10:00:00-03:00' })], agora: Date.parse('2027-01-10T12:00:00-03:00') });
  assert(JSON.stringify(pedidosTabela(wj)) === JSON.stringify(['J1']), 'janeiro, Este mês: só J1');
  $(wj, '#perdFiltroPeriodo').value = 'mespassado';
  wj.onFiltroPerdidas();
  assert(JSON.stringify(pedidosTabela(wj)) === JSON.stringify(['D1']), 'janeiro, Mês passado: dezembro do ano anterior (D1)');

  // Excel
  w.limparFiltrosPerdidas();
  $(w, '#perdFiltroPeriodo').value = 'mes';
  w.onFiltroPerdidas();
  w.exportarPerdidasExcel();
  assert(w.__arquivos.length === 1 && w.__arquivos[0].nome === 'VendasPerdidas_2026-10-01_2026-10-05.xlsx', 'Excel gerado com o período no nome — ' + (w.__arquivos[0] || {}).nome);
  const wb = w.__arquivos[0].wb;
  assert(JSON.stringify(wb.SheetNames) === JSON.stringify(['Resumo por motivo', 'Motivo x Tipo', 'Motivo x Consultor', 'Pedidos']), 'abas do Excel — ' + JSON.stringify(wb.SheetNames));
  const ped = XLSX.utils.sheet_to_json(wb.Sheets['Pedidos'], { header: 1 });
  assert(ped.length === 6 && ped[0][0] === 'Pedido' && ped[1][0] === 'P4', 'aba Pedidos: cabeçalho + 5 pedidos na ordem da tela');
  const res = XLSX.utils.sheet_to_json(wb.Sheets['Resumo por motivo'], { header: 1 });
  assert(res.some(r => r[0] === 'Restrição de Crédito' && r[1] === 2 && r[3] === 150), 'aba Resumo: Restrição com 2 pedidos e R$ 150');
  const mt = XLSX.utils.sheet_to_json(wb.Sheets['Motivo x Tipo'], { header: 1 });
  assert(mt[0][0] === 'Motivo' && mt[0].includes('VOZ - Novo') && mt[mt.length - 1][0] === 'TOTAL', 'aba Motivo x Tipo com cabeçalho e total');
  const mc = XLSX.utils.sheet_to_json(wb.Sheets['Motivo x Consultor'], { header: 1 });
  assert(mc[0].includes(MALICIOSO) && mc[0].includes('MARIA TESTE'), 'aba Motivo x Consultor: consultores nas colunas');
  // Excel respeita os filtros
  $(w, '#perdFiltroConsultor').value = 'CAIO TESTE';
  w.onFiltroPerdidas();
  w.exportarPerdidasExcel();
  assert(XLSX.utils.sheet_to_json(w.__arquivos[1].wb.Sheets['Pedidos'], { header: 1 }).length === 3, 'Excel com filtro de consultor: só os 2 pedidos dele');
  w.limparFiltrosPerdidas();

  // escape de HTML
  const painel = $(w, '#tabPerdidas');
  assert(painel.querySelectorAll('img').length === 0 && painel.querySelectorAll('script').length === 0 && painel.querySelectorAll('b').length === 0, 'nome/cliente/cidade maliciosos não viram elementos HTML');
  assert(w.__xss === undefined && !w.__alertou, 'nenhum script injetado rodou');
  assert(painel.textContent.includes(MALICIOSO) && painel.textContent.includes('<script>window.__xss=1</script>'), 'textos maliciosos aparecem literais');
  assert([...$(w, '#perdFiltroConsultor').options].some(o => o.value === MALICIOSO), 'select de consultor guarda o valor literal');
  const celMal = $$(w, '#perdMatrizConsultor tbody tr').find(tr => tr.children[0].textContent === MALICIOSO).querySelector('[data-perd-tip]');
  celMal.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
  assert($(w, '#appTooltip').classList.contains('show') && $(w, '#appTooltip').querySelectorAll('img').length === 0 && $(w, '#appTooltip').textContent.includes(MALICIOSO), 'tooltip mostra o nome malicioso como texto');
}

// ---------------- aviso de sync, erro, vazio, atualização ----------------
{
  const w1 = montar({ perdidas: FIXTURE, sync: new Date(AGORA_PADRAO - HORA).toISOString() });
  assert(txt(w1, '#perdAviso') === '', 'sync há 1 h: sem aviso');
  const w4 = montar({ perdidas: FIXTURE, sync: new Date(AGORA_PADRAO - 4 * HORA).toISOString() });
  assert(txt(w4, '#perdAviso').includes('não sincronizam desde 05/10/2026 11:00'), 'sync há 4 h: aviso com data/hora de SP — ' + txt(w4, '#perdAviso'));
  const wn = montar({ perdidas: FIXTURE, sync: null });
  assert(txt(wn, '#perdAviso').includes('nenhuma vez'), 'nunca sincronizou: aviso');

  const we = montar({ perdidas: null });
  assert(txt(we, '#perdAviso').includes('Não foi possível carregar'), 'erro na busca (null): aviso "não foi possível carregar"');
  assert(kpi(we, 'Vendas perdidas') === '0' && $(we, '#perdMotivos .perd-vazio') && pedidosTabela(we).length === 0, 'erro: tela vazia, sem quebrar');
  assert($(we, '#perdExportBtn').disabled, 'erro: botão do Excel desligado');

  const w0 = montar({ perdidas: [] });
  ['#perdMotivos', '#perdMatrizTipo', '#perdMatrizConsultor', '#perdSemanas', '#perdTempo', '#perdCidades'].forEach(id => {
    assert($(w0, id + ' .perd-vazio'), id + ' com 0 pedidos mostra mensagem de vazio');
  });
  assert(txt(w0, '#perdPreenchimento').includes('Nenhuma venda perdida'), 'preenchimento com 0 pedidos');
  assert(kpi(w0, 'Tempo médio até perder') === '—' && kpi(w0, 'Maior motivo') === '—' && kpi(w0, 'Com motivo informado') === '—', 'KPIs com 0 pedidos mostram —');
  assert(txt(w0, '#perdAviso') === '' , 'lista vazia sem erro não mostra "não foi possível carregar"');
  w0.exportarPerdidasExcel();
  assert(w0.__arquivos.length === 0, 'Excel não gera arquivo vazio');

  const ws = montar({ semPlaceholder: true });
  assert($(ws, '#tabPerdidas') && pedidosTabela(ws).length === 0 && !txt(ws, '#perdAviso').includes('Não foi possível'), 'placeholder não preenchido (painel antigo): lista vazia, sem erro');

  // atualização de 1 h vinda do painel
  w0.atualizarVendasPerdidas(FIXTURE, new Date(AGORA_PADRAO - 10 * 60000).toISOString());
  assert(kpi(w0, 'Vendas perdidas') === '5' && txt(w0, '#perdAviso') === '', 'atualizarVendasPerdidas troca os dados e a sync no lugar');
  we.atualizarVendasPerdidas(FIXTURE, null);
  assert(!txt(we, '#perdAviso').includes('Não foi possível') && txt(we, '#perdAviso').includes('nenhuma vez'), 'depois de uma carga boa, some o aviso de erro');
  we.atualizarVendasPerdidas(null, null);
  assert(kpi(we, 'Vendas perdidas') === '5', 'atualização sem lista (falha) mantém o que estava na tela');
}

// ---------------- painel: loadProducaoDashboard injeta os placeholders ----------------
assert(!/panel-vendasperdidas|tabBtnVendasPerdidas|function vpRender/.test(outerHtml), 'a aba antiga do menu lateral saiu do _template.html');
const buildPy = fs.readFileSync('build_painel.py', 'utf8');
assert(/RUNTIME_PLACEHOLDERS[\s\S]{0,300}"__PERDIDAS__"[\s\S]{0,80}"__PERDIDAS_SYNC__"/.test(buildPy), 'build_painel.py aceita __PERDIDAS__ e __PERDIDAS_SYNC__');

const outerNoScript = outerHtml.replace(/<script>[\s\S]*?<\/script>/g, '');
const outerScript = outerHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

function rodarPainel(role, opcoes){
  const dom = new JSDOM(outerNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true;
  w.__rpc = [];
  const o = opcoes || {};
  const thenable = res => ({ range: () => ({ then: (ok, er) => Promise.resolve(res).then(ok, er) }), then: (ok, er) => Promise.resolve(res).then(ok, er) });
  w.supabase = { createClient: comRange(() => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
    rpc: (nome, args) => {
      w.__rpc.push({ nome, args });
      if(nome === 'vendas_perdidas') return thenable(o.erroRpc ? { data: null, error: { message: 'boom' } } : { data: o.perdidas || [], error: null });
      return thenable({ data: [], error: null });
    },
    from: (tabela) => ({
      select: () => {
        const b = {
          eq: () => b, order: () => b, limit: () => b,
          maybeSingle: async () => tabela === 'exportacao_sync_log' ? { data: { terminou_em: '2026-10-05T17:41:00+00:00' }, error: null } : { data: { valor: '05/10/2026, 14:59:00' }, error: null },
          range: () => ({ then: (ok) => ok({ data: tabela === 'producao_pedidos' ? [{ numero_pedido: 'X1', grupo: 'VOZ - Novo', usuario: 'CAIO TESTE', etapa: 'ENTREGA (NEOCRM)', cadastro: '2026-10-01T10:00:00-03:00', atualizacao: '2026-10-01T10:00:00-03:00', valor: 1, quantidade: 1, produto: 'X', tag: null }] : [], error: null }) }),
          then: (ok) => ok({ data: [], error: null }),
        };
        return b;
      },
    }),
    functions: { invoke: async () => ({ data: {}, error: null }) },
  })) };
  return (async () => {
    await w.eval('(async () => {' + outerScript + '\n;currentUser = { id: "u1", nome: "Teste", username: "t", role: ' + JSON.stringify(role) + ' }; await loadProducaoDashboard(); })()');
    return w;
  })();
}

(async () => {
  try{
    const linhaMal = lp({ numero_pedido: 'Z1', usuario: '</script><script>window.__fura=1</script>', categoria: 'Duplicidade' });
    const wa = await rodarPainel('supervisor', { perdidas: [linhaMal] });
    const srcA = wa.document.getElementById('producaoFrame').srcdoc || '';
    const chamada = wa.__rpc.find(c => c.nome === 'vendas_perdidas');
    const hojeTeste = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const [hy, hm, hd] = hojeTeste.split('-').map(Number);
    const deTeste = new Date(Date.UTC(hy, hm - 1, hd - 180)).toISOString().slice(0, 10);
    assert(chamada && chamada.args.p_ate === hojeTeste && chamada.args.p_de === deTeste, 'supervisor: painel busca vendas_perdidas(hoje−180, hoje) — ' + JSON.stringify(chamada && chamada.args));
    assert(srcA.includes('PERDIDAS = [{') && srcA.includes('"numero_pedido":"Z1"'), 'supervisor: __PERDIDAS__ recebe as linhas da RPC');
    assert(srcA.includes('PERDIDAS_SYNC = "2026-10-05T17:41:00+00:00"'), 'supervisor: __PERDIDAS_SYNC__ recebe a última sync ok');
    assert(!srcA.includes('</script><script>window.__fura') && srcA.includes('\\u003c/script>'), 'texto com </script> é escapado (\\u003c) ao entrar no srcdoc');
    assert(!srcA.includes('__PERDIDAS__') && !srcA.includes('__PERDIDAS_SYNC__') && !srcA.includes('__DATA__'), 'nenhum placeholder sobra no srcdoc');

    const wc = await rodarPainel('consultor', { perdidas: [linhaMal] });
    const srcC = wc.document.getElementById('producaoFrame').srcdoc || '';
    assert(!wc.__rpc.some(c => c.nome === 'vendas_perdidas'), 'consultor: o painel nem chama a RPC vendas_perdidas');
    assert(srcC.includes('PERDIDAS = [];') && srcC.includes('PERDIDAS_SYNC = null;') && !srcC.includes('Z1'), 'consultor: recebe [] e null');

    const we = await rodarPainel('admin', { erroRpc: true });
    const srcE = we.document.getElementById('producaoFrame').srcdoc || '';
    assert(srcE.includes('PERDIDAS = null;'), 'erro na RPC: __PERDIDAS__ = null (a sub-aba mostra "não foi possível carregar")');
    assert(srcE.length > 1000 && srcE.includes('let DATA = [{'), 'erro na RPC não derruba o Dashboard');
  }catch(e){
    fail++; console.log('ERRO FATAL:', e && e.stack || e);
  }
  console.log('--- test_vendas_perdidas RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
})();
