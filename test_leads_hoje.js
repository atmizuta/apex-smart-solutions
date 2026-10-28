// Testa as abas Hoje / Quadro / Equipe de "Meus leads" (§118). Spec: docs/superpowers/specs/2026-10-27-meus-leads-hoje-equipe-design.md
// Decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom. DADOS FICTÍCIOS (repo público).
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
window.alert = (m) => window.__alertas.push(String(m));   // sem ApexMotion no jsdom, mostrarAviso cai aqui
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

  // ==== Task 3: funções puras ====
  eq(kbAbasDoPerfil(false), ['hoje', 'quadro'], 'consultor: Hoje e Quadro');
  eq(kbAbasDoPerfil(true), ['hoje', 'quadro', 'equipe'], 'gestor: + Equipe');
  eq([kbAbaPadrao(false), kbAbaPadrao(true)], ['hoje', 'equipe'], 'aba padrão por perfil');
  const fila = [{ aba: 'OUTUBRO', lead_id: 'a', motivo: 'Novo sem contato' }, { aba: 'OUTUBRO', lead_id: 'b', motivo: 'Esfriando' }];
  const agora = Date.parse('2026-10-27T15:00:00Z');
  eq(kbProximoDaFila(fila, {}, agora).lead_id, 'a', 'próximo = primeiro da fila');
  eq(kbProximoDaFila(fila, { 'OUTUBRO|a': agora - 60000 }, agora).lead_id, 'b', 'aberto há 1 min é pulado');
  eq(kbProximoDaFila(fila, { 'OUTUBRO|a': agora - 180000 }, agora).lead_id, 'a', 'exceção vence em 2 min');
  eq(kbProximoDaFila([], {}, agora), null, 'fila vazia');
  eq(kbSemaforo({ sem_contato: 1, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 0 }), 'vermelho', 'semáforo vermelho: novo sem contato');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 2, parados: 0, perdas_suspeitas: 0 }), 'vermelho', 'semáforo vermelho: retorno vencido');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 0, parados: 1, perdas_suspeitas: 0 }), 'amarelo', 'semáforo amarelo: parado');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 3 }), 'amarelo', 'semáforo amarelo: perda suspeita');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 0 }), 'verde', 'semáforo verde');
  eq([kbConversao({ pegos_mes: 0, convertidos_mes: 0 }), kbConversao({ pegos_mes: 40, convertidos_mes: 10 })], ['—', '25%'], 'conversão');
  eq(kbResumoContatoTexto({ ligacoes: 5, atendidas: 2, cliques: 1, ultimo: '2026-10-27T12:00:00Z' }, agora), '5 tentativas · 2 atendidas · última há 3 h', 'resumo de contato');
  eq(kbResumoContatoTexto({ ligacoes: 1, atendidas: 0, cliques: 0, ultimo: '2026-10-27T14:58:00Z' }, agora), '1 tentativa · 0 atendidas · última há 2 min', 'singular');
  eq(kbResumoContatoTexto({ ligacoes: 0, atendidas: 0, cliques: 2, ultimo: '2026-10-27T14:00:00Z' }, agora), 'Nenhuma ligação ainda · 2 cliques no painel', 'só cliques');
  eq(kbResumoContatoTexto({ ligacoes: 0, atendidas: 0, cliques: 0, ultimo: null }, agora), 'Nenhuma ligação ainda', 'nada');
  eq(kbResumoContatoTexto(null, agora), '', 'sem resumo (Livre)');
  const ev = Array.from({ length: 35 }, (_, i) => ({ em: new Date(agora - i * 60000).toISOString(), tipo: i % 2 ? 'ligacao' : 'clique', titulo: 'Evento ' + i, detalhe: i === 0 ? '<b>x</b>' : null, quem: 'Zz' }));
  const lt = kbLinhaTempoHtml(ev, 30);
  assert((lt.match(/class="kbEv /g) || []).length === 30 && lt.includes('data-kb-ver-tudo'), 'linha do tempo: 30 eventos e "ver tudo"');
  assert(!lt.includes('<b>x</b>') && lt.includes('&lt;b&gt;'), 'linha do tempo escapa HTML');
  assert(!kbLinhaTempoHtml(ev.slice(0, 3), 30).includes('data-kb-ver-tudo'), 'sem "ver tudo" com poucos eventos');
  eq([kbBuscaValida('ab'), kbBuscaValida(' abc '), kbBuscaValida('')], [false, true, false], 'busca a partir de 3 caracteres');
  eq(kbAlertaTexto({ tipo: 'sem_contato' }), 'Pego e sem contato', 'texto do alerta');
  const al = [{ tipo: 'sem_contato', aba: 'O', lead_id: '1' }, { tipo: 'parado', aba: 'O', lead_id: '2' }, { tipo: 'sem_contato', aba: 'O', lead_id: '3' }];
  eq(kbAlertasParaNotificar(al, new Set(['O|3'])).map(a => a.lead_id), ['1'], 'notifica só sem_contato ainda não notificado');
  eq(kbQuandoSP('2026-10-28', '14:30'), '2026-10-28T14:30:00-03:00', 'data + hora em SP');
  eq(kbQuandoSP('2026-10-28', ''), '2026-10-28T10:00:00-03:00', 'hora padrão 10:00');
  // ==== Task 4: telas ====
  // consultor: abas, Hoje com fila e retornos, próximo lead abre ficha e entra na exceção
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON' }];
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_status_opcoes = [{ status: 'AGENDADO RETORNO', grupo: 'andamento', ordem: 2 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  window.__rpcRespostas.leads_kanban2 = { data: [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', categoria: 'sem_contato', livre: false, criado_em_lead: new Date().toISOString() }], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', motivo: 'Novo sem contato', desde: new Date().toISOString() }],
    retornos: [{ aba: 'OUTUBRO', lead_id: 'h2', nome: 'Zz Retorno', quando: new Date(Date.now() - 600000).toISOString(), vencido: true }], livres: 3 }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [{ tipo: 'sem_contato', aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', dono_nome: 'Zzkcon Teste', desde: new Date().toISOString() }], error: null };
  window.__rpcRespostas.leads_ficha = { data: [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', livre: false, categoria: 'sem_contato', telefone: '11900000001' }], error: null };
  window.__rpcRespostas.leads_ficha_detalhes = { data: { anuncio: { campanha: 'Zz Camp', conjunto: 'Zz Conj', anuncio: null, formulario: 'Zz Form', plataforma: 'fb', organico: false },
    resumo: { ligacoes: 2, atendidas: 1, cliques: 0, ultimo: new Date(Date.now() - 3600000).toISOString() },
    eventos: [{ em: new Date().toISOString(), tipo: 'ligacao', titulo: 'Ligação atendida', detalhe: '2 min 5 s', quem: 'zz.usuario' }] }, error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  await espera(80);   // Hoje e alertas carregam em segundo plano
  eq([...document.querySelectorAll('#kbAbas [data-kb-aba]')].filter(b => b.style.display !== 'none').map(b => b.dataset.kbAba), ['hoje', 'quadro'], 'consultor vê Hoje e Quadro');
  assert(document.getElementById('kbHoje').style.display !== 'none' && document.getElementById('kbBoard').style.display === 'none', 'consultor abre na aba Hoje');
  assert(document.getElementById('kbHoje').textContent.includes('Zz Retorno') && document.getElementById('kbHoje').textContent.includes('Pego e sem contato'), 'Hoje mostra retornos e alertas');
  document.querySelector('#kbHoje [data-kb-proximo]').click();
  await espera(60);
  assert(window.__rpcCalls.some(c => c.nome === 'leads_ficha' && c.args.p_id === 'h1'), 'Próximo lead abre a ficha do primeiro da fila');
  assert(kbEstado.excecoes['OUTUBRO|h1'] > 0, 'lead aberto entra na exceção de 2 min');
  assert(document.getElementById('kbFichaDetalhes').textContent.includes('2 tentativas') && document.getElementById('kbFichaDetalhes').textContent.includes('Zz Conj'), 'ficha mostra resumo, linha do tempo e anúncio');
  kbFecharFicha();
  // notificação uma vez por lead
  await kbCarregarAlertas(true); await kbCarregarAlertas(true);
  assert(kbEstado.notificados.has('OUTUBRO|h1') && document.getElementById('tabBtnMeusLeads').textContent.includes('1'), 'alerta urgente notificado e contador no menu');
  eq((window.__alertas || []).filter(m => m.includes('Pego e sem contato')).length, 1, 'notifica uma vez só por lead');
  // pesquisa com espera de 300 ms
  window.__rpcRespostas.leads_buscar = { data: [{ aba: 'OUTUBRO', lead_id: 'b1', nome: 'Zz Achado', cidade: 'Campinas', uf: 'SP', status: null, categoria: 'sem_contato', dono_nome: null, livre: true }], error: null };
  const campo = document.getElementById('kbBusca');
  campo.value = 'zz'; campo.dispatchEvent(new window.Event('input'));
  await espera(350);
  assert(!window.__rpcCalls.some(c => c.nome === 'leads_buscar'), 'menos de 3 letras não busca');
  campo.value = 'zz ach'; campo.dispatchEvent(new window.Event('input'));
  await espera(350);
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_buscar').length === 1 && document.getElementById('kbBuscaRes').textContent.includes('Zz Achado'), 'busca mostra resultado');
  // classificar AGENDADO RETORNO com hora chama leads_agendar_retorno
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  window.__rpcRespostas.leads_agendar_retorno = { data: null, error: null };
  kbEstado.leads = [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', categoria: 'sem_contato' }];
  kbAbrirClassificar('OUTUBRO', 'h1', null);
  document.getElementById('kbClassStatus').value = 'AGENDADO RETORNO';
  document.getElementById('kbClassStatus').dispatchEvent(new window.Event('change'));
  assert(document.getElementById('kbClassRetornoBox').style.display !== 'none', 'AGENDADO RETORNO mostra data e hora');
  document.getElementById('kbClassRetorno').value = '2099-01-02';
  document.getElementById('kbClassHora').value = '14:30';
  await kbSalvarClassificacao();
  const ag = window.__rpcCalls.filter(c => c.nome === 'leads_agendar_retorno').pop();
  eq(ag && ag.args.p_quando, '2099-01-02T14:30:00-03:00', 'retorno com data e hora vai para a Agenda');
  // retorno rápido da ficha também vai para a Agenda (10:00)
  await kbRetornoRapido('OUTUBRO', 'h1', 1);
  const rr2 = window.__rpcCalls.filter(c => c.nome === 'leads_agendar_retorno').pop();
  assert(rr2 && rr2.args.p_aba === 'OUTUBRO' && rr2.args.p_id === 'h1' && /T10:00:00-03:00$/.test(rr2.args.p_quando), 'retorno rápido agenda às 10:00');
  // gestor: Equipe com semáforo; clicar na linha filtra o Quadro
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__rpcRespostas.leads_equipe_resumo = { data: [{ dono_id: 'u-zz', nome: 'Zzkcon Teste', em_aberto: 5, sem_contato: 1, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 0, pegos_mes: 20, convertidos_mes: 5, receita_mes: 899.9, tempo_medio_1o_contato_min: 4.5 }], error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  await espera(80);   // Equipe carrega em segundo plano
  assert(document.getElementById('kbEquipe').style.display !== 'none', 'gestor abre na aba Equipe');
  const linhaEq = document.querySelector('#kbEquipe tr[data-kb-dono="u-zz"]');
  assert(linhaEq && linhaEq.classList.contains('kbSem-vermelho') && linhaEq.textContent.includes('25%'), 'Equipe: semáforo e conversão');
  linhaEq.click();
  await espera(60);
  assert(kbEstado.aba === 'quadro' && kbEstado.dono === 'u-zz', 'clicar no consultor abre o Quadro filtrado');
  // Agenda: clicar num retorno ligado a lead abre a ficha do lead
  const antesFicha = window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length;
  alAoClicar({ id: 'r1', nome: 'Zz Retorno', lead_aba: 'OUTUBRO', lead_id: 'h1' });
  await espera(60);
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length === antesFicha + 1, 'retorno da Agenda abre a ficha do lead');
  // ==== Ajustes da revisão final ====
  // Important 2b: com a aba aberta mas a janela escondida, o timer de 2 min continua atualizando os alertas
  eq([kbAlertaDeFundo(false, true), kbAlertaDeFundo(true, false), kbAlertaDeFundo(true, true)], [true, true, false], 'alerta de fundo: aba fechada ou janela escondida');
  // Important 2a: o timer começa no login (kbAplicarPermissao), sem precisar abrir a aba
  clearInterval(kbEstado.timer); clearInterval(kbEstado.timerAlertas); kbEstado.timer = null; kbEstado.timerAlertas = null;
  await kbAplicarPermissao();
  assert(kbEstado.timerAlertas, 'timer de alertas começa no login de quem vê a aba');
  // Important 1: classificar/agendar/redistribuir avisam a Agenda (o alarme recarrega na hora)
  let mudou = 0; document.addEventListener('agenda:mudou', () => mudou++);
  await kbRetornoRapido('OUTUBRO', 'h1', 1);
  kbEstado.leads = [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', categoria: 'andamento', status: 'EM NEGOCIAÇÂO' }];
  kbEstado.opcoes = [{ status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  kbAbrirClassificar('OUTUBRO', 'h1', null);
  document.getElementById('kbClassStatus').value = 'CNPJ INAPTO';
  await kbSalvarClassificacao();
  window.__rpcRespostas.leads_redistribuir = { data: null, error: null };
  kbEstado.consultores = [{ profile_id: 'u-zz', nome_planilha: 'ZZKCON' }, { profile_id: 'u-out', nome_planilha: 'ZZOUT' }];
  kbEstado.leads = [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', categoria: 'andamento', dono_id: 'u-zz' }];
  kbAbrirRedistribuir('OUTUBRO', 'h1');
  await kbSalvarRedistribuicao();
  eq(mudou, 3, 'retorno rápido, classificar e redistribuir avisam a Agenda');
  // Minor→Important (carga): mudança de versão no Quadro não recalcula a Equipe nem os alertas
  kbTrocarAba('equipe'); await espera(60);
  const contar = (n) => window.__rpcCalls.filter(c => c.nome === n).length;
  const [eq0, al0] = [contar('leads_equipe_resumo'), contar('leads_alertas')];
  await kbCarregar(); await espera(60);
  eq([contar('leads_equipe_resumo') - eq0, contar('leads_alertas') - al0], [0, 0], 'recarga do Kanban não recalcula Equipe nem alertas');
  // Minor→Important: contador do menu num badge próprio, sem mexer no rótulo (o título da página copia o rótulo)
  await kbCarregarAlertas(false);
  assert(document.querySelector('#tabBtnMeusLeads .sbLabel').textContent === 'Meus leads' && document.getElementById('kbBadgeMenu').textContent !== '', 'contador no badge, rótulo intacto');
  // sair: zera estado e timers de alertas
  kbParar();
  assert(kbEstado.notificados.size === 0 && !kbEstado.alertas.length && document.getElementById('kbBadgeMenu').textContent === '', 'sair zera alertas e contador');
  // ==== §120 (27/10 noite): leveza, navegação do Quadro, Classificar novo, telefone em aba nova, apagar, ficha flutuante ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON' }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'AGENDADO RETORNO', grupo: 'andamento', ordem: 2 },
    { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  kbEstado.opcoes = [];
  const LL = (id, o) => Object.assign({ aba: 'OUTUBRO', lead_id: id, nome: 'Zz ' + id, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, telefone: '11900000001',
    criado_em_lead: new Date(Date.now() - 3600000).toISOString(), classificado_em: new Date().toISOString() }, o || {});
  const muitos = Array.from({ length: 110 }, (_, i) => LL('a' + i)).concat([LL('pp1', { categoria: 'perdido', status: 'CNPJ INAPTO' }), LL('nv1', { categoria: 'sem_contato', status: null })]);
  window.__rpcRespostas.leads_kanban2 = { data: muitos, error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  kbTrocarAba('quadro');
  const colAnd = () => document.querySelector('#kbBoard [data-kb-col="andamento"]');
  eq(colAnd().querySelectorAll('.kbCard').length, 100, 'coluna mostra no máximo 100 cartões');
  assert(colAnd().querySelector('[data-kb-vermais="andamento"]').textContent.includes('10'), '"Ver mais (10)" na coluna');
  colAnd().querySelector('[data-kb-vermais="andamento"]').click();
  eq(colAnd().querySelectorAll('.kbCard').length, 110, 'Ver mais mostra o resto');
  assert(!document.querySelector('#kbBoard [data-kb-col="perdido"] .kbCard') && document.querySelector('#kbBoard [data-kb-abrirperdido]'), 'Perdido fechado não monta cartões');
  // recarga com os mesmos dados não refaz a coluna (mesmo nó no DOM)
  const noAntes = colAnd().querySelector('.kbCard');
  kbRender();
  assert(colAnd().querySelector('.kbCard') === noAntes, 'coluna sem mudança não é redesenhada');
  // telefone abre em aba nova; WhatsApp monta o link só no clique
  const tel = document.querySelector('#kbBoard [data-kb-col="andamento"] a[data-kb-contato="ligar"]');
  assert(tel && tel.hasAttribute('data-kb-ligar') && !String(tel.getAttribute('href')).startsWith('tel:'), 'telefone do cartão não usa mais tel: (abre o ProContact)');
  assert(!document.getElementById('kbBoard').innerHTML.includes('wa.me'), 'cartão não carrega o link do WhatsApp pronto');
  const abertos = []; const openOrig = window.open; window.open = (u) => { abertos.push(String(u)); return null; };
  document.querySelector('#kbBoard [data-kb-col="andamento"] [data-kb-whats]').click();
  window.open = openOrig;
  assert(abertos.length === 1 && abertos[0].includes('wa.me/5511900000001'), 'clique no WhatsApp abre a conversa');
  // navegação: setas e atalhos das colunas; atalho do Perdido abre a coluna
  assert(document.getElementById('kbNavQuadro').style.display !== 'none' && document.querySelector('#kbNavQuadro [data-kb-ir="perdido"]').textContent.includes('1'), 'barra de navegação com contagem');
  document.querySelector('#kbNavQuadro [data-kb-ir="perdido"]').click();
  assert(document.querySelector('#kbBoard [data-kb-col="perdido"] .kbCard[data-id="pp1"]'), 'atalho do Perdido abre a coluna');
  assert(document.querySelector('#kbNavQuadro [data-kb-seta="1"]') && document.querySelector('#kbNavQuadro [data-kb-seta="-1"]'), 'setas para os lados');
  kbTrocarAba('hoje');
  assert(document.getElementById('kbNavQuadro').style.display === 'none', 'barra só no Quadro');
  // versão por consultor
  window.__rpcRespostas.leads_kanban_versao_dono = { data: 'vd1', error: null };
  await kbVerificarVersao();
  assert(window.__rpcCalls.some(c => c.nome === 'leads_kanban_versao_dono'), 'versão por consultor');
  // Classificar novo: chips por grupo, atalhos de data, Ctrl+Enter
  kbAbrirClassificar('OUTUBRO', 'a1', null);
  const chips = [...document.querySelectorAll('#kbClassGrupos [data-kb-status]')];
  eq(chips.length, 4, 'um botão por tabulação');
  document.querySelector('#kbClassGrupos [data-kb-status="AGENDADO RETORNO"]').click();
  assert(document.getElementById('kbClassStatus').value === 'AGENDADO RETORNO' && document.getElementById('kbClassRetornoBox').style.display !== 'none'
    && document.querySelector('#kbClassGrupos [data-kb-status="AGENDADO RETORNO"]').classList.contains('ativo'), 'clicar na tabulação escolhe e mostra data/hora');
  document.querySelector('#kbClassRetornoBox [data-kb-ret-dias="1"]').click();
  eq(document.getElementById('kbClassRetorno').value, somaDiasStr(hojeSP(), 1), 'atalho Amanhã preenche a data');
  assert(document.querySelector('#kbClassOverlay .mHead') && document.querySelector('#kbClassOverlay .mBody'), 'modal no padrão do painel (cabeçalho e corpo)');
  fecharOverlay(document.getElementById('kbClassOverlay'));
  kbAbrirClassificar('OUTUBRO', 'a1', 'perdido');
  eq([...document.querySelectorAll('#kbClassGrupos [data-kb-status]')].map(b => b.dataset.kbStatus), ['CNPJ INAPTO'], 'arrastar para Perdido mostra só as de perda');
  eq(document.querySelector('#kbClassGrupos [data-kb-status="CNPJ INAPTO"]').textContent, 'CNPJ inapto', 'sigla continua em maiúscula no botão');
  fecharOverlay(document.getElementById('kbClassOverlay'));
  // apagar: só gestor, com confirmação
  const fz = { aba: 'OUTUBRO', lead_id: 'a1', nome: 'Zz a1', livre: false, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001' };
  assert(!kbFichaHtml(fz, { gestor: false, agoraMs: Date.now() }).includes('data-kb-ficha-apagar'), 'consultor não tem Apagar');
  assert(kbFichaHtml(fz, { gestor: true, agoraMs: Date.now() }).includes('data-kb-ficha-apagar'), 'gestor tem Apagar');
  assert(kbFichaHtml(fz, { gestor: false, agoraMs: Date.now() }).includes('data-kb-ligar') && !kbFichaHtml(fz, { gestor: false, agoraMs: Date.now() }).includes('href="tel:'), 'Ligar da ficha abre o ProContact');
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__rpcRespostas.leads_ficha = { data: [fz], error: null };
  window.__rpcRespostas.leads_apagar = { data: null, error: null };
  await kbAbrirFicha('OUTUBRO', 'a1');
  document.querySelector('#kbFicha [data-kb-ficha-apagar]').click();
  const caixa = document.querySelector('#kbFicha [data-kb-apagar-box]');
  assert(caixa && !caixa.hidden, 'Apagar pede confirmação');
  caixa.querySelector('input').value = 'duplicado';
  caixa.querySelector('[data-kb-apagar-confirmar]').click();
  await espera(60);
  const ap = window.__rpcCalls.filter(c => c.nome === 'leads_apagar').pop();
  eq(ap && [ap.args.p_id, ap.args.p_motivo], ['a1', 'duplicado'], 'apagar manda o lead e o motivo');
  assert(!document.getElementById('kbFicha').classList.contains('aberta'), 'ficha fecha depois de apagar');
  // ficha flutuante (por cima do ProContact), como o Caderno
  const pip = document.implementation.createHTMLDocument('pip');
  const win = { document: pip, addEventListener: (ev, fn) => { if(ev === 'pagehide') win._ph = fn; }, close(){ if(win._ph) win._ph(); } };
  window.documentPictureInPicture = { requestWindow: async () => win };
  await kbAbrirFicha('OUTUBRO', 'a1');
  await kbFlutuarFicha();
  assert(pip.getElementById('kbFicha') && !document.getElementById('kbFicha'), 'ficha vai para a janela flutuante');
  window.__rpcRespostas.leads_ficha = { data: [Object.assign({}, fz, { lead_id: 'a2', nome: 'Zz Segundo' })], error: null };
  await kbAbrirFicha('OUTUBRO', 'a2');
  assert(pip.getElementById('kbFichaCorpo').textContent.includes('Zz Segundo'), 'abrir outro lead atualiza a janela flutuante');
  kbFecharFicha();
  assert(document.getElementById('kbFicha') && !pip.getElementById('kbFicha'), 'fechar a flutuante devolve a ficha ao painel');
  delete window.documentPictureInPicture;
  // §120 (correção 27/10 20h): o modal novo deixou dois </div> sobrando e as abas saíram da área principal (Dashboard aparecendo em tudo)
  const pais = new Set([...document.querySelectorAll('section.panel')].map(p => p.parentElement));
  assert(pais.size === 1, 'todas as abas (section.panel) dentro do mesmo contêiner — HTML sem </div> sobrando');
  assert(document.getElementById('kbClassOverlay').parentElement === document.getElementById('kbRedOverlay').parentElement, 'modais de Meus leads no mesmo lugar');
  // ==== §121: coluna "Sem ligação", última ligação e OBS no cartão, mais cartões por coluna ====
  const SL = (o) => Object.assign({ aba: 'OUTUBRO', lead_id: 'x', nome: 'Zz', livre: false, categoria: 'sem_contato', status: null }, o);
  eq([kbColunaDoLead(SL({ ligacoes: 0 })), kbColunaDoLead(SL({ ligacoes: 0, categoria: 'andamento', status: 'EM NEGOCIAÇÂO' })),
      kbColunaDoLead(SL({ ligacoes: 2, categoria: 'andamento' })), kbColunaDoLead(SL({ ligacoes: 1 })),
      kbColunaDoLead(SL({ ligacoes: 0, categoria: 'perdido' })), kbColunaDoLead(SL({ ligacoes: 0, livre: true })), kbColunaDoLead(SL({ ligacoes: 0, categoria: 'convertido' }))],
     ['novos', 'semlig', 'andamento', 'novos', 'perdido', 'livres', 'convertido'], 'Sem ligação: só lead já classificado (em andamento) que nunca recebeu ligação; lead novo fica em Meus novos');
  eq([kbAcaoDoArraste('livres', 'semlig'), kbAcaoDoArraste('livres', 'novos'), kbAcaoDoArraste('semlig', 'perdido'), kbAcaoDoArraste('semlig', 'novos')], [null, 'pegar', 'classificar', null], 'arraste: pegar vai para Meus novos; Sem ligação reclassifica');
  const cartao = kbCard(SL({ lead_id: 'c1', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001', obs: 'zz pediu proposta <b>', ligacoes: 2,
    ultima_ligacao: new Date(Date.now() - 2 * 3600000).toISOString(), ultima_atendida: true, ultima_seg: 95, criado_em_lead: new Date().toISOString() }), Date.now());
  assert(cartao.includes('zz pediu proposta') && cartao.includes('&lt;b&gt;'), 'cartão mostra a última OBS (escapada)');
  assert(cartao.includes('Última ligação há 2 h') && cartao.includes('atendida · 1 min 35 s'), 'cartão mostra a última ligação');
  assert(kbCard(SL({ lead_id: 'c2', telefone: '11900000001', categoria: 'andamento', ligacoes: 1, ultima_ligacao: new Date().toISOString(), ultima_atendida: false, criado_em_lead: new Date().toISOString() }), Date.now()).includes('não atendida'), 'ligação não atendida');
  window.__rpcRespostas.leads_kanban2 = { data: [SL({ lead_id: 's1', nome: 'Zz Nunca Ligou', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', ligacoes: 0, telefone: '11900000001', criado_em_lead: new Date().toISOString() }),
    SL({ lead_id: 's2', nome: 'Zz Recem Pego', ligacoes: 0, telefone: '11900000002', criado_em_lead: new Date().toISOString() })], error: null };
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  await kbAplicarPermissao(); await kbCarregar(); kbTrocarAba('quadro');
  assert(window.__rpcCalls.some(c => c.nome === 'leads_kanban2'), 'Quadro usa leads_kanban2 (com ligações)');
  assert(document.querySelector('#kbBoard [data-kb-col="semlig"] .kbCard[data-id="s1"]'), 'lead em andamento sem ligação na coluna Sem ligação');
  assert(document.querySelector('#kbBoard [data-kb-col="novos"] .kbCard[data-id="s2"]'), 'lead recém-pego (sem status) fica em Meus novos');
  assert(document.querySelector('#kbNavQuadro [data-kb-ir="semlig"]').textContent.includes('1'), 'atalho Sem ligação com contagem');
  eq(KB_COLUNAS.indexOf('semlig'), 1, 'Sem ligação logo depois dos Livres');
  assert(kbAtrasado(SL({ categoria: 'andamento', status: 'EM NEGOCIAÇÂO', ligacoes: 0, criado_em_lead: '2026-10-26T12:00:00Z' }), Date.parse('2026-10-27T12:00:00Z')) === false, 'lead em andamento sem ligação não ganha o relógio de atrasado (é só de Meus novos)');
  // §121 (pedido 20:35): telefone copia o número e abre (ou traz para frente, sem recarregar) a aba do ProContact
  const copiados = []; Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (t) => { copiados.push(t); } }, configurable: true });
  const janelas = []; const openOrig2 = window.open;
  window.open = (u, nome) => { const w = { nome, url: u, opener: 'painel', focado: false, location: { href: 'about:blank' }, focus(){ this.focado = true; } }; janelas.push(w); return w; };
  await kbLigar('(11) 90000-0001');
  eq(copiados.pop(), '11900000001', 'Ligar copia o número (só dígitos, sem 55)');
  const j1 = janelas.pop();
  assert(j1 && j1.nome === 'procontactApex' && j1.location.href.includes('procontact.com.br') && j1.focado && j1.opener === null, 'abre a aba do ProContact (nomeada, sem acesso de volta ao painel)');
  window.open = (u, nome) => { const w = { nome, focado: false, focus(){ this.focado = true; } }; Object.defineProperty(w, 'location', { get(){ throw new Error('cross-origin'); } }); janelas.push(w); return w; };
  await kbLigar('11900000002');
  const j2 = janelas.pop();
  assert(j2.focado && !('url' in j2), 'ProContact já aberto: só traz para frente, não recarrega (não derruba ligação)');
  window.open = openOrig2;
  // §121 (pedido 20:40): cores das tabulações iguais às da planilha
  eq([kbStSlug('EM NEGOCIAÇÂO'), kbStSlug('TELEFONE ERRADO ou  SEM WHATSAPP'), kbStSlug(' PROPOSTA ENVIADA'), kbStSlug('CLIENTE NÃO RESPONDE ')],
     ['em-negociacao', 'telefone-errado-ou-sem-whatsapp', 'proposta-enviada', 'cliente-nao-responde'], 'chave da cor por tabulação');
  const css = document.getElementById('kbStyles').textContent;
  ['EM NEGOCIAÇÂO', 'AGENDADO RETORNO', 'AGUARDANDO DOCUMENTAÇÃO', 'AGUARDANDO CLIENTE DECIDIR', 'PEDIDO EM ANÁLISE', 'PROPOSTA ENVIADA', 'PROBLEMA SISTÊMICO',
   'PEDIDO CONCLUIDO (VENDA)', 'CLIENTE NÃO RESPONDE', 'CLIENTE NÃO ACEITOU VALORES', 'CLIENTE SEM INTERESSE NO PLANO', 'LEAD PAROU DE RESPONDER', 'CNPJ INAPTO',
   'TELEFONE ERRADO ou  SEM WHATSAPP', 'LEAD FORA DO PERFIL', 'CLIENTE SO QUERIA APARELHO', 'CLIENTE SÓ QUERIA FIBRA', 'CNPJ REPROVADO', 'SUSPEITA DE FRAUDE',
   'PEDIDO ATIVO', 'AGUARDANDO ACEITE / ASSINATURA']
    .forEach(st => assert(css.includes('[data-st="' + kbStSlug(st) + '"]'), 'cor da planilha para ' + st));
  const cartaoCor = kbCard(SL({ lead_id: 'cc1', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001', ligacoes: 1, criado_em_lead: new Date().toISOString() }), Date.now());
  assert(cartaoCor.includes('class="kbSt" data-st="em-negociacao"'), 'cartão usa a cor da tabulação');
  assert(kbFichaHtml(Object.assign({}, fz, { status: 'CNPJ INAPTO' }), { gestor: false, agoraMs: Date.now() }).includes('data-st="cnpj-inapto"'), 'ficha usa a cor da tabulação');
  kbAbrirClassificar('OUTUBRO', 'a1', null);
  assert(document.querySelector('#kbClassGrupos [data-kb-status="CNPJ INAPTO"]').getAttribute('data-st') === 'cnpj-inapto', 'botão do Classificar com a cor da tabulação');
  fecharOverlay(document.getElementById('kbClassOverlay'));
  // ==== mais testes entram aqui ====

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
