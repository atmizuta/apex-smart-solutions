// test_dashboard_ranking.js (§164, 23/11/2026): sub-aba Ranking do Dashboard de Produção.
// Mesma técnica do test_visao_diaria.js: decodifica o template real embutido no _template.html, preenche os
// placeholders e roda o script de verdade num jsdom. Nomes fictícios (repo público).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const outerHtml = fs.readFileSync('_template.html', 'utf8');
const m = outerHtml.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/);
if(!m){ console.error('PRODUCAO_DASHBOARD_TPL_B64 nao encontrado'); process.exit(1); }
const tplRaw = Buffer.from(m[1], 'base64').toString('utf8');

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

const d = (dia) => dia + 'T00:00:00-03:00';
const ped = (o) => Object.assign({ numero_pedido: 'P' + Math.random().toString(36).slice(2, 8), etapa: 'CONCLUIDO (NEOCRM)',
  quantidade: 1, valor: 0, produto: '', cadastro: d('2026-11-10'), atualizacao: d('2026-11-10'), tag: '' }, o);
// hoje = segunda 23/11/2026
const FIXTURE = [
  // ANA: 3 linhas (10/11) + 2 hoje = 5 linhas, R$ 250; Monitor 5; aparelho caro (não conta em nada)
  ped({ usuario: 'ANA TESTE', grupo: 'VOZ - Novo', quantidade: 3, valor: 150, cadastro: d('2026-11-10') }),
  ped({ usuario: 'ANA TESTE', grupo: 'VOZ - Portabilidade', quantidade: 2, valor: 100, cadastro: d('2026-11-23') }),
  ped({ usuario: 'ANA TESTE', grupo: 'SVA MÓVEL', produto: 'CLARO MONITOR', quantidade: 5, valor: 25 }),
  ped({ usuario: 'ANA TESTE', grupo: 'APARELHO', quantidade: 1, valor: 9000 }),
  // etapas que não contam
  ped({ usuario: 'ANA TESTE', grupo: 'VOZ - Novo', quantidade: 10, valor: 500, etapa: 'VENDA PERDIDA (NEOCRM)' }),
  ped({ usuario: 'ANA TESTE', grupo: 'VOZ - Novo', quantidade: 10, valor: 500, etapa: 'DEVOLVIDO (NEOCRM)' }),
  ped({ usuario: 'ANA TESTE', grupo: 'VOZ - Novo', quantidade: 10, valor: 500, etapa: 'PROPOSTA (NEOCRM)' }),
  ped({ usuario: 'ANA TESTE', grupo: 'VOZ - Novo', quantidade: 10, valor: 500, etapa: 'AGUARDANDO INTERACAO (NEOCRM)' }),
  // BRUNO: 5 linhas R$ 300 (05/11); 1 fibra + 1 modem; 1 linha em outubro
  ped({ usuario: 'BRUNO TESTE', grupo: 'VOZ - Novo', quantidade: 5, valor: 300, cadastro: d('2026-11-05') }),
  ped({ usuario: 'BRUNO TESTE', grupo: 'BANDA LARGA - Novo', produto: 'ULTRA VELOCIDADE 600 MEGA', valor: 99.9, cadastro: d('2026-11-05') }),
  ped({ usuario: 'BRUNO TESTE', grupo: 'BANDA LARGA - Novo', produto: 'CLARO INTERNET MÓVEL 5G+ 200GB', valor: 100, cadastro: d('2026-11-05') }),
  ped({ usuario: 'BRUNO TESTE', grupo: 'VOZ - Novo', quantidade: 1, valor: 50, cadastro: d('2026-10-15') }),
  // CARLA: 5 linhas R$ 200 (12/11); digitais 3 (passaporte, TV, mesh)
  ped({ usuario: 'CARLA TESTE', grupo: 'VOZ - Renovação', quantidade: 5, valor: 200, cadastro: d('2026-11-12') }),
  ped({ usuario: 'CARLA TESTE', grupo: 'INCREMENTO DE MÓDULO', valor: 40 }),
  ped({ usuario: 'CARLA TESTE', grupo: 'NET - TV', valor: 80 }),
  ped({ usuario: 'CARLA TESTE', grupo: 'SVA FIXA', valor: 20 }),
  // fora do ranking
  ped({ usuario: 'ANDERSON TEIXEIRA MIZUTA', grupo: 'VOZ - Novo', quantidade: 50, valor: 5000 }),
  // Campinas
  ped({ usuario: 'DARIO TESTE', grupo: 'VOZ - Novo', quantidade: 20, valor: 1000, operacao: 'campinas' }),
  // dados ruins: sem cadastro, quantidade/valor nulos
  ped({ usuario: 'BRUNO TESTE', grupo: 'VOZ - Novo', cadastro: null, quantidade: 7 }),
  ped({ usuario: 'BRUNO TESTE', grupo: 'VOZ - Novo', quantidade: null, valor: null }),
].map(r => (r.operacao ? r : Object.assign(r, { operacao: 'apex' })));
const EQUIPE = [
  { nome: 'ANA TESTE', operacao: 'apex' }, { nome: 'BRUNO TESTE', operacao: 'apex' }, { nome: 'CARLA TESTE', operacao: 'apex' },
  { nome: 'EDU TESTE', operacao: 'apex' }, { nome: 'DARIO TESTE', operacao: 'campinas' }, { nome: 'ANDERSON TEIXEIRA MIZUTA', operacao: 'apex' },
];

