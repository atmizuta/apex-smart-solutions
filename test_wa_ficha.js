// Testa a §167 no painel (selo 📱 e bloco Ficha do WhatsApp). Spec: docs/superpowers/specs/2026-11-24-whatsapp-agente-noturno-design.md.
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
  storage: { from: (b) => ({ createSignedUrl: async (c, s) => { window.__assinados.push([b, c, s]); return { data: { signedUrl: 'https://zz.invalid/doc' }, error: null }; } }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.__alertas = [];
window.__assinados = []; window.__abertos = []; window.open = (u) => { window.__abertos.push(u); return null; };
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
  const divs = (h) => [(h.match(/<div\\b/g) || []).length, (h.match(/<\\/div>/g) || []).length];
  const OPC = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }];
  const F = { aba: 'OUTUBRO', lead_id: 'c1', nome: 'Zz Oficina', cidade: 'Campinas', uf: 'SP', qtd_linhas: '4', tipo_empresa: 'MEI', telefone: '00900000001',
    email: 'zz@teste.invalid', cnpj: '', status: 'EM NEGOCIAÇÂO', categoria: 'andamento', obs: '', campanha: 'Zz Campanha',
    criado_em_lead: '2026-10-24T09:14:00-03:00', livre: false, dono_id: 'u-zz', dono_nome: 'Zzkcon Teste', ligacoes: 1 };
  const W = { estado: 'pronto', alertas: ['Migração sem fatura nem comprovante de recarga'], motivo: null,
    ficha: { nome: 'Zz Teste Silva', cpf: '52998224725', cnpj: '11222333000181', servicos: ['moveis', 'fibra'],
      moveis: { total: 3, partes: [{ modalidade: 'portabilidade', quantidade: 2, numeros: ['00900000001', '00900000002'] }, { modalidade: 'nova', quantidade: 1 }] },
      velocidade: '1000', cep: '00000000', numero_endereco: '10' },
    documentos: [{ tipo: 'fatura', caminho: 'm/zzw1.jpg', mime: 'image/jpeg' }, { tipo: 'cnh', caminho: 'm/zzw2.pdf', mime: 'application/pdf' }] };

  // ==== funções puras ====
  assert(kbWaSeloHtml('pronto').includes('badge apto') && kbWaSeloHtml('pronto').includes('📱 Pronto para subir'), 'selo pronto (verde de ganho)');
  assert(kbWaSeloHtml('precisa_humano').includes('badge naoapto') && kbWaSeloHtml('precisa_humano').includes('Precisa de humano'), 'selo humano');
  assert(kbWaSeloHtml('em_andamento').includes('class="badge"') && kbWaSeloHtml('em_andamento').includes('Em andamento'), 'selo em andamento');
  eq([kbWaSeloHtml('encerrada'), kbWaSeloHtml(undefined)], ['', ''], 'sem selo para encerrada/sem conversa');
  const h = kbWaFichaHtml(W);
  ['Ficha do WhatsApp', 'Zz Teste Silva', '52998224725', '11222333000181', 'Linhas móveis, Internet fixa', '3 no total: 2 Portabilidade (00900000001, 00900000002) · 1 Linha nova',
   '1 Giga', 'CEP 00000000, nº 10', 'data-kb-wa-doc="m/zzw1.jpg"', '>Fatura<', '>CNH<', '⚠ Migração sem fatura'].forEach(t => assert(h.includes(t), 'bloco mostra: ' + t));
  eq(divs(h)[0], divs(h)[1], 'bloco com divs balanceadas');
  eq(kbWaFichaHtml(null), '', 'sem conversa: nada');
  const x = kbWaFichaHtml({ estado: 'precisa_humano', motivo: '<b>cancelar</b>', alertas: [], ficha: { nome: '<img src=x>' }, documentos: [] });
  assert(!x.includes('<img') && !x.includes('<b>cancelar') && x.includes('Precisa de humano: &lt;b&gt;cancelar'), 'tudo escapado + motivo do humano');
  const fh = kbFichaHtml(F, { gestor: false, agoraMs: Date.now(), opcoes: OPC });
  assert(fh.includes('id="kbFichaWa"'), 'ficha tem o lugar do bloco');
  eq(divs(fh)[0], divs(fh)[1], 'ficha continua com divs balanceadas');

  // ==== cartão e ficha de verdade ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = OPC;
  window.__tabelas.cnpj_consultas = [];
  window.__rpcRespostas.leads_kanban3 = { data: [Object.assign({}, F), Object.assign({}, F, { lead_id: 'c2', nome: 'Zz Sem Whats' })], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_conferir_neo = { data: [], error: null };
  window.__rpcRespostas.wa_selos = { data: [{ aba: 'OUTUBRO', lead_id: 'c1', estado: 'pronto' }], error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({}, F, { lead_id: a.p_id })], error: null });
  window.__rpcRespostas.leads_ficha_detalhes = { data: { anuncio: {}, resumo: { ligacoes: 1, atendidas: 0, cliques: 0, ultimo: null }, eventos: [] }, error: null };
  window.__rpcRespostas.wa_ficha = (a) => ({ data: a.p_id === 'c1' ? W : null, error: null });
  await kbAplicarPermissao();
  await kbCarregar();
  kbTrocarAba('quadro');
  await espera(60);
  const card = (id) => document.querySelector('.kbCard[data-id="' + id + '"]');
  assert(card('c1') && card('c1').innerHTML.includes('📱 Pronto para subir'), 'cartão com selo');
  assert(card('c2') && !card('c2').innerHTML.includes('📱'), 'cartão sem conversa: sem selo');
  kbEstado.waSelos = { 'OUTUBRO|c9': 'em_andamento' };
  const livre = kbCard(Object.assign({}, F, { lead_id: 'c9', livre: true, dono_id: null, categoria: 'sem_contato', status: '' }), Date.now());
  assert(livre.includes('📱 Em andamento'), 'selo também no cartão dos Livres');

  const fx = (sel) => document.querySelector('#kbFicha ' + sel);
  await kbAbrirFicha('OUTUBRO', 'c1', { forcar: true });
  await espera(60);
  assert(fx('#kbFichaWa') && !fx('#kbFichaWa').hidden && fx('#kbFichaWa').textContent.includes('Ficha do WhatsApp'), 'ficha mostra o bloco');
  fx('[data-kb-wa-doc="m/zzw1.jpg"]').click();
  await espera(30);
  eq(window.__assinados, [['wa-documentos', 'm/zzw1.jpg', 300]], 'link temporário de 5 min do bucket privado');
  eq(window.__abertos, ['https://zz.invalid/doc'], 'abre o documento');
  kbFecharFicha(true);
  await kbAbrirFicha('OUTUBRO', 'c2', { forcar: true });
  await espera(60);
  assert(fx('#kbFichaWa') && fx('#kbFichaWa').hidden, 'lead sem conversa: bloco escondido');
  kbFecharFicha(true);

  // ==== avisos na faixa da Equipe ====
  const fx2 = kbFaixaDistribHtml({ cfg: { modo: 'automatico' }, aviso: { wa_erro: { em: new Date().toISOString(), erro: 'claude' }, wa_sem_mensagens: { em: new Date().toISOString() } }, consultores: [] });
  assert(fx2.includes('assistente do WhatsApp teve erro'), 'aviso de erro do agente');
  assert(fx2.includes('abra o WhatsApp Business no celular'), 'aviso de conexão caída');
  const fx3 = kbFaixaDistribHtml({ cfg: { modo: 'automatico' }, aviso: { wa_erro: { em: '2026-01-01T00:00:00Z' } }, consultores: [] });
  assert(!fx3.includes('assistente do WhatsApp'), 'erro antigo (mais de 24 h) some');

  // ==== outra aba continua no lugar (memória: divs balanceadas) ====
  kbTrocarAba('lista');
  await espera(30);
  kbTrocarAba('quadro');
  await espera(30);
  assert(card('c1'), 'troca de aba e volta: quadro no lugar');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
