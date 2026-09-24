// test_funil.js (23/09/2026, troca PDF->DOCX): generateProposalPDF() foi removida. Este teste só se
// importa com o EFEITO COLATERAL de registrar/mover o card no funil (registrarPropostaNoFunil), que
// no fluxo novo é chamado por generateProposalDocx() de forma SÍNCRONA, antes do await da parte
// assíncrona do docx (ver comentário em generateProposalDocx() no _template.html). Pra manter o teste
// isolado do que ele não testa (geração do .docx em si, coberta por test_pdf.js), chamamos direto
// buildPropostaDocModel() + registrarPropostaNoFunil(modelo.destaque.valorProposto, modelo.atual) em
// vez de generateProposalDocx() — é exatamente o mesmo efeito síncrono no funil, sem precisar mockar
// window.docx/downloadBlob aqui.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
global.window = window; // pra facilitar (não usado diretamente, mas ajuda debug)

// ---- Mock Supabase (query builder mínimo, o bastante pro fluxo do funil) ----
function mockCreateClient(){
  const db = {
    propostas: [],
    propostas_historico: [],
    profiles: [
      { id: 'u-consultor', nome: 'Consultor Teste', username: 'consultor' },
      { id: 'u-outro', nome: 'Outro Consultor', username: 'outro' },
    ],
    // vazios só pra não quebrar loadProducaoDashboard(), que agora é chamado automaticamente por
    // enterApp() (Dashboard de Produção virou a página inicial pós-login — ver seção 16.6 do
    // REGRAS_NEGOCIO.md). Este teste não exercita o dashboard de produção em si (isso já é coberto
    // por test_dashboard_producao.js e test_reorganizacao_abas.js).
    producao_pedidos: [],
    config: [],
  };
  window.__mockDB = db;

  function builder(table){
    let filters = [];
    let pendingInsert = null;
    let pendingUpdate = null;
    let wantSingle = false;
    const b = {
      select(){ return b; },
      order(){ return b; },
      eq(col, val){ filters.push([col, val]); return b; },
      single(){ wantSingle = true; return b; },
      maybeSingle(){ wantSingle = true; return b; },
      insert(obj){ pendingInsert = obj; return b; },
      update(obj){ pendingUpdate = obj; return b; },
      then(resolve, reject){
        try{
          let result;
          if(pendingInsert){
            const row = Object.assign({ id: 'id-' + Math.random().toString(36).slice(2) }, pendingInsert);
            db[table].push(row);
            result = { data: wantSingle ? row : [row], error: null };
          } else if(pendingUpdate){
            let matched = db[table];
            filters.forEach(([col, val]) => { matched = matched.filter(r => r[col] === val); });
            matched.forEach(r => Object.assign(r, pendingUpdate));
            result = { data: matched, error: null };
          } else {
            let matched = db[table];
            filters.forEach(([col, val]) => { matched = matched.filter(r => r[col] === val); });
            result = wantSingle ? { data: matched[0] || null, error: null } : { data: matched, error: null };
          }
          resolve(result);
        }catch(e){ resolve({ data: null, error: { message: e.message } }); }
        return Promise.resolve();
      },
      catch(){ return b; },
    };
    return b;
  }

  return {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => {},
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({}),
    },
    from: (table) => builder(table),
    functions: { invoke: async () => ({ data: {}, error: null }) },
  };
}
window.supabase = { createClient: mockCreateClient };
window.alert = (m) => { throw new Error('ALERT INESPERADO: ' + m); };
window.confirm = () => true;

