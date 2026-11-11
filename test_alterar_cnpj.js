// Testa a §147 (alterar o CNPJ do lead na ficha). Spec: docs/superpowers/specs/2026-11-10-alterar-cnpj-design.md.
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
  const OPC = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }];
  // CNPJs fictícios de exemplo (válidos pelo DV, não são de clientes)
  const NOVO = '11222333000181', OUTRO = '11444777000161';
  const F = { aba: 'OUTUBRO', lead_id: 'c1', nome: 'Zz Oficina', cidade: 'Campinas', uf: 'SP', qtd_linhas: '4', tipo_empresa: 'MEI', telefone: '11900000041',
    email: 'zz@teste.invalid', cnpj: '00.000.000/0001-41', status: 'EM NEGOCIAÇÂO', categoria: 'andamento', obs: '', campanha: 'Zz Campanha',
    criado_em_lead: '2026-10-24T09:14:00-03:00', livre: false, dono_id: 'u-zz', dono_nome: 'Zzkcon Teste', ligacoes: 1 };

  // ==== funções puras ====
  eq([NOVO, OUTRO, '11.222.333/0001-81', '11222333000182', '00000000000000', '1122233300018', '', null].map(kbCnpjValido),
     [true, true, true, false, false, false, false, false], 'validação do CNPJ (DV, tamanho, repetido)');
  eq(['1', '1122', '11222333', '112223330', '1122233300018', NOVO, NOVO + '9', '11.222.333/0001-81'].map(kbCnpjMascara),
     ['1', '11.22', '11.222.333', '11.222.333/0', '11.222.333/0001-8', '11.222.333/0001-81', '11.222.333/0001-81', '11.222.333/0001-81'], 'máscara ao digitar');
  eq([kbCnpjPodeAlterar(F, false, 'u-zz'), kbCnpjPodeAlterar(F, false, 'u-outro'), kbCnpjPodeAlterar(F, true, 'u-outro'),
      kbCnpjPodeAlterar(Object.assign({}, F, { livre: true }), true, 'u-zz'), kbCnpjPodeAlterar(Object.assign({}, F, { dono_id: null }), true, 'u-zz'),
      kbCnpjPodeAlterar(F, false, null), kbCnpjPodeAlterar(null, true, 'u-zz')],
     [true, false, true, false, false, false, false], 'quem pode: dono ou gestor; nunca livre ou sem dono');
  const lPode = kbCnpjLinhaHtml(F, true), lNao = kbCnpjLinhaHtml(F, false);
  assert(lPode.includes('data-kb-ficha-copiar="00.000.000/0001-41"') && lPode.includes('data-kb-cnpj-alterar') && lPode.includes('>Alterar<'), 'com CNPJ e pode: Copiar e Alterar');
  assert(lNao.includes('data-kb-ficha-copiar') && !lNao.includes('data-kb-cnpj-alterar'), 'sem permissão: só Copiar');
  const sem = Object.assign({}, F, { cnpj: '' });
  assert(kbCnpjLinhaHtml(sem, true).includes('>Adicionar<') && kbCnpjLinhaHtml(sem, true).includes('<b>—</b>'), 'sem CNPJ e pode: Adicionar');
  eq(kbCnpjLinhaHtml(sem, false), '', 'sem CNPJ e sem permissão: nada (como antes)');
  assert(!kbCnpjLinhaHtml(Object.assign({}, F, { cnpj: '<img src=x>' }), true).includes('<img'), 'CNPJ escapado');
  eq(kbCnpjAltLer('11.222.333', 'Cliente digitou errado', '', F.cnpj), { erro: 'O CNPJ tem 14 números (você digitou 8).' }, 'erro: tamanho');
  eq(kbCnpjAltLer('11222333000182', 'Cliente digitou errado', '', F.cnpj), { erro: 'CNPJ inválido: confira os números.' }, 'erro: DV');
  eq(kbCnpjAltLer('11.222.333/0001-81', 'Cliente digitou errado', '', NOVO), { erro: 'Este já é o CNPJ do lead.' }, 'erro: igual ao atual (com ou sem pontuação)');
  eq(kbCnpjAltLer(NOVO, '', '', F.cnpj), { erro: 'Escolha o motivo.' }, 'erro: sem motivo');
  eq(kbCnpjAltLer(NOVO, 'outro', ' a ', F.cnpj), { erro: 'Escreva o motivo (pelo menos 3 letras).' }, 'erro: outro motivo curto');
  eq(kbCnpjAltLer('11.222.333/0001-81', 'Cliente fechou em outro CNPJ', '', F.cnpj), { cnpj: NOVO, motivo: 'Cliente fechou em outro CNPJ' }, 'ok: motivo da lista, só dígitos');
  eq(kbCnpjAltLer(NOVO, 'outro', '  sócio pediu  ', ''), { cnpj: NOVO, motivo: 'sócio pediu' }, 'ok: outro motivo, lead sem CNPJ');
  const fh = kbFichaHtml(F, { gestor: false, agoraMs: Date.now(), opcoes: OPC, podeAlterarCnpj: true });
  assert(fh.includes('id="kbCnpjAlt"') && fh.includes('data-kb-cnpj-alterar') && fh.includes('data-kb-ficha-copiar="zz@teste.invalid"'), 'ficha: e-mail, CNPJ com Alterar e bloco escondido');
  assert(!kbFichaHtml(F, { gestor: false, agoraMs: Date.now(), opcoes: OPC }).includes('data-kb-cnpj-alterar'), 'ficha sem permissão: sem Alterar');

  // ==== ficha de verdade ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = OPC;
  window.__tabelas.cnpj_consultas = [];
  window.__rpcRespostas.leads_kanban3 = { data: [Object.assign({}, F), Object.assign({}, F, { lead_id: 'c2', nome: 'Zz Outro Dono', dono_id: 'u-outro', dono_nome: 'Zz Outro' })], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_conferir_neo = { data: [], error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({}, F, a.p_id === 'c2' ? { lead_id: 'c2', dono_id: 'u-outro' } : {})], error: null });
  window.__rpcRespostas.leads_ficha_detalhes = { data: { anuncio: {}, resumo: { ligacoes: 1, atendidas: 0, cliques: 0, ultimo: null }, eventos: [] }, error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  kbTrocarAba('quadro');
  await espera(60);
  const fx = (sel) => document.querySelector('#kbFicha ' + sel);
  const chamadas = (n) => window.__rpcCalls.filter(c => c.nome === n);

  // lead de outro dono: sem Alterar
  await kbAbrirFicha('OUTUBRO', 'c2', { forcar: true });
  await espera(40);
  assert(fx('.kbFichaOutros') && !fx('[data-kb-cnpj-alterar]'), 'consultor não vê Alterar no lead de outro');

  // lead dele: abre o bloco
  await kbAbrirFicha('OUTUBRO', 'c1', { forcar: true });
  await espera(40);
  assert(fx('#kbCnpjAlt').hidden, 'bloco começa escondido');
  fx('[data-kb-cnpj-alterar]').click();
  assert(!fx('#kbCnpjAlt').hidden && fx('#kbCnpjAltNovo') && fx('#kbCnpjAltMotivo') && fx('#kbCnpjAltOutro').hidden, 'Alterar abre o bloco com CNPJ e motivo');
  // máscara
  const novo = fx('#kbCnpjAltNovo');
  novo.value = NOVO;
  novo.dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(novo.value, '11.222.333/0001-81', 'máscara aplicada ao digitar');
  // motivo "Outro" mostra o campo
  const mot = fx('#kbCnpjAltMotivo');
  mot.value = 'outro'; mot.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(!fx('#kbCnpjAltOutro').hidden, 'Outro mostra o campo de texto');
  // erro de validação não chama o banco
  fx('[data-kb-cnpj-alt-salvar]').click();
  await espera(20);
  eq(fx('#kbCnpjAltErro').textContent, 'Escreva o motivo (pelo menos 3 letras).', 'erro aparece na linha');
  eq(chamadas('leads_alterar_cnpj').length, 0, 'erro não chama o banco');
  // erro do banco: mostra a mensagem e mantém o CNPJ
  mot.value = 'Cliente digitou errado'; mot.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(fx('#kbCnpjAltOutro').hidden && fx('#kbCnpjAltErro').textContent === '', 'trocar o motivo esconde o Outro e limpa o erro');
  window.__rpcRespostas.leads_alterar_cnpj = { data: null, error: { message: 'sem permissão' } };
  fx('[data-kb-cnpj-alt-salvar]').click();
  await espera(30);
  eq(fx('#kbCnpjAltErro').textContent, 'sem permissão', 'erro do banco na linha');
  assert(fx('.kbFichaOutros').textContent.includes('00.000.000/0001-41'), 'erro mantém o CNPJ antigo');
  // sucesso: OBS digitada fica, linha atualiza, histórico e conferência recarregam
  fx('#kbClassObs').value = 'Zz anotação não salva';
  kbEstado.neo = [];   // a visão Conferir com NEO já tinha sido aberta
  const nDet = chamadas('leads_ficha_detalhes').length, nNeo = chamadas('leads_conferir_neo').length, nFicha = chamadas('leads_ficha').length;
  window.__rpcRespostas.leads_alterar_cnpj = { data: NOVO, error: null };
  fx('[data-kb-cnpj-alt-salvar]').click();
  await espera(40);
  eq(chamadas('leads_alterar_cnpj').slice(-1)[0].args, { p_aba: 'OUTUBRO', p_id: 'c1', p_cnpj: NOVO, p_motivo: 'Cliente digitou errado' }, 'RPC com 14 dígitos e o motivo');
  assert(fx('.kbFichaOutros').textContent.includes(NOVO) && fx('[data-kb-ficha-copiar="' + NOVO + '"]') && fx('[data-kb-cnpj-alterar]'), 'linha mostra o CNPJ novo com Copiar e Alterar');
  assert(fx('#kbCnpjAlt').hidden && fx('#kbCnpjAlt').innerHTML === '', 'bloco fecha');
  eq(fx('#kbClassObs').value, 'Zz anotação não salva', 'ficha não reabre: OBS digitada fica');
  eq(chamadas('leads_ficha').length, nFicha, 'não chama leads_ficha de novo');
  assert(chamadas('leads_ficha_detalhes').length > nDet, 'histórico recarrega');
  assert(chamadas('leads_conferir_neo').length > nNeo, 'Conferir com NEO recarrega');
  eq(kbEstado.fichaLead.cnpj, NOVO, 'ficha em memória com o CNPJ novo');
  const naLista = [].concat(kbEstado.todos || [], kbEstado.leads || []).filter(l => l.lead_id === 'c1');
  assert(naLista.length > 0 && naLista.every(l => l.cnpj === NOVO), 'lista em memória com o CNPJ novo');
  eq(window.__alertas, ['CNPJ alterado.'], 'aviso de sucesso (no jsdom o mostrarAviso cai no alert)');
  // Cancelar fecha sem salvar
  fx('[data-kb-cnpj-alterar]').click();
  fx('[data-kb-cnpj-alt-cancelar]').click();
  assert(fx('#kbCnpjAlt').hidden, 'Cancelar fecha o bloco');
  kbFecharFicha(true);

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
