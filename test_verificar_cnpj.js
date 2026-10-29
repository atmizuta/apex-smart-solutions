// Testa o §127 (verificar CNPJ na Receita pela ficha do lead). Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md.
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