const htmlNoScript = tplRaw.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsOriginal = tplRaw.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

// Monta um dashboard novo (operação da tela + contexto do ranking) e devolve o window.
function montar(operacao, ctx, admin){
  const html = htmlNoScript.replace('__ADMIN_MODE__', admin ? 'true' : 'false').replace('__ADMIN_BADGE__', '')
    .replace('__APEX_B64__', '').replace('__CLARO_B64__', '').replace('__UPDATED_AT__', 'teste');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true; w.console.error = () => {};
  let js = jsOriginal.replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(FIXTURE) + ';')
    .replace('__ADMIN_MODE__', admin ? 'true' : 'false')
    .replace('__OPERACAO__', JSON.stringify(operacao))
    .replace('__RANKING__', JSON.stringify(ctx));
  w.eval(js);
  return w;
}

// ---------- 1) estrutura ----------
assert(tplRaw.includes('data-tab="ranking"') && tplRaw.includes('>Ranking<'), 'botão da sub-aba Ranking existe');
assert(tplRaw.indexOf('data-tab="ranking"') > tplRaw.indexOf('data-tab="diaria"'), 'Ranking vem depois da Visão Diária');
assert(tplRaw.includes('id="tabRanking"'), 'painel #tabRanking existe');
assert(tplRaw.split('__RANKING__').length === 2, '__RANKING__ aparece uma vez só no template (o painel de fora troca a 1ª ocorrência)');

// ---------- 2) funções puras ----------
const w = montar('apex', { eu: 'CARLA TESTE', equipe: EQUIPE }, false);
assert(w.rankingCategoria('VOZ - Tranf. Titularidade') === 'linhas', 'VOZ = linhas');
assert(w.rankingCategoria('VOZ - TT + Renovação') === 'linhas', 'TT + Renovação = linhas');
assert(w.rankingCategoria('BANDA LARGA - Novo') === 'fibra', 'banda larga = fibra');
assert(w.rankingCategoria('SVA MÓVEL') === 'digitais' && w.rankingCategoria('SVA FIXA') === 'digitais'
  && w.rankingCategoria('INCREMENTO DE MÓDULO') === 'digitais' && w.rankingCategoria('NET - TV') === 'digitais', '4 grupos digitais');
assert(w.rankingCategoria('APARELHO') === null && w.rankingCategoria('') === null, 'aparelho e vazio: nenhum ranking');
assert(!w.rankingConta('VENDA PERDIDA (NEOCRM)') && !w.rankingConta('DEVOLVIDO (NEOCRM)') && !w.rankingConta('PROPOSTA (NEOCRM)')
  && !w.rankingConta('AGUARDANDO INTERACAO (NEOCRM)') && !w.rankingConta('Aguardando Interação'), 'etapas fora');
assert(w.rankingConta('BIOMETRIA (NEOCRM)') && w.rankingConta('CONCLUIDO (NEOCRM)') && w.rankingConta('ENTREGA (NEOCRM)'), 'etapas em andamento contam');

const pm = w.rankingPeriodo('mes', '2026-11-23', null);
assert(pm.inicio === '2026-11-01' && pm.fim === '2026-11-23', 'mês atual: 1º até hoje');
const po = w.rankingPeriodo('mes', '2026-11-23', '2026-10');
assert(po.inicio === '2026-10-01' && po.fim === '2026-10-31', 'mês anterior: mês inteiro');
assert(w.rankingPeriodo('semana', '2026-11-26', null).inicio === '2026-11-23', 'semana começa na segunda');
assert(w.rankingPeriodo('semana', '2026-11-29', null).inicio === '2026-11-23', 'domingo ainda é a semana da segunda anterior');
assert(w.rankingPeriodo('hoje', '2026-11-23', null).inicio === '2026-11-23', 'hoje = hoje');