const testScript = `
(async () => {
  const assert = (cond, msg) => { if(!cond) throw new Error('FALHOU: ' + msg); console.log('OK:', msg); };

  // gera a proposta + registra/move o card no funil, sem exercitar a geração do .docx em si (coberta
  // por test_pdf.js) — mesmo efeito síncrono que generateProposalDocx() produz antes do await.
  function gerarPropostaEregistrar(){
    const modelo = buildPropostaDocModel();
    registrarPropostaNoFunil(modelo.destaque.valorProposto, modelo.atual);
  }

  // ---- slaStatus / tempoDecorrido (funções puras) ----
  const agora = new Date().toISOString();
  const h25 = new Date(Date.now() - 25*3600000).toISOString();
  const h5 = new Date(Date.now() - 5*3600000).toISOString();
  assert(slaStatus({estagio:'proposta_enviada', estagio_entrada_em:h25}).estourado === true, 'SLA estourado com 25h em Proposta Enviada');
  assert(slaStatus({estagio:'proposta_enviada', estagio_entrada_em:h5}).estourado === false, 'SLA ok com 5h em Proposta Enviada');
  assert(slaStatus({estagio:'lead', estagio_entrada_em:h25}) === null, 'Lead não tem SLA');
  assert(slaStatus({estagio:'fechado_ganho', estagio_entrada_em:h25}) === null, 'Fechado/Ganho não tem SLA');

  // ---- login simulado (consultor) ----
  currentUser = { id: 'u-consultor', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  enterApp();
  await new Promise(r => setTimeout(r, 20));
  assert(Array.isArray(funilCache), 'funilCache inicializado após enterApp');
  assert(document.getElementById('dashFunil').style.display === 'none', 'Dash escondido quando não há cards ainda');

  // ---- gerar proposta pro cliente da base -> deve criar card em Proposta Enviada ----
  const clienteBase = {
    razao_social: 'CLIENTE FUNIL TESTE LTDA', cnpj: '11.222.333/0001-44', cidade: 'São Paulo', ddd: '11',
    linhas_voz: 5, valor_contrato: 900, arpu: 180, cep_cabeado: '01000-000',
  };
  openProposal(clienteBase, {});
  gerarPropostaEregistrar();
  await new Promise(r => setTimeout(r, 20));
  assert(window.__mockDB.propostas.length === 1, 'Card criado no funil após gerar proposta');
  const card1 = window.__mockDB.propostas[0];
  assert(card1.estagio === 'proposta_enviada', 'Card entra direto em Proposta Enviada');
  assert(card1.consultor_id === 'u-consultor', 'Card pertence ao consultor logado');
  assert(window.__mockDB.propostas_historico.length === 1, 'Movimentação registrada no histórico');
  assert(proposalState.propostaId === card1.id, 'proposalState guarda o id do card criado');

  // ---- gerar uma SEGUNDA proposta pro MESMO card (reabrindo a partir do funil) ----
  await loadFunil();
  abrirPropostaDoCard(card1);
  assert(proposalState.propostaId === card1.id, 'Reabrir do card mantém o mesmo propostaId');
  gerarPropostaEregistrar();
  await new Promise(r => setTimeout(r, 20));
  assert(window.__mockDB.propostas.length === 1, 'Gerar de novo a partir do card NÃO duplica o card');
  assert(window.__mockDB.propostas_historico.length === 2, 'Segunda geração também vira uma movimentação no histórico');

  // ---- mover card manualmente (negociação) ----
  await loadFunil();
  await moverCard(card1.id, 'negociacao');
  assert(card1.estagio === 'negociacao', 'moverCard atualiza o estágio local (via funilCache)');
  assert(window.__mockDB.propostas_historico.length === 3, 'Mover pra negociação grava histórico');

  // ---- mover pra Fechado/Perdido sem nota definida -> deve abrir modal, NÃO deve mover ainda ----
  await moverCard(card1.id, 'fechado_perdido');
  assert(document.getElementById('motivoOverlay').classList.contains('active'), 'Modal de motivo abre ao mover pra perdido');
  assert(card1.estagio === 'negociacao', 'Card não muda de estágio antes de confirmar o motivo');
  // confirma com motivo
  await moverCard(card1.id, 'fechado_perdido', 'Cliente ficou com a operadora atual');
  assert(card1.estagio === 'fechado_perdido', 'Card vai pra Fechado/Perdido após confirmar motivo');
  assert(card1.motivo_perda === 'Cliente ficou com a operadora atual', 'Motivo da perda é salvo');

  // ---- reabrir negociação a partir de Fechado/Perdido (nova proposta) volta pra Proposta Enviada ----
  abrirPropostaDoCard(card1);
  gerarPropostaEregistrar();
  await new Promise(r => setTimeout(r, 20));
  assert(card1.estagio === 'proposta_enviada', 'Nova proposta a partir de card perdido volta pra Proposta Enviada');

  // ---- novo lead manual ----
  await loadFunil();
  document.getElementById('btnNovoLead').click();
  assert(document.getElementById('leadOverlay').classList.contains('active'), 'Modal de novo lead abre');
  document.getElementById('leadNome').value = 'PROSPECT LEAD TESTE';
  document.getElementById('leadDdd').value = '21';
  document.getElementById('leadValor').value = '800,00';
  document.getElementById('btnSalvarLead').click();
  await new Promise(r => setTimeout(r, 20));
  assert(window.__mockDB.propostas.length === 2, 'Lead manual cria um novo card');
  const leadCard = window.__mockDB.propostas.find(p => p.cliente_nome === 'PROSPECT LEAD TESTE');
  assert(!!leadCard, 'Card do lead encontrado');
  assert(leadCard.estagio === 'lead', 'Lead manual entra no estágio Lead');
  assert(leadCard.origem === 'lead', 'Origem do card marcada como lead');

  // ---- gerar proposta a partir do lead -> devia reusar o mesmo card, indo pra Proposta Enviada ----
  await loadFunil();
  abrirPropostaDoCard(leadCard);
  assert(proposalState.avulsa === true, 'Lead abre no fluxo avulsa');
  gerarPropostaEregistrar();
  await new Promise(r => setTimeout(r, 20));
  assert(window.__mockDB.propostas.length === 2, 'Gerar proposta a partir do lead não cria card duplicado');
  assert(leadCard.estagio === 'proposta_enviada', 'Card do lead avança pra Proposta Enviada');

  // ---- dashboard mostra as contagens certas pro consultor ----
  await loadFunil();
  renderDashFunil();
  assert(document.getElementById('dashFunil').style.display === 'block', 'Dash aparece quando o consultor tem cards');
  const statsHtml = document.getElementById('dashFunilStats').innerHTML;
  assert(statsHtml.includes('Proposta Enviada'), 'Dash mostra a coluna Proposta Enviada');

  // ---- visão admin: vê cards de outro consultor também, com nome dele no card ----
  window.__mockDB.propostas.push({
    id: 'card-outro', consultor_id: 'u-outro', cliente_nome: 'CLIENTE DE OUTRO CONSULTOR',
    origem: 'base', tipo_proposta: 'renovacao', valor_atual: 500, valor_proposto: 480,
    estagio: 'negociacao', estagio_entrada_em: new Date().toISOString(),
    criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
  });
  currentUser = { id: 'u-admin', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  await loadFunil();
  assert(funilCache.length === 3, 'Admin vê todos os cards (mock não filtra por RLS, mas o app não filtra client-side também)');
  assert(document.getElementById('funilFilterWrap').style.display !== 'none', 'Filtro de consultor aparece pro admin');
  const opts = Array.from(document.getElementById('funilFiltroConsultor').options).map(o => o.textContent);
  assert(opts.includes('Consultor Teste') && opts.includes('Outro Consultor'), 'Filtro lista os dois consultores');
  renderFunil();
  assert(document.getElementById('kanbanWrap').innerHTML.includes('Outro Consultor'), 'Card mostra o nome do consultor dono (admin)');
  assert(document.getElementById('dashFunil').style.display === 'none', 'Dash da tela de entrada fica escondido pro admin (visão consolidada fica na aba Funil)');

  console.log('TODOS OS TESTES DO FUNIL PASSARAM');
})().catch(e => { console.log('ERRO:', e.message); console.log(e.stack); process.exitCode = 1; });
`;

window.eval(jsCode + testScript);
