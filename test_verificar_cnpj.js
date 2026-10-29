// Testa o §128 (verificar CNPJ na Receita pela ficha do lead). Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md.
// DADOS FICTÍCIOS (repo público).
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
  const OPC = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'AGENDADO RETORNO', grupo: 'andamento', ordem: 2 },
    { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  const F3 = { aba: 'OUTUBRO', lead_id: 'f3', nome: 'Zz Padaria', cidade: 'Campinas', uf: 'SP', qtd_linhas: '6', tipo_empresa: 'MEI', telefone: '11900000031',
    email: 'zz@teste.invalid', cnpj: '00.000.000/0001-31', status: 'AGENDADO RETORNO', categoria: 'andamento', obs: 'Zz ligar depois do almoço', campanha: 'Zz Campanha',
    criado_em_lead: '2026-10-24T09:14:00-03:00', livre: false, dono_nome: 'Zzkcon Teste', ligacoes: 3 };
  const BAIXADA = { situacao: 'BAIXADA', situacao_desde: '2024-03-12', motivo: 'EXTINCAO POR ENCERRAMENTO', consultado_em: '2026-10-29T14:32:00-03:00' };
  const ATIVA = { situacao: 'ATIVA', situacao_desde: '2020-01-02', motivo: null, consultado_em: '2026-10-29T14:32:00-03:00' };

  // ==== Task 3: funções puras ====
  eq(kbCnpjDigitos('00.000.000/0001-31'), '00000000000131', 'CNPJ só com dígitos');
  eq(['andamento', 'sem_contato', 'perdido', 'convertido'].map(c => kbCnpjMostra(Object.assign({}, F3, { categoria: c }))), [true, true, false, false],
     'botão em andamento e meus novos; não em perdido nem convertido');
  assert(kbCnpjMostra(Object.assign({}, F3, { categoria: 'andamento', ligacoes: 0 })), 'botão em Sem ligação');
  assert(!kbCnpjMostra(Object.assign({}, F3, { livre: true })) && !kbCnpjMostra(Object.assign({}, F3, { cnpj: '' })) && !kbCnpjMostra(Object.assign({}, F3, { venda_neo: true })),
     'sem botão em livre, sem CNPJ ou com venda no NEO');
  eq([ATIVA, { situacao: 'SUSPENSA' }, BAIXADA, { situacao: 'INAPTA' }, { situacao: 'NULA' }, { situacao: 'NAO_ENCONTRADO' }].map(c => (kbCnpjSelo(c) || {}).classe),
     ['ok', 'soon', 'late', 'late', 'late', 'late'], 'cor do selo por situação');
  assert(/^Ativa na Receita · consultado 29\\/10,? 14:32$/.test(kbCnpjSelo(ATIVA).texto), 'selo com a hora da consulta: ' + kbCnpjSelo(ATIVA).texto);
  eq(kbCnpjSelo({ situacao: 'NAO_ENCONTRADO' }).texto, 'CNPJ não existe na Receita: confira com o cliente', 'selo de não encontrado');
  eq([kbCnpjSelo(null), kbCnpjSelo({ situacao: 'XYZ' })], [null, null], 'sem consulta ou situação estranha: sem selo');
  eq(kbCnpjAviso(BAIXADA), { titulo: 'Empresa BAIXADA na Receita desde 12/03/2024', motivo: 'extincao por encerramento',
     texto: 'Confirme com o cliente se ele tem outro CNPJ ativo antes de seguir.' }, 'aviso de baixada com data e motivo');
  eq(kbCnpjAviso({ situacao: 'INAPTA', situacao_desde: null, motivo: null }).titulo, 'Empresa INAPTA na Receita', 'aviso sem data');
  eq([kbCnpjAviso(ATIVA), kbCnpjAviso({ situacao: 'SUSPENSA' }), kbCnpjAviso({ situacao: 'NAO_ENCONTRADO' }), kbCnpjAviso(null)], [null, null, null, null],
     'sem aviso para ativa, suspensa, não encontrado ou sem consulta');
  eq([kbCnpjMsgErro(403), kbCnpjMsgErro(422), kbCnpjMsgErro(503), kbCnpjMsgErro(undefined)],
     ['Só o dono do lead, o supervisor ou o admin podem verificar.', 'CNPJ inválido.',
      'Não foi possível consultar agora. Tente de novo em alguns minutos.', 'Não foi possível consultar agora. Tente de novo em alguns minutos.'], 'mensagens de erro');
  const h0 = kbCnpjHtml(F3, {});
  assert(h0.includes('data-kb-cnpj-verificar') && h0.includes('Verificar na Receita') && h0.includes('kbBtnP'), 'nunca verificado: botão destacado');
  assert(kbCnpjHtml(F3, { carregando: true }).includes('Consultando…') && !kbCnpjHtml(F3, { carregando: true }).includes('data-kb-cnpj-verificar'), 'consultando: sem botão clicável');
  const hB = kbCnpjHtml(F3, { consulta: BAIXADA, podeInapto: true });
  assert(hB.includes('kbTag late') && hB.includes('Verificar de novo') && hB.includes('kbFichaAviso') && hB.includes('desde 12/03/2024')
     && hB.includes('(motivo: extincao por encerramento)') && hB.includes('data-kb-cnpj-inapto'), 'baixada: selo vermelho, aviso e atalho');
  assert(!kbCnpjHtml(F3, { consulta: BAIXADA, podeInapto: false }).includes('data-kb-cnpj-inapto'), 'sem a opção CNPJ INAPTO: sem atalho');
  const hA = kbCnpjHtml(F3, { consulta: ATIVA, erro: kbCnpjMsgErro(503) });
  assert(hA.includes('kbTag ok') && !hA.includes('kbFichaAviso') && hA.includes('Não foi possível consultar agora'), 'erro ao reverificar mantém o selo e mostra a mensagem');
  eq(kbCnpjHtml(Object.assign({}, F3, { cnpj: '123.456.789-0' }), {}), '<span class="kbMeta">CNPJ inválido (10 dígitos)</span>', 'CNPJ sem 14 dígitos');
  eq(kbCnpjHtml(Object.assign({}, F3, { categoria: 'convertido' }), {}), '', 'convertido: nada');
  const hX = kbCnpjHtml(F3, { consulta: { situacao: 'BAIXADA', motivo: '<img src=x onerror=alert(1)>', situacao_desde: null, consultado_em: null } });
  assert(!hX.includes('<img'), 'motivo escapado');
  const fichaA = kbFichaHtml(F3, { gestor: false, agoraMs: Date.now(), opcoes: OPC });
  assert(fichaA.includes('id="kbCnpjRec"') && fichaA.includes('data-kb-cnpj-verificar'), 'ficha em andamento tem o bloco com o botão');
  assert(!kbFichaHtml(Object.assign({}, F3, { categoria: 'convertido' }), { gestor: false, agoraMs: Date.now(), opcoes: OPC }).includes('data-kb-cnpj-verificar'), 'ficha convertida sem botão');
  // ==== Task 4: ficha de verdade ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = OPC;
  window.__tabelas.cnpj_consultas = [];
  window.__rpcRespostas.leads_kanban3 = { data: [Object.assign({}, F3), Object.assign({}, F3, { lead_id: 'f4', nome: 'Zz Segundo', cnpj: '00000000000132' })], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({}, F3, { lead_id: a.p_id, nome: a.p_id === 'f4' ? 'Zz Segundo' : 'Zz Padaria' })], error: null });
  window.__rpcRespostas.leads_ficha_detalhes = { data: { anuncio: {}, resumo: { ligacoes: 3, atendidas: 1, cliques: 0, ultimo: null }, eventos: [] }, error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  kbTrocarAba('quadro');
  await espera(60);
  const rec = () => document.getElementById('kbCnpjRec');
  const invocacoes = [];
  let resposta = { data: { ok: true, consulta: BAIXADA }, error: null };
  sb.functions.invoke = async (nome, op) => { invocacoes.push({ nome, body: op && op.body }); return typeof resposta === 'function' ? resposta() : resposta; };
  // nunca verificado: botão, e abrir a ficha não chama a função
  await kbAbrirFicha('OUTUBRO', 'f3', { forcar: true });
  await espera(40);
  assert(rec() && rec().querySelector('[data-kb-cnpj-verificar]') && rec().textContent.includes('Verificar na Receita'), 'ficha nova mostra o botão');
  eq(invocacoes.length, 0, 'abrir a ficha não consulta a Receita');
  // clique: chama a função com aba e lead, pinta selo e aviso
  rec().querySelector('[data-kb-cnpj-verificar]').click();
  await espera(40);
  eq(invocacoes, [{ nome: 'verificar-cnpj', body: { aba: 'OUTUBRO', lead_id: 'f3' } }], 'clique chama verificar-cnpj com aba e lead_id (sem CNPJ)');
  assert(rec().textContent.includes('Baixada na Receita') && rec().textContent.includes('Empresa BAIXADA na Receita desde 12/03/2024'), 'selo e aviso de baixada');
  // atalho só preenche o status
  const nClass = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length;
  rec().querySelector('[data-kb-cnpj-inapto]').click();
  eq(document.getElementById('kbClassStatus').value, 'CNPJ INAPTO', 'atalho escolhe CNPJ INAPTO');
  assert(!document.querySelector('#kbFicha [data-kb-ficha-pane="classificar"]').hidden, 'atalho mostra a aba Classificar');
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length, nClass, 'atalho não salva');
  rec().querySelector('[data-kb-cnpj-inapto]').click();
  eq(document.getElementById('kbClassStatus').value, 'CNPJ INAPTO', 'clicar no atalho de novo não desfaz a escolha');
  // resultado salvo aparece ao abrir, sem consultar
  window.__tabelas.cnpj_consultas = [ATIVA];
  await kbAbrirFicha('OUTUBRO', 'f4', { forcar: true });
  await espera(40);
  assert(rec().textContent.includes('Ativa na Receita') && rec().textContent.includes('Verificar de novo'), 'consulta salva aparece ao abrir');
  eq(invocacoes.length, 1, 'abrir com consulta salva não chama a função');
  // erro ao verificar de novo: mantém o selo e mostra a mensagem
  resposta = { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: 503 } } };
  rec().querySelector('[data-kb-cnpj-verificar]').click();
  await espera(40);
  assert(rec().textContent.includes('Ativa na Receita') && rec().textContent.includes('Não foi possível consultar agora'), 'erro 503: selo fica e aparece a mensagem');
  resposta = { data: null, error: { message: 'x', context: { status: 403 } } };
  rec().querySelector('[data-kb-cnpj-verificar]').click();
  await espera(40);
  assert(rec().textContent.includes('Só o dono do lead'), 'erro 403: mensagem de permissão');
  // trocar de lead durante a consulta: o resultado não vai para o lead errado
  window.__tabelas.cnpj_consultas = [];
  let soltar;
  resposta = () => new Promise(r => { soltar = () => r({ data: { ok: true, consulta: BAIXADA }, error: null }); });
  rec().querySelector('[data-kb-cnpj-verificar]').click();
  await espera(10);
  await kbAbrirFicha('OUTUBRO', 'f3', { forcar: true });
  await espera(40);
  soltar();
  await espera(40);
  assert(kbEstado.fichaAlvo.id === 'f3' && !rec().textContent.includes('Baixada') && rec().querySelector('[data-kb-cnpj-verificar]'), 'resposta atrasada do outro lead não pinta esta ficha');
  // tabela ainda não criada: ficha abre normal com o botão
  const fromOrig = sb.from;
  sb.from = (t) => t === 'cnpj_consultas'
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'relation "cnpj_consultas" does not exist' } }) }) }) }
    : fromOrig(t);
  await kbAbrirFicha('OUTUBRO', 'f4', { forcar: true });
  await espera(40);
  assert(rec().querySelector('[data-kb-cnpj-verificar]') && document.getElementById('kbFichaResumo'), 'sem a tabela: ficha abre e o botão fica');
  sb.from = fromOrig;
  kbFecharFicha(true);
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