const r = w.rankingCalcular(FIXTURE, { inicio: '2026-11-01', fim: '2026-11-23', operacao: 'apex', equipe: EQUIPE });
const nomes = l => l.map(x => x.nome + ':' + x.q).join(',');
assert(nomes(r.linhas) === 'BRUNO TESTE:5,ANA TESTE:5,CARLA TESTE:5,EDU TESTE:0', 'linhas: empate de 5 desempatado pela receita (300 > 250 > 200); Edu com 0 no fim; Anderson e Campinas fora — ' + nomes(r.linhas));
assert(Math.abs(r.linhas[1].r - 250) < 0.001, 'receita da Ana = só linhas (sem aparelho nem Monitor)');
assert(nomes(r.fibra).startsWith('BRUNO TESTE:2') && r.fibra[0].modem === 1, 'fibra soma fibra + modem e separa 1 modem');
assert(nomes(r.digitais).startsWith('ANA TESTE:5,CARLA TESTE:3'), 'digitais: Monitor 5; passaporte + TV + mesh = 3');
const rc = w.rankingCalcular(FIXTURE, { inicio: '2026-11-01', fim: '2026-11-23', operacao: 'campinas', equipe: EQUIPE });
assert(nomes(rc.linhas) === 'DARIO TESTE:20', 'Campinas só vê Campinas — ' + nomes(rc.linhas));
const rout = w.rankingCalcular(FIXTURE, { inicio: '2026-10-01', fim: '2026-10-31', operacao: 'apex', equipe: [] });
assert(nomes(rout.linhas) === 'BRUNO TESTE:1', 'outubro: só a linha de outubro');

const ontem = w.rankingCalcular(FIXTURE, { inicio: '2026-11-01', fim: '2026-11-22', operacao: 'apex', equipe: [] });
const pos = w.rankingPosicoes(ontem.linhas);
assert(pos.get('BRUNO TESTE') === 1 && pos.get('CARLA TESTE') === 2 && pos.get('ANA TESTE') === 3, 'ontem: Bruno, Carla, Ana');
assert(w.rankingSeta(2, 3) === 'sobe' && w.rankingSeta(3, 2) === 'cai' && w.rankingSeta(1, 1) === 'igual' && w.rankingSeta(4, undefined) === 'novo', 'setas');

const sp = w.rankingSuaPosicao(r.linhas, 'CARLA TESTE');
assert(sp.pos === 3 && sp.falta === 0 && sp.acima === 'ANA TESTE', 'Carla 3ª, empatada com a Ana');
assert(w.rankingSuaPosicao(r.linhas, 'BRUNO TESTE').lider === true, 'Bruno lidera');
assert(w.rankingSuaPosicao(r.linhas, 'EDU TESTE').pos === null, 'Edu ainda sem venda');
assert(w.rankingSuaPosicao(r.linhas, 'NINGUEM') === null, 'nome fora da operação: null');

