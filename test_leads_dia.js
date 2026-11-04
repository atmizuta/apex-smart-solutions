// Testa o §135 (Equipe: placar do dia e relatório do consultor). DADOS FICTÍCIOS (repo público).
// Spec: docs/superpowers/specs/2026-10-28-meus-leads-redesign-design.md. DADOS FICTÍCIOS (repo público).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

const html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];
const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.__rpcCalls = [];
window.__rpcRespostas = {};
window.__tabelas = {};
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b, eq: () => b,
    upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.__alertas = [];
window.alert = (m) => window.__alertas.push(String(m));
window.confirm = () => true;
window.Chart = function(){ this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process;

const testScript = `

(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const SP = (s) => Date.parse(s + '-03:00');
  const dnReal = Date.now, ag = SP('2026-11-03T18:00:00');   // terça 18:00
  Date.now = () => ag;
  // ==== Task 3: funções puras ====
  eq([kbFmtMin(null), kbFmtMin(6), kbFmtMin(13.4), kbFmtMin(72), kbFmtMin(0)], ['—', '6 min', '13 min', '1 h 12 min', '0 min'], 'formata minutos');
  eq([kbHoraSP('2026-11-03T16:04:00Z'), kbHoraSP(null)], ['13:04', ''], 'hora de SP');
  eq(kbDiaBR('2026-11-03'), '03/11', 'dia dd/mm');
  eq(kbSetaMedia(5, 3, true), { txt: '▲', cls: 'melhor' }, 'acima da média, maior é melhor');
  eq(kbSetaMedia(5, 3, false), { txt: '▲', cls: 'pior' }, 'acima da média, menor é melhor');
  eq(kbSetaMedia(2, 3, true), { txt: '▼', cls: 'pior' }, 'abaixo da média');
  eq(kbSetaMedia(3, 3, true), { txt: '', cls: '' }, 'igual à média');
  eq(kbSetaMedia(3, null, true), { txt: '', cls: '' }, 'sem média');
  assert(kbAvisoDiaHtml('2026-11-03', '2026-11-03').includes('até 1 h atrasadas'), 'aviso de hoje');
  assert(kbAvisoDiaHtml('2026-10-20', '2026-11-03').includes('a partir de 27/10/2026'), 'aviso antes do histórico');
  eq(kbAvisoDiaHtml('2026-10-30', '2026-11-03'), '', 'dia passado depois do histórico: sem aviso');
  const L1 = { dono_id: 'u1', nome: 'Zz Lucas', tem_telefonia: true, pegos: 8, recebidos: 3, perdidos: 1, ligacoes: 70, atendidas: 21, min_falados: 95, whatsapp: 4,
    primeiro_contato_mediana_min: 6, sem_ligar: 2, classificados: 12, obs: 9, retornos_feitos: 3, retornos_atrasados: 1, vendas: 2, receita: 180.5,
    jornada_inicio: '2026-11-03T16:04:00Z', jornada_fim: '2026-11-03T23:51:00Z', posicao: 1 };
  const L2 = { dono_id: 'u2', nome: 'Zz Luria', tem_telefonia: false, pegos: 0, recebidos: 0, perdidos: 0, ligacoes: 0, atendidas: 0, min_falados: 0, whatsapp: 0,
    primeiro_contato_mediana_min: null, sem_ligar: 0, classificados: 0, obs: 0, retornos_feitos: 0, retornos_atrasados: 0, vendas: 0, receita: 0,
    jornada_inicio: null, jornada_fim: null, posicao: 2 };
  const TD = document.createElement('div'); TD.innerHTML = kbTabelaDiaHtml([L1, L2]);
  const tr1 = TD.querySelector('tr[data-kb-relatorio="u1"]');
  assert(tr1 && tr1.querySelector('button.kbLink[data-kb-relatorio="u1"]').textContent.includes('Zz Lucas'), 'linha com o nome clicável');
  const cel = [...tr1.querySelectorAll('td')].map(t => t.textContent.replace(/\\s+/g, ' ').trim());
  eq(cel, ['1º', 'Zz Lucas', '8 + 3', '70 / 21 atend. 4 WhatsApp', '95', '6 min', '2', '12 / 9', '3 / 1', '2', 'R$ 180,50', '13:04–20:51'], 'colunas do dia');
  assert(tr1.querySelector('.kbEqNum.ruim'), 'sem ligar > 0 em vermelho');
  const cel2 = [...TD.querySelectorAll('tr[data-kb-relatorio="u2"] td')].map(t => t.textContent.replace(/\\s+/g, ' ').trim());
  eq([cel2[2], cel2[3], cel2[5], cel2[10], cel2[11]], ['0', '—', '—', 'R$ 0,00', '—'], 'sem telefonia e sem atividade: traços e zeros');
  eq(TD.querySelectorAll('thead th').length, 12, '12 colunas');
  const R = { dia: '2026-11-03', historico_desde: '2026-10-27', numeros: L1,
    media_equipe: { pegos: 6, ligacoes: 50, atendidas: 15, min_falados: 60, whatsapp: 2, sem_ligar: 1, classificados: 10, obs: 7, retornos_feitos: 2, retornos_atrasados: 2, vendas: 1, receita: 90, primeiro_contato_mediana_min: 9 },
    por_hora: [13, 14, 15, 16, 17, 18, 19, 20].map((h, i) => ({ h, ligacoes: i === 0 ? 10 : 5, atendidas: i === 0 ? 4 : 1 })),
    parados: [{ de: '2026-11-03T18:10:00Z', ate: '2026-11-03T19:02:00Z', min: 52 }],
    leads: [{ aba: 'NOVEMBRO', lead_id: 'l:1', nome: 'Zz Lead A', como: 'pegou', de_nome: null, em: '2026-11-03T16:05:00Z', primeiro_contato_min: 6, ligacoes: 2, status: 'FECHADO', vendeu: true, receita: 100 },
            { aba: 'NOVEMBRO', lead_id: 'l:2', nome: 'Zz Lead B', como: 'recebeu', de_nome: 'Zz Caio', em: '2026-11-03T17:00:00Z', primeiro_contato_min: null, ligacoes: 0, status: null, vendeu: false, receita: null }],
    perdidos: [{ aba: 'NOVEMBRO', lead_id: 'l:3', nome: 'Zz Lead C', em: '2026-11-03T19:00:00Z', para_nome: 'ZZCAIO' }],
    pendencias: { retornos_atrasados: [{ aba: 'NOVEMBRO', lead_id: 'l:4', nome: 'Zz Lead D', quando: '2026-11-03T17:00:00Z' }], sem_contato: [] } };
  const RD = document.createElement('div'); RD.innerHTML = kbRelatorioHtml({ dados: R, erro: false, carregando: false }, 'Zz Lucas');
  assert(RD.querySelector('.kbRel h3').textContent.includes('Zz Lucas · dia 03/11') && RD.querySelector('[data-kb-relatorio-fechar]'), 'título e Fechar');
  const cv = RD.querySelector('[data-kb-rel-cartao="vendas"]');
  assert(cv && cv.textContent.includes('2') && cv.textContent.includes('equipe 1') && cv.querySelector('.kbRelSeta.melhor').textContent === '▲', 'cartão de vendas com média e seta');
  assert(RD.querySelector('[data-kb-rel-cartao="primeiro_contato"] .kbRelSeta.melhor').textContent === '▼', '1ª ligação abaixo da média é melhor');
  eq(RD.querySelectorAll('.kbRelHora').length, 8, '8 barras de hora');
  assert(RD.querySelector('.kbRelParados').textContent.includes('15:10–16:02 (52 min)'), 'parado com horário e duração');
  const RDtxt = RD.textContent.replace(/\\s+/g, ' ');   // kbMoeda usa espaço inquebrável depois do R$
  assert(RD.querySelector('[data-kb-abrir="NOVEMBRO|l:1"]') && RDtxt.includes('venda R$ 100,00') && RD.textContent.includes('recebeu de Zz Caio') && RD.textContent.includes('sem contato'), 'leads do dia');
  assert(RD.querySelector('.kbRelPerdidos').textContent.includes('ZZCAIO') && RD.querySelector('.kbRelPendencias [data-kb-abrir="NOVEMBRO|l:4"]'), 'perdidos e pendências');
  const vazio = document.createElement('div'); vazio.innerHTML = kbRelatorioHtml({ dados: Object.assign({}, R, { numeros: null, leads: [], perdidos: [], parados: [] }), erro: false, carregando: false }, 'Zz Luria');
  assert(vazio.textContent.includes('Sem atividade registrada neste dia') && vazio.querySelector('[data-kb-relatorio-fechar]'), 'sem atividade (numeros nulo) não quebra');
  const er = document.createElement('div'); er.innerHTML = kbRelatorioHtml({ dados: null, erro: true, carregando: false }, 'Zz Lucas');
  assert(er.textContent.includes('Não foi possível carregar o relatório') && er.querySelector('[data-kb-relatorio-fechar]'), 'erro no relatório com Fechar');
  const ca = document.createElement('div'); ca.innerHTML = kbRelatorioHtml({ dados: null, erro: false, carregando: true }, 'Zz Lucas');
  assert(ca.textContent.includes('Carregando'), 'carregando');
  // ==== Task 4: Equipe com Dia/Mês e relatório ====
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u1', nome_planilha: 'ZZLUCAS', pode_pegar: true }, { id: 2, profile_id: 'u2', nome_planilha: 'ZZLURIA', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }];
  window.__rpcRespostas.leads_kanban3 = { data: [{ aba: 'O', lead_id: 's1', nome: 'Zz Sem Um', dono_id: 'u1', dono_nome: 'Zz Lucas', categoria: 'sem_contato', livre: false, pego_em: new Date(ag - 6e6).toISOString() }], error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_atividade_equipe2 = { data: [
    { dono_id: 'u1', nome: 'Zz Lucas', tem_telefonia: true, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0, lig_por_hora: [0,0,0,0,0,0,0,0], meta_dia: 80, pode_pegar: true },
    { dono_id: 'u2', nome: 'Zz Luria', tem_telefonia: false, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0, lig_por_hora: [0,0,0,0,0,0,0,0], meta_dia: 80, pode_pegar: true }], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_dia_equipe = (a) => ({ data: [Object.assign({}, L1, { dia: a.p_dia }), L2], error: null });
  window.__rpcRespostas.leads_dia_consultor = (a) => ({ data: Object.assign({}, R, { dia: a.p_dia }), error: null });
  try { window.localStorage.removeItem('kbEqModo'); } catch(_e) {}
  await kbAplicarPermissao();
  kbEstado.aba = null; await kbCarregar(); await espera(120);
  const EQ = document.getElementById('kbEquipe');
  assert(kbEstado.aba === 'equipe' && kbEstado.equipeModo === 'mes' && EQ.querySelector('tr[data-kb-dono="u1"]'), 'abre no Mês, tabela de sempre');
  assert(EQ.querySelector('[data-kb-eq-modo="dia"]') && EQ.querySelector('[data-kb-eq-modo="mes"].active') && !EQ.querySelector('#kbEqDia'), 'seletor Dia/Mês, sem data no Mês');
  EQ.querySelector('[data-kb-eq-modo="dia"]').click(); await espera(60);
  const cDia = window.__rpcCalls.filter(c => c.nome === 'leads_dia_equipe').pop();
  assert(kbEstado.equipeModo === 'dia' && cDia && cDia.args.p_dia === '2026-11-03', 'Dia chama leads_dia_equipe com hoje');
  assert(EQ.querySelector('#kbEqDia').value === '2026-11-03' && EQ.querySelector('#kbEqDia').max === '2026-11-03', 'campo de data com hoje e sem futuro');
  assert(EQ.querySelector('tr[data-kb-relatorio="u1"] .kbDiaPos').textContent === '1º' && !EQ.querySelector('tr[data-kb-dono]'), 'tabela do dia no lugar da do mês');
  assert(EQ.textContent.includes('até 1 h atrasadas'), 'aviso de hoje');
  let lsModo = null; try { lsModo = window.localStorage.getItem('kbEqModo'); } catch(_e) {}
  assert(lsModo === null || lsModo === 'dia', 'lembra o modo (quando o navegador deixa)');
  // relatório
  EQ.querySelector('button[data-kb-relatorio="u1"]').click(); await espera(60);
  const cRel = window.__rpcCalls.filter(c => c.nome === 'leads_dia_consultor').pop();
  assert(cRel && cRel.args.p_dono === 'u1' && cRel.args.p_dia === '2026-11-03' && EQ.querySelector('.kbRel h3').textContent.includes('Zz Lucas · dia 03/11'), 'clicar no nome abre o relatório do dia');
  EQ.querySelector('[data-kb-relatorio-fechar]').click();
  assert(!EQ.querySelector('.kbRel') && !kbEstado.relatorio, 'Fechar');
  // corrida: dois cliques rápidos, a resposta do primeiro chega depois
  let soltaU1;
  window.__rpcRespostas.leads_dia_consultor = (a) => a.p_dono === 'u1'
    ? new Promise(res => { soltaU1 = () => res({ data: Object.assign({}, R, { dia: a.p_dia }), error: null }); })
    : { data: Object.assign({}, R, { dia: a.p_dia, numeros: Object.assign({}, L2, { pegos: 1, jornada_inicio: '2026-11-03T16:00:00Z', jornada_fim: '2026-11-03T17:00:00Z' }) }), error: null };
  const p1 = kbAbrirRelatorio('u1'); await espera(10);
  await kbAbrirRelatorio('u2'); soltaU1(); await p1; await espera(20);
  assert(kbEstado.relatorio && kbEstado.relatorio.dono === 'u2' && EQ.querySelector('.kbRel h3').textContent.includes('Zz Luria'), 'dois cliques rápidos: fica o último');
  window.__rpcRespostas.leads_dia_consultor = (a) => ({ data: Object.assign({}, R, { dia: a.p_dia }), error: null });
  // trocar a data (inclusive futura ou vazia) e o relatório acompanha
  const inp = EQ.querySelector('#kbEqDia'); inp.value = '2026-10-20'; inp.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(60);
  assert(kbEstado.equipeDia === '2026-10-20' && window.__rpcCalls.filter(c => c.nome === 'leads_dia_equipe').pop().args.p_dia === '2026-10-20'
    && window.__rpcCalls.filter(c => c.nome === 'leads_dia_consultor').pop().args.p_dia === '2026-10-20' && EQ.textContent.includes('a partir de 27/10/2026'), 'trocar a data recarrega placar e relatório; aviso antes do histórico');
  const nAntes = window.__rpcCalls.length;
  const inp2 = EQ.querySelector('#kbEqDia'); inp2.value = '2026-12-01'; inp2.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(60);
  assert(kbEstado.equipeDia === '2026-11-03' && !window.__rpcCalls.slice(nAntes).some(c => c.args && c.args.p_dia === '2026-12-01'), 'data no futuro volta para hoje sem chamar o banco com ela');
  const inp3 = EQ.querySelector('#kbEqDia'); inp3.value = ''; inp3.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(60);
  assert(kbEstado.equipeDia === '2026-11-03', 'data vazia volta para hoje');
  // dia passado não pula para hoje com o timer da Equipe
  const inp4 = EQ.querySelector('#kbEqDia'); inp4.value = '2026-10-30'; inp4.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(60);
  await kbCarregarEquipe(); await espera(30);
  assert(kbEstado.equipeDia === '2026-10-30' && window.__rpcCalls.filter(c => c.nome === 'leads_dia_equipe').pop().args.p_dia === '2026-10-30', 'atualização da Equipe mantém o dia escolhido');
  // lista e relatório não aparecem juntos
  kbEstado.relatorio = null; await kbAbrirRelatorio('u1'); await espera(20);
  kbEquipeModo('mes'); await espera(30);
  assert(!kbEstado.relatorio && EQ.querySelector('tr[data-kb-dono="u1"]'), 'voltar ao Mês fecha o relatório e mostra a tabela de sempre');
  EQ.querySelector('[data-kb-eq="u1|sem_contato"]').click();
  assert(kbEstado.equipeLista && !kbEstado.relatorio && EQ.querySelector('.kbEqLista'), 'número da linha (Mês) abre a lista, como antes');
  const pegaAntes = window.__rpcCalls.length;
  EQ.querySelector('[data-kb-pode-pegar="u1"]').click(); await espera(30);
  assert(window.__rpcCalls.slice(pegaAntes).some(c => c.nome === 'leads_definir_pode_pegar') && !kbEstado.relatorio, 'chave Pega leads não abre relatório');
  // erro e função ausente
  window.__rpcRespostas.leads_dia_equipe = { data: null, error: { code: '500', message: 'falhou' } };
  window.__avisos = []; const mAv = mostrarAviso; mostrarAviso = (m, t) => window.__avisos.push(t + ':' + m);
  await kbEquipeModo('dia'); await espera(30);
  assert(window.__avisos.some(a => a.includes('Não foi possível carregar o dia agora.')) && EQ.querySelector('tr[data-kb-dono="u1"]') && EQ.querySelector('[data-kb-eq-modo]'), 'erro na carga do dia: aviso e a tabela do Mês continua');
  window.__rpcRespostas.leads_dia_equipe = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.leads_dia_equipe' } };
  await kbEquipeModo('dia'); await espera(30);
  assert(kbEstado.diaDisponivel === false && kbEstado.equipeModo === 'mes' && !EQ.querySelector('[data-kb-eq-modo]') && EQ.querySelector('tr[data-kb-dono="u1"]'), 'sem a função no banco: some o seletor e a Equipe fica como antes');
  mostrarAviso = mAv;
  // ==== mais testes entram aqui ====

  Date.now = dnReal;
  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
