// Testa a velocidade do lead ("Atender agora", 02/10/2026) — REGRAS_NEGOCIO.md §68.
// Spec: docs/superpowers/specs/2026-10-02-velocidade-lead-mesa-supervisor-design.md
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público (nada de telefone, nome ou CNPJ real).
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
window.__escritas = [];
window.__lidas = [];
window.__alertas = [];
function builder(tabela){
  const linhasFiltradas = () => { const f = b.__eq || {}; return (window.__tabelas[tabela] || []).filter(l => Object.keys(f).every(c => l[c] === undefined || l[c] === f[c])); };
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b,
    eq: (c, v) => { b.__eq = Object.assign(b.__eq || {}, { [c]: v }); return b; },
    upsert: (rows, opts) => { window.__escritas.push({ tabela, op: 'upsert', rows, opts }); return Promise.resolve({ error: null }); },
    insert: (rows) => { window.__escritas.push({ tabela, op: 'insert', rows }); return Promise.resolve({ error: null }); },
    update: (patch) => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'update', patch, filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    delete: () => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'delete', filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    maybeSingle: async () => ({ data: linhasFiltradas()[0] || null, error: null }),
    then: (resolve) => resolve({ data: linhasFiltradas(), error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => { window.__lidas.push(t); return builder(t); },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
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
  const sp = (s) => Date.parse(s + '-03:00');   // '2026-10-05T09:00:00' em São Paulo -> ms
  const cfg = vlCfg(null);

  // ==== TASK 3: funções puras ====
  eq(cfg.amarelo_min, 15, 'padrão amarelo 15');
  eq(vlCfg('{"amarelo_min":20}').amarelo_min, 20, 'config sobrescreve amarelo');
  eq(vlCfg('{"amarelo_min":20}').verde_min, 5, 'config mantém o resto do padrão');
  eq(vlCfg('lixo').amarelo_min, 15, 'config inválida = padrão');
  eq(vlPartesSP(sp('2026-10-05T08:30:00')), { dia: '2026-10-05', min: 510 }, 'partes em SP');
  eq(vlExpediente('2026-10-05', cfg), [480, 1080], 'segunda 08–18');
  eq(vlExpediente('2026-10-10', cfg), [480, 720], 'sábado 08–12');
  eq(vlExpediente('2026-10-04', cfg), null, 'domingo não tem expediente');
  eq(vlExpediente('2026-10-12', cfg), null, 'feriado (12/10) não tem expediente');
  eq(vlExpediente('2026-10-10', vlCfg('{"sabado":null}')), null, 'sábado desligado na config');

  eq(vlMinutosUteis(sp('2026-10-05T09:00:00'), sp('2026-10-05T09:12:00'), cfg), 12, 'dentro do expediente');
  eq(vlMinutosUteis(sp('2026-10-05T21:00:00'), sp('2026-10-06T08:05:00'), cfg), 5, 'chegou 21h, atendido 08:05 = 5 min');
  eq(vlMinutosUteis(sp('2026-10-05T21:00:00'), sp('2026-10-05T22:00:00'), cfg), 0, 'atendido antes da abertura = 0');
  eq(vlMinutosUteis(sp('2026-10-05T17:50:00'), sp('2026-10-06T08:10:00'), cfg), 20, 'atravessa o fechamento das 18h');
  eq(vlMinutosUteis(sp('2026-10-10T11:50:00'), sp('2026-10-13T08:03:00'), cfg), 13, 'sábado até 12h + domingo + feriado + terça');
  eq(vlMinutosUteis(sp('2026-10-05T10:00:00'), sp('2026-10-05T09:00:00'), cfg), 0, 'fim antes do início = 0');

  assert(vlDentroExpediente(sp('2026-10-05T08:00:00'), cfg) && !vlDentroExpediente(sp('2026-10-05T18:00:00'), cfg), 'expediente fechado no fim');
  eq([vlCor(5, cfg), vlCor(5.5, cfg), vlCor(15, cfg), vlCor(15.5, cfg)], ['verde', 'amarelo', 'amarelo', 'vermelho'], 'fronteiras das cores');
  eq([vlFmtMin(0.4), vlFmtMin(12), vlFmtMin(75)], ['< 1 min', '12 min', '1h 15min'], 'formato do relógio');

  const L = (id, extra) => Object.assign({ aba: 'OUTUBRO', lead_id: id, nome: 'Lead Teste ' + id, telefone: 'p:+5519900000001', categoria: 'andamento', status: 'EM NEGOCIACAO', criado_em_lead: new Date(sp('2026-10-05T09:00:00')).toISOString(), primeiro_clique: null, primeira_ligacao: null }, extra || {});
  assert(vlEsperando(L('a')), 'andamento sem contato = esperando');
  assert(!vlEsperando(L('b', { primeiro_clique: '2026-10-05T12:05:00Z' })), 'com clique não espera');
  assert(!vlEsperando(L('c', { primeira_ligacao: '2026-10-05T12:05:00Z' })), 'com ligação não espera');
  assert(!vlEsperando(L('d', { categoria: 'convertido' })), 'convertido sem contato sai da lista');
  assert(!vlEsperando(L('e', { categoria: 'perdido' })), 'perdido sem contato sai da lista');
  eq(vlPrimeiroContatoMs(L('f', { primeiro_clique: '2026-10-05T12:10:00Z', primeira_ligacao: '2026-10-05T12:05:00Z' })), Date.parse('2026-10-05T12:05:00Z'), '1º contato = o mais antigo');

  const agora = sp('2026-10-05T10:00:00');
  const pend = vlPendentes([
    L('verde', { criado_em_lead: new Date(sp('2026-10-05T09:58:00')).toISOString() }),
    L('amar', { criado_em_lead: new Date(sp('2026-10-05T09:50:00')).toISOString() }),
    L('verm', { criado_em_lead: new Date(sp('2026-10-05T09:00:00')).toISOString() }),
    L('feito', { primeiro_clique: '2026-10-05T12:30:00Z' }),
  ], agora, cfg);
  eq(pend.map(x => x.lead.lead_id), ['verm', 'amar', 'verde'], 'ordem vermelho → amarelo → verde, sem o contatado');
  eq(pend.map(x => x.cor), ['vermelho', 'amarelo', 'verde'], 'cores na lista');
  const dom7 = vlPendentes([L('noite', { criado_em_lead: new Date(sp('2026-10-04T20:00:00')).toISOString() })], sp('2026-10-04T23:00:00'), cfg);
  eq(dom7[0].cor, 'aguardando', 'domingo à noite: aguardando abertura, não vermelho');
  eq(vlPendentes(null, agora, cfg), [], 'null não quebra');

  eq(vlFaixa(L('g', { primeiro_clique: new Date(sp('2026-10-05T09:04:00')).toISOString() }), cfg), 'ate5', 'faixa até 5');
  eq(vlFaixa(L('h', { primeiro_clique: new Date(sp('2026-10-05T09:10:00')).toISOString() }), cfg), '5a15', 'faixa 5–15');
  eq(vlFaixa(L('i', { primeiro_clique: new Date(sp('2026-10-05T09:40:00')).toISOString() }), cfg), '15a60', 'faixa 15–60');
  eq(vlFaixa(L('j', { primeiro_clique: new Date(sp('2026-10-05T11:00:00')).toISOString() }), cfg), '1a4h', 'faixa 1–4 h');
  eq(vlFaixa(L('k', { primeiro_clique: new Date(sp('2026-10-05T15:00:00')).toISOString() }), cfg), 'mais4h', 'faixa > 4 h');
  eq(vlFaixa(L('l'), cfg), 'sem', 'sem contato registrado');

  // ==== TASK 4: card "Atender agora" ====
  const nowReal = Date.now;
  Date.now = () => sp('2026-10-05T10:00:00');
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  window.__tabelas.config = [{ chave: 'velocidade_lead', valor: '{"amarelo_min":15}' }];
  window.__rpcRespostas.meus_leads_vinculado = { data: true, error: null };
  window.__rpcRespostas.meus_leads_para_tratar = { data: [], error: null };
  window.__rpcRespostas.meu_placar_ligacoes = { data: [], error: null };
  window.__tabelas.leads_followups = [];
  const iso = (s) => new Date(sp(s)).toISOString();
  window.__rpcRespostas.meus_leads_relogio = { data: [
    L('verde', { criado_em_lead: iso('2026-10-05T09:58:00'), cidade: 'Cidade Teste', qtd_linhas: '3' }),
    L('verm', { criado_em_lead: iso('2026-10-05T09:00:00') }),
    L('feito', { primeiro_clique: iso('2026-10-05T09:01:00') }),
  ], error: null };
  await plCarregar();
  await vlCarregar(false);
  const card = document.getElementById('vlCard');
  assert(card && card.style.display !== 'none', 'consultor vinculado vê o card');
  eq([...document.querySelectorAll('#vlLista .vlRow')].map(r => r.dataset.leadId), ['verm', 'verde'], 'só quem espera, vermelho primeiro');
  assert(document.querySelector('#vlLista [data-lead-id="verm"] .vlRelogio').textContent.trim() === '1h 00min', 'relógio do vermelho');
  assert(document.querySelector('#vlLista [data-lead-id="verm"] .vlRelogio').classList.contains('atrasado'), 'vermelho usa a classe atrasado');
  assert(document.querySelector('#vlLista [data-lead-id="verde"]').textContent.includes('Cidade Teste'), 'mostra a cidade');
  const wa = document.querySelector('#vlLista [data-lead-id="verde"] a[data-vl-canal="whatsapp"]');
  assert(wa && wa.href.startsWith('https://wa.me/55'), 'botão WhatsApp com número');
  const txtWa = decodeURIComponent(wa.href.split('text=')[1]);
  assert(txtWa.includes('Claro Empresas') && !txtWa.includes('ficou em aberto'), 'mensagem de 1º contato (não a de resgatar)');
  assert(document.querySelector('#vlLista [data-lead-id="verde"] a[data-vl-canal="ligar"]').getAttribute('href').startsWith('tel:'), 'botão Ligar com tel:');

  // "Já falei com ele": registra 'manual' e o lead sai na hora
  window.__rpcCalls.length = 0;
  document.querySelector('#vlLista [data-lead-id="verde"] [data-vl-canal="manual"]').click();
  await espera(30);
  const reg = window.__rpcCalls.find(c => c.nome === 'registrar_contato_lead');
  eq(reg && reg.args, { p_aba: 'OUTUBRO', p_lead_id: 'verde', p_canal: 'manual' }, 'registra o contato manual');
  assert(!document.querySelector('#vlLista [data-lead-id="verde"]'), 'lead contatado sai da lista na hora');

  // erro ao registrar: o lead volta e aparece aviso de erro
  window.__rpcRespostas.registrar_contato_lead = { data: null, error: { message: 'falhou' } };
  window.__alertas.length = 0;
  document.querySelector('#vlLista [data-lead-id="verm"] [data-vl-canal="whatsapp"]').click();
  await espera(30);
  assert(document.querySelector('#vlLista [data-lead-id="verm"]'), 'erro: o lead volta para a lista');
  const avisosTxt = window.__alertas.join(' ') + ' ' + (document.getElementById('apexToasts') ? document.getElementById('apexToasts').textContent : '');
  assert(avisosTxt.includes('Não foi possível registrar o contato'), 'erro: aviso para tentar de novo');
  window.__rpcRespostas.registrar_contato_lead = { data: null, error: null };

  // vazio e erro de carga
  window.__rpcRespostas.meus_leads_relogio = { data: [L('x', { categoria: 'convertido' })], error: null };
  await vlCarregar(false);
  assert(document.getElementById('vlLista').textContent.includes('Nenhum lead esperando'), 'vazio: mensagem positiva');
  window.__rpcRespostas.meus_leads_relogio = { data: null, error: { message: 'x' } };
  await vlCarregar(false);
  assert(document.getElementById('vlLista').textContent.includes('Não foi possível carregar'), 'erro de carga no card');
  assert(!/NaN|undefined/.test(document.getElementById('vlCard').textContent), 'nada de NaN/undefined');

  // privacidade e troca de login
  assert(!window.__lidas.includes('ligacoes_manuais') && !window.__lidas.includes('leads_contatos'), 'consultor nunca lê ligacoes_manuais/leads_contatos');
  assert(!window.__rpcCalls.some(c => /^mesa_/.test(c.nome)), 'consultor nunca chama RPC da Mesa');
  vlIniciar();
  assert(vlEstado.timerPoll !== null, 'vlIniciar liga a recarga');
  vlResetar();
  assert(vlEstado.timerPoll === null && vlEstado.timerRender === null, 'vlResetar desliga os timers');
  assert(document.getElementById('vlCard').style.display === 'none' && document.getElementById('vlLista').innerHTML === '', 'vlResetar esconde e limpa o card');
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  window.__rpcCalls.length = 0;
  await vlCarregar(false);
  assert(!window.__rpcCalls.some(c => c.nome === 'meus_leads_relogio'), 'admin não carrega o card do consultor');
  Date.now = nowReal;

  // ==== TASK 5: WhatsApp da lista de baixo registra contato; aviso de lead novo ====
  Date.now = () => sp('2026-10-05T10:00:00');
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  window.__rpcRespostas.meus_leads_para_tratar = { data: [{ aba: 'OUTUBRO', lead_id: 'pl1', nome: 'Lead Teste PL', telefone: 'p:+5519900000011', status: 'EM NEGOCIACAO', categoria: 'andamento', criado_em_lead: '2026-10-04T12:00:00Z', tentativas: 0, atendidas: 0, ultima_ligacao: null, obs: '' }], error: null };
  window.__rpcRespostas.meus_leads_relogio = { data: [], error: null };
  await plCarregar();
  const plw = document.querySelector('#plLista .plWhats');
  assert(plw && plw.dataset.aba === 'OUTUBRO' && plw.dataset.leadId === 'pl1', 'plWhats leva aba e id');
  window.__rpcCalls.length = 0;
  plw.click();
  await espera(30);
  eq((window.__rpcCalls.find(c => c.nome === 'registrar_contato_lead') || {}).args, { p_aba: 'OUTUBRO', p_lead_id: 'pl1', p_canal: 'whatsapp' }, 'WhatsApp da lista registra contato');

  // aviso de lead novo: a 1ª carga só memoriza; a recarga com lead novo avisa
  window.__rpcRespostas.meus_leads_relogio = { data: [L('n1', { criado_em_lead: iso('2026-10-05T09:55:00') })], error: null };
  vlResetar();
  await vlCarregar(true);
  window.__alertas.length = 0;
  const toasts = () => [window.__alertas.join(' '), (document.getElementById('apexToasts') ? document.getElementById('apexToasts').textContent : '')].filter(Boolean).join(' ');
  const antes = toasts();
  window.__rpcRespostas.meus_leads_relogio = { data: [L('n1', { criado_em_lead: iso('2026-10-05T09:55:00') }), L('n2', { nome: 'Fulano Teste', criado_em_lead: iso('2026-10-05T09:59:00') })], error: null };
  await vlCarregar(true);
  const depois = toasts().replace(antes, '');
  assert(depois.includes('Lead novo: Fulano'), 'recarga avisa o lead novo');
  assert(!depois.includes('Lead Teste n1'.split(' ')[0] + ' — '), 'não avisa de novo o que já tinha visto');
  window.__alertas.length = 0;
  const antes2 = toasts();
  await vlCarregar(true);
  assert(!toasts().replace(antes2, '').includes('Lead novo'), 'sem lead novo, sem aviso');
  Date.now = nowReal;

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