// ---------- 3) render ----------
{
  const w1 = montar('apex', { eu: 'CARLA TESTE', equipe: EQUIPE }, false);
  w1.RK.hoje = '2026-11-23';
  w1.switchTab('ranking');
  w1.renderRanking();
  const doc = w1.document;
  const tab = doc.getElementById('tabRanking');
  assert(tab.classList.contains('active'), 'switchTab abre o painel do ranking');
  assert(doc.body.classList.contains('tab-ranking'), 'body ganha tab-ranking (esconde filtros da lateral)');
  const blocos = tab.querySelectorAll('.rk-bloco');
  assert(blocos.length === 1, 'consultor da Apex: 1 bloco');
  const cols = tab.querySelectorAll('.rk-card');
  assert(cols.length === 3, '3 rankings');
  assert(cols[0].querySelector('.rk-pd.p1 .rk-pd-nome').textContent.includes('Bruno'), '1º de Linhas = Bruno');
  assert(cols[0].querySelector('.rk-pd.p3').classList.contains('eu'), 'Carla (3ª) destacada no pódio');
  assert(tab.querySelector('.rk-voce') && tab.querySelector('.rk-voce').textContent.includes('Empatado com Ana'), 'faixa "sua posição" mostra o empate');
  assert(cols[0].querySelector('.rk-zeros').textContent.includes('Edu'), 'Edu em "Ainda sem venda"');
  assert(!tab.textContent.includes('Anderson') && !tab.textContent.includes('Dario'), 'Anderson e Campinas fora do ranking da Apex');
  assert(tab.querySelector('.rk-time').textContent.includes('15'), 'total do time: 15 linhas');
  // seta no mês atual: Ana subiu de 3º para 2º
  assert(cols[0].querySelector('.rk-pd.p2 .rk-seta.sobe'), 'Ana (2ª) com seta de subida');
  // Hoje: sem seta
  w1.RK.periodo = 'hoje'; w1.renderRanking();
  assert(!tab.querySelector('.rk-seta.sobe, .rk-seta.cai, .rk-seta.igual, .rk-seta.novo'), 'Hoje: sem seta');
  assert(tab.querySelector('.rk-card .rk-pd.p1 .rk-pd-nome').textContent.includes('Ana'), 'Hoje: só a Ana vendeu linha');
  // Mês anterior: mês fechado, sem seta
  w1.RK.periodo = 'mes'; w1.RK.mes = '2026-10'; w1.renderRanking();
  assert(doc.getElementById('rkPeriodoTxt').textContent.includes('mês fechado'), 'mês anterior: texto de mês fechado');
  assert(!tab.querySelector('.rk-seta.sobe, .rk-seta.cai, .rk-seta.igual, .rk-seta.novo'), 'mês anterior: sem seta');
  // clique nos botões de período
  w1.RK.mes = null;
  tab.querySelector('[data-rk-periodo="semana"]').dispatchEvent(new w1.Event('click', { bubbles: true }));
  assert(w1.RK.periodo === 'semana' && tab.querySelector('[data-rk-periodo="semana"]').classList.contains('active'), 'clique em Semana troca o período');
}
{
  // admin sem vínculo, Apex + Campinas: 2 blocos, sem faixa "sua posição"
  const w2 = montar('todas', { eu: null, equipe: EQUIPE }, true);
  w2.RK.hoje = '2026-11-23'; w2.renderRanking();
  const tab = w2.document.getElementById('tabRanking');
  const blocos = tab.querySelectorAll('.rk-bloco');
  assert(blocos.length === 2, 'Apex + Campinas: dois blocos');
  assert(blocos[0].textContent.includes('Operação Apex') && blocos[1].textContent.includes('Operação Campinas'), 'títulos das operações');
  assert(!blocos[0].textContent.includes('Dario') && blocos[1].textContent.includes('Dario'), 'Dario só no bloco de Campinas');
  assert(!tab.querySelector('.rk-voce'), 'sem vínculo: sem faixa "sua posição"');
}
{
  // consultor de Campinas
  const w3 = montar('campinas', { eu: 'DARIO TESTE', equipe: EQUIPE }, false);
  w3.RK.hoje = '2026-11-23'; w3.renderRanking();
  const tab = w3.document.getElementById('tabRanking');
  assert(tab.querySelectorAll('.rk-bloco').length === 1 && !tab.textContent.includes('Bruno'), 'Campinas não vê a Apex');
  assert(tab.querySelector('.rk-voce').textContent.includes('lidera'), 'Dario lidera em Campinas');
}
{
  // nome com HTML é escapado; erro no cálculo mostra aviso
  const w4 = montar('apex', { eu: null, equipe: [{ nome: '<B>X</B>', operacao: 'apex' }] }, false);
  w4.RK.hoje = '2026-11-23'; w4.renderRanking();
  assert(![...w4.document.querySelectorAll('#tabRanking b')].some(b => b.textContent.toLowerCase() === 'x') && w4.document.getElementById('tabRanking').innerHTML.includes('&lt;'), 'nome com HTML aparece escapado');
  w4.rankingCalcular = () => { throw new Error('boom'); };
  w4.renderRankingSeguro();
  assert(w4.document.getElementById('rkConteudo').textContent.includes('Não deu para montar o ranking'), 'erro vira aviso na aba');
}


// ---------- 4) revisão final ----------
assert(w.rankingCategoria('NET - VIRTUA') === 'fibra', 'NET - VIRTUA (internet fixa) conta na Fibra, como na §101');
{
  const w1 = montar('apex', { eu: 'CARLA TESTE', equipe: EQUIPE }, false);
  w1.RK.hoje = '2026-11-23';
  const conteudo = () => w1.document.getElementById('rkConteudo').innerHTML;
  assert(conteudo() === '', 'aba fechada: o ranking não é montado na carga (desempenho)');
  w1.atualizarDadosDashboard(JSON.parse(JSON.stringify(FIXTURE)), 'teste');
  assert(conteudo() === '', 'aba fechada: a sincronização não monta o ranking');
  w1.switchTab('ranking');
  assert(conteudo().includes('rk-card'), 'abrir a aba monta o ranking');
  assert(w1.document.querySelector('.rk-voce').textContent.includes('Faltam 3 soluções para passar Ana'), 'digitais: Carla 3 × Ana 5 → faltam 3 para passar (2 só empatam)');
}

console.log(`--- RESULTADO: ${ok} passaram, ${fail} falharam ---`);
if(fail) process.exitCode = 1;
