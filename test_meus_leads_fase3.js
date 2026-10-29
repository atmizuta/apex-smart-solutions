// Testa o §126.3 (redesign de Meus leads, Fase 3: Equipe).
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
  // ==== Task 2: funções puras ====
  eq([kbDuracaoMin(5), kbDuracaoMin(38), kbDuracaoMin(60), kbDuracaoMin(72), kbDuracaoMin(null)], ['5 min', '38 min', '1 h', '1 h 12 min', ''], 'duração em minutos');
  const ag = SP('2026-10-28T15:00:00');   // quarta
  const at = (o) => Object.assign({ dono_id: 'u1', nome: 'Zz Um', tem_telefonia: true, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0 }, o);
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T14:56:00-03:00' }), ag), { cor: 'verde', texto: 'ligou há 4 min' }, 'verde: ligou há pouco');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T14:00:00-03:00', ultima_obs: '2026-10-28T14:51:00-03:00' }), ag), { cor: 'verde', texto: 'OBS há 9 min' }, 'verde: a ação mais recente é a OBS');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T14:22:00-03:00' }), ag), { cor: 'amarelo', texto: 'parado 38 min' }, 'amarelo: parado 38 min');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T13:48:00-03:00' }), ag), { cor: 'vermelho', texto: 'parado 1 h 12 min' }, 'vermelho: parado 1 h 12 min');
  eq(kbAgoraEquipe(at({ tem_telefonia: false, ultima_obs: '2026-10-28T14:55:00-03:00' }), ag), { cor: 'verde', texto: 'OBS há 5 min' }, 'sem telefonia, com OBS recente: vale a OBS');
  eq(kbAgoraEquipe(at({ tem_telefonia: false }), ag), { cor: 'cinza', texto: 'sem telefonia' }, 'RF4: sem telefonia e sem OBS hoje');
  eq(kbAgoraEquipe(at({ tem_telefonia: false, ultima_obs: '2026-10-27T20:00:00-03:00' }), ag), { cor: 'cinza', texto: 'sem telefonia' }, 'RF4: OBS de ontem não conta');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-27T20:50:00-03:00' }), SP('2026-10-28T13:10:00')), { cor: 'verde', texto: 'nenhuma ação ainda' }, 'RF4: 13:10 sem nada hoje (a ligação de ontem não conta)');
  eq(kbAgoraEquipe(at({}), SP('2026-10-31T15:00:00')), { cor: 'cinza', texto: 'fora do expediente' }, 'RF4: sábado');
  eq(kbAgoraEquipe(at({}), SP('2026-10-28T12:30:00')).cor, 'cinza', 'RF4: antes das 13h');
  eq([0, 1, 4, 5, 9, 10, 14, 15, 40].map(kbNivelHora), [0, 1, 1, 2, 2, 3, 3, 4, 4], 'nível da hora no mapa');
  eq([kbHoraAtualIdx(SP('2026-10-28T12:59:00')), kbHoraAtualIdx(SP('2026-10-28T13:00:00')), kbHoraAtualIdx(ag), kbHoraAtualIdx(SP('2026-10-28T20:59:00')), kbHoraAtualIdx(SP('2026-10-28T21:30:00'))], [-1, 0, 2, 7, 8], 'hora atual no mapa (13h = 0)');
  eq([kbCorBarraLig(5, 80, ag), kbCorBarraLig(30, 80, ag), kbCorBarraLig(10, 80, ag), kbCorBarraLig(0, 80, SP('2026-10-28T12:00:00')), kbCorBarraLig(0, 80, SP('2026-10-31T15:00:00')), kbCorBarraLig(5, 0, ag)],
     ['red', 'green', '', '', '', ''], 'RF4: barra vermelha < 30% da meta proporcional, verde > 70%, neutra antes das 13h, no fim de semana e sem meta');
  const cont = { u1: { sem_contato: 4, andamento: 11, parados3: 3, retornos_atrasados: 2, convertidos: 3, receita: 300, pegos_mes: 30 }, u2: { sem_contato: 0, andamento: 5, parados3: 0, retornos_atrasados: 0, convertidos: 1, receita: 50.5, pegos_mes: 8 } };
  const ativ = [at({ dono_id: 'u1', nome: 'Zz Lucas', ultima_ligacao: '2026-10-28T13:48:00-03:00', lig_hoje: 19, meta_dia: 80 }), at({ dono_id: 'u2', nome: 'Zz Luria', ultima_ligacao: '2026-10-28T14:55:00-03:00', lig_hoje: 57, meta_dia: 80 }), at({ dono_id: 'u3', nome: 'Zz Vitoria', tem_telefonia: false })];
  eq(kbFaixasAtencao(ativ, cont, ag), [{ dono_id: 'u1', nome: 'Zz Lucas', min: 72, sem_contato: 4 }], 'faixa de atenção: só quem está vermelho (sem telefonia sem OBS não entra)');
  const LE = [{ livre: true, criado_em_lead: '2026-10-28T14:35:00-03:00' }, { livre: true, criado_em_lead: '2026-10-28T14:50:00-03:00' }, { livre: false, dono_id: 'u1' }];
  eq(kbKpisEquipe(ativ, LE, cont, ag), { lig: 76, meta: 160, livres: 2, livreAntigo: '2026-10-28T14:35:00-03:00', semContato: 4, retornosAtras: 2, vendas: 4, receita: 350.5 }, 'números do topo: meta × consultores com telefonia');
  const pes = [{ id: 'a', nome: 'Zz Caio' }, { id: 'b', nome: 'Zz Ana' }, { id: 'c', nome: 'Zz Bia' }];
  eq(kbMenosCarga(pes, { a: 5, b: 9, c: 5 }), 'c', 'menos carga; empate pelo nome (Zz Bia antes de Zz Caio)');
  eq(kbMenosCarga(pes, {}), 'b', 'sem carga conhecida: o primeiro em ordem alfabética');
  eq(kbMenosCarga([], {}), null, 'ninguém');
  eq(kbDividirIgual(['k1', 'k2', 'k3', 'k4'], pes, { a: 1, b: 0, c: 3 }).map(x => x.para), ['b', 'b', 'a', 'b'], 'dividir igual: cada lead vai para quem está com menos (somando o que já recebeu; empate pelo nome)');
  eq(kbDividirIgual(['k1'], [], {}), [], 'dividir sem ninguém: nada');
  // ==== Task 3: tela da Equipe (relógio fixo: quarta 15:00) ====
  const dnReal = Date.now, agE = SP('2026-10-28T15:00:00');
  Date.now = () => agE;
  const isoE = (min) => new Date(agE + min * 60000).toISOString();
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u1', nome_planilha: 'ZZLUCAS', pode_pegar: true }, { id: 2, profile_id: 'u2', nome_planilha: 'ZZLURIA', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }];
  const LQ = [
    { aba: 'O', lead_id: 's1', nome: 'Zz Sem Um', dono_id: 'u1', dono_nome: 'Zz Lucas', categoria: 'sem_contato', livre: false, pego_em: isoE(-100) },
    { aba: 'O', lead_id: 's2', nome: 'Zz Sem Dois', dono_id: 'u1', dono_nome: 'Zz Lucas', categoria: 'sem_contato', livre: false, pego_em: isoE(-90) },
    { aba: 'O', lead_id: 'a1', nome: 'Zz Andando', dono_id: 'u1', dono_nome: 'Zz Lucas', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, ligacoes: 1, ultima_ligacao: isoE(-60), pego_em: isoE(-600) },
    { aba: 'O', lead_id: 'a2', nome: 'Zz Andando Dois', dono_id: 'u2', dono_nome: 'Zz Luria', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, ligacoes: 1, ultima_ligacao: isoE(-30), pego_em: isoE(-600) },
    { aba: 'O', lead_id: 'lv', nome: 'Zz Livre', categoria: 'sem_contato', livre: true, criado_em_lead: isoE(-25) },
  ];
  const ATV = [
    { dono_id: 'u1', nome: 'Zz Lucas', tem_telefonia: true, ultima_ligacao: isoE(-75), lig_hoje: 19, ultima_obs: null, obs_hoje: 0, lig_por_hora: [6, 3, 0, 0, 0, 0, 0, 0], meta_dia: 80, pode_pegar: true },
    { dono_id: 'u2', nome: 'Zz Luria', tem_telefonia: true, ultima_ligacao: isoE(-3), lig_hoje: 57, ultima_obs: isoE(-9), obs_hoje: 4, lig_por_hora: [20, 15, 12, 0, 0, 0, 0, 0], meta_dia: 80, pode_pegar: true },
  ];
  window.__rpcRespostas.leads_kanban3 = { data: LQ, error: null };
  window.__rpcRespostas.leads_alertas = { data: [{ tipo: 'sem_contato', aba: 'O', lead_id: 's1', nome: 'Zz Sem Um', dono_id: 'u1', dono_nome: 'Zz Lucas', desde: isoE(-100) },
    { tipo: 'retorno_vencido', aba: 'O', lead_id: 'a1', nome: 'Zz Andando', dono_id: 'u1', dono_nome: 'Zz Lucas', desde: isoE(-50) },
    { tipo: 'perda_suspeita', aba: 'O', lead_id: 'pz', nome: 'Zz Perdido', dono_id: 'u2', dono_nome: 'Zz Luria', desde: isoE(-500) }], error: null };
  window.__rpcRespostas.leads_atividade_equipe2 = { data: ATV, error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 1, placar: {} }, error: null };
  await kbAplicarPermissao();
  kbEstado.aba = null; await kbCarregar(); await espera(120);
  const EQ = document.getElementById('kbEquipe');
  assert(kbEstado.aba === 'equipe' && window.__rpcCalls.some(c => c.nome === 'leads_atividade_equipe2') && kbEstado.atividadeV2, 'Equipe usa a função nova');
  eq([...EQ.querySelectorAll('[data-kb-eqk]')].map(b => b.dataset.kbEqk), ['ligacoes', 'livres', 'sem_contato', 'retorno_atrasado', 'convertido'], 'cinco números no topo');
  eq(EQ.querySelector('[data-kb-eqk="ligacoes"] .kbNumGrande').textContent.replace(/\\s+/g, ' ').trim(), '76 / 160', 'ligações da equipe / meta × consultores com telefonia');
  assert(EQ.querySelector('[data-kb-eqk="livres"] .kbNumGrande').textContent === '1' && EQ.querySelector('[data-kb-eqk="livres"]').textContent.includes('mais antigo há 25 min'), 'livres com o mais antigo');
  eq(EQ.querySelector('[data-kb-eqk="sem_contato"] .kbNumGrande').textContent, '2', 'pegos e sem contato');
  const faixa = EQ.querySelector('.kbEqAtencao');
  assert(faixa && faixa.textContent.includes('Zz Lucas está há 1 h 15 min sem ligar nem escrever OBS') && faixa.textContent.includes('2 leads sem contato'), 'faixa de atenção com o texto da spec');
  assert(faixa.querySelector('[data-kb-eq="u1|sem_contato"]').textContent.includes('Ver os leads dele') && faixa.querySelector('[data-kb-eq-redist="u1"]').textContent.includes('Redistribuir 2'), 'faixa com Ver os leads dele e Redistribuir N');
  assert(EQ.querySelectorAll('.kbEqAtencao').length === 1, 'só uma faixa (Luria está verde)');
  const linha1 = EQ.querySelector('tr[data-kb-dono="u1"]');
  assert(linha1.querySelector('.kbEqSem.r .kbSemaforo') && linha1.textContent.includes('parado 1 h 15 min'), 'semáforo escrito vermelho, com a bolinha');
  eq([...linha1.querySelectorAll('.kbCalor i')].map(i => i.className), ['l2', 'l1', 'l0', 'fut', 'fut', 'fut', 'fut', 'fut'], 'mapa por hora: 6 → l2, 3 → l1, a hora atual conta, as futuras vazadas');
  assert(linha1.querySelector('.kbEqHoje').textContent.includes('19') && linha1.querySelector('.kbEqHoje').textContent.includes('/ 80') && linha1.textContent.includes('19 hoje') && linha1.textContent.includes('pega leads'), 'Hoje: ligações / meta; atividade em texto pequeno; pega leads');
  assert(EQ.querySelector('tr[data-kb-dono="u2"] .kbEqSem.v').textContent.includes('ligou há 3 min'), 'verde: ligou há 3 min');
  assert(linha1.querySelector('[data-kb-eq="u1|sem_contato"].ruim') && !EQ.querySelector('tr[data-kb-dono="u2"] [data-kb-eq="u2|sem_contato"]'), 'número com problema em vermelho; zero não é botão');
  eq([...EQ.querySelectorAll('.kbEqAlertas .kbEqBloco h3')].map(h => h.firstChild.textContent.trim()), ['Pegos e sem contato', 'Retornos atrasados', 'Perdidos sem nenhuma ligação'], 'alertas em três blocos');
  assert(EQ.querySelector('.kbEqAlertas [data-kb-passar-um="O|s1"]') && EQ.querySelectorAll('.kbEqAlertas .kbEqBloco')[1].querySelector('[data-kb-abrir="O|a1"]'), 'Passar no bloco sem contato; Abrir nos outros');
  // números e faixa abrem a lista com seleção
  faixa.querySelector('[data-kb-eq-redist="u1"]').click();
  const barra = () => document.getElementById('kbLoteBarra');
  assert(kbEstado.equipeLista.dono === 'u1' && kbEstado.equipeLista.chave === 'sem_contato' && kbEstado.loteSel.size === 2 && !barra().hidden && barra().textContent.includes('2 leads selecionados'), 'Redistribuir N abre a lista com os sem contato dele já selecionados');
  assert(barra().querySelector('[data-kb-lote-livres]') && barra().querySelector('[data-kb-lote-passar]'), 'barra escura com Devolver aos livres e Passar para…');
  EQ.querySelector('[data-kb-lote="O|s2"]').click();
  assert(kbEstado.loteSel.size === 1 && barra().textContent.includes('1 lead selecionado') && !EQ.querySelector('[data-kb-lote="O|s2"]').checked, 'desmarcar tira da seleção');
  EQ.querySelector('[data-kb-lote-todos]').click();
  eq(kbEstado.loteSel.size, 2, 'Selecionar todos');
  EQ.querySelector('[data-kb-lote-limpar]').click();
  assert(kbEstado.loteSel.size === 0 && barra().hidden, 'Limpar seleção esconde a barra');
  EQ.querySelector('[data-kb-eqk="sem_contato"]').click();
  assert(kbEstado.equipeLista.dono === '' && EQ.querySelector('.kbEqLista h3').textContent === 'Equipe · Sem contato' && EQ.querySelector('.kbEqLista').textContent.includes('Zz · pego'), 'número do topo abre a lista da equipe toda, com o primeiro nome do dono');
  EQ.querySelector('[data-kb-eq-fechar]').click();
  assert(!EQ.querySelector('.kbEqLista') && kbEstado.loteSel.size === 0, 'Fechar tira a lista e a seleção');
  // RF1: sem a função nova, cai para a antiga (sem mapa por hora)
  window.__rpcRespostas.leads_atividade_equipe2 = { data: null, error: { message: 'function public.leads_atividade_equipe2() does not exist' } };
  window.__rpcRespostas.leads_atividade_equipe = { data: ATV.map(a => { const b = Object.assign({}, a); delete b.lig_por_hora; delete b.meta_dia; delete b.pode_pegar; return b; }), error: null };
  await kbCarregarEquipe();
  assert(!kbEstado.atividadeV2 && EQ.querySelector('tr[data-kb-dono="u1"] .kbCalorSem') && EQ.querySelector('[data-kb-eqk="ligacoes"]').textContent.includes('160') && EQ.querySelector('tr[data-kb-dono="u1"] .kbEqSem.r'), 'RF1: sem a função nova a Equipe abre com a antiga (mapa "—", meta padrão 80, semáforo igual)');
  window.__rpcRespostas.leads_atividade_equipe2 = { data: ATV, error: null };
  await kbCarregarEquipe();
  // ==== Task 4: menu Passar para (relógio ainda fixo) ====
  kbEstado.equipeLista = { dono: 'u1', chave: 'sem_contato' }; kbEstado.loteSel = new Set(['O|s1', 'O|s2']); kbRenderEquipe();
  document.querySelector('#kbLoteBarra [data-kb-lote-passar]').click();
  const PM = document.getElementById('kbPassar');
  assert(!PM.hidden && PM.textContent.includes('Passar 2 leads para'), 'menu abre para o lote');
  eq([...PM.querySelectorAll('[data-kb-passar-para]')].map(b => b.dataset.kbPassarPara), ['u2', '__livres'], 'sem o dono atual; Devolver aos livres (todos sem status); sem Dividir com uma pessoa só');
  const opU2 = PM.querySelector('[data-kb-passar-para="u2"]');
  assert(opU2.textContent.includes('menos carga') && opU2.textContent.includes('1 em andamento') && opU2.classList.contains('ativo'), 'quem tem menos carga vem marcado, com o selo e a carga');
  eq(PM.querySelector('[data-kb-passar-ok]').textContent, 'Passar para Zz Luria', 'botão diz para quem vai');
  // escolher não fecha o menu (o clique redesenha o menu por dentro)
  PM.querySelector('[data-kb-passar-para="__livres"]').click();
  assert(!PM.hidden && kbEstado.passar.escolha === '__livres' && PM.querySelector('[data-kb-passar-ok]').textContent === 'Devolver aos livres', 'escolher troca a opção e o menu continua aberto');
  PM.querySelector('[data-kb-passar-para="u2"]').click();
  // RF3 e execução em sequência
  const chamadas = []; window.__rpcRespostas.leads_redistribuir = (a) => { chamadas.push(a.p_id + '>' + a.p_novo); return { data: null, error: null }; };
  let mud = 0; document.addEventListener('agenda:mudou', () => mud++);
  PM.querySelector('[data-kb-passar-ok]').click(); PM.querySelector('[data-kb-passar-ok]').click();
  await espera(150);
  eq(chamadas, ['s1>u2', 's2>u2'], 'RF3: dois cliques = uma execução, lead a lead');
  assert(PM.hidden && kbEstado.loteSel.size === 0 && mud >= 1 && window.__alertas.some(m => m.includes('2 de 2 passados')), 'fecha, limpa a seleção, avisa a Agenda e mostra o resultado');
  // clicar fora fecha; Esc fecha
  kbPassarAbrir(['O|s1']); document.body.click();
  assert(PM.hidden, 'clicar fora fecha o menu');
  kbPassarAbrir(['O|s1']); document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert(PM.hidden, 'Esc fecha o menu');
  // Devolver aos livres pela barra abre o menu já marcado
  kbEstado.loteSel = new Set(['O|s1']); kbRenderEquipe();
  document.querySelector('#kbLoteBarra [data-kb-lote-livres]').click();
  assert(!PM.hidden && kbEstado.passar.escolha === '__livres', 'Devolver aos livres da barra abre o menu com a opção marcada (confirma antes)');
  kbPassarFechar(); kbEstado.loteSel = new Set();
  // Dividir igual entre os que pegam
  window.__rpcRespostas.leads_atividade_equipe2 = { data: ATV.concat([{ dono_id: 'u3', nome: 'Zz Mariana', tem_telefonia: true, lig_hoje: 0, lig_por_hora: [0,0,0,0,0,0,0,0], meta_dia: 80, pode_pegar: true }]), error: null };
  await kbCarregarEquipe();
  chamadas.length = 0;
  kbPassarAbrir(['O|s1', 'O|s2']);
  assert(PM.querySelector('[data-kb-passar-para="__igual"]'), 'Dividir igual aparece com dois ou mais que pegam');
  kbPassarEscolher('__igual');
  eq(PM.querySelector('[data-kb-passar-ok]').textContent, 'Dividir 2 leads', 'botão de dividir');
  await kbPassarExecutar();
  eq(chamadas.slice().sort(), ['s1>u3', 's2>u2'], 'dividir igual: cada um para quem está com menos carga (u3 com 0, depois empate pelo nome)');
  // RF2: falha parcial
  chamadas.length = 0;
  window.__rpcRespostas.leads_redistribuir = (a) => { chamadas.push(a.p_id); return a.p_id === 's2' ? { data: null, error: { message: 'lead com status não volta aos Livres; passe para outro consultor' } } : { data: null, error: null }; };
  kbPassarAbrir(['O|s1', 'O|s2']); kbPassarEscolher('__livres');
  const res = await kbPassarExecutar();
  assert(res.ok === 1 && res.falhas.length === 1 && !PM.hidden && PM.querySelector('.kbPassarFalhas').textContent.includes('Zz Sem Dois') && PM.textContent.includes('não volta aos Livres'), 'RF2: falha parcial lista o lead e o motivo, e o menu fica aberto');
  assert(window.__alertas.some(m => m.includes('1 de 2 passados')), 'RF2: aviso com o resultado parcial');
  chamadas.length = 0; kbPassarEscolher('u2'); await kbPassarExecutar();
  eq(chamadas, ['s2'], 'RF2: tentar de novo só refaz o que falhou');
  // um lead só (alerta Passar) usa o mesmo menu
  window.__rpcRespostas.leads_redistribuir = { data: null, error: null };
  kbRenderEquipe();
  document.querySelector('#kbEquipe .kbEqAlertas [data-kb-passar-um="O|s1"]').click();
  assert(!PM.hidden && PM.textContent.includes('Passar "Zz Sem Um" para'), 'Passar no alerta abre o menu para um lead');
  kbPassarFechar();
  // RF5: único consultor
  kbEstado.atividade = [ATV[0]];
  kbPassarAbrir(['O|a1']);
  assert(PM.textContent.includes('Nenhum outro consultor na equipe de leads.') && PM.querySelector('[data-kb-passar-ok]').disabled, 'RF5: sem outro consultor não dá para confirmar');
  kbPassarFechar();
  assert(!document.getElementById('kbRedOverlay'), 'a janela Redistribuir saiu');
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
