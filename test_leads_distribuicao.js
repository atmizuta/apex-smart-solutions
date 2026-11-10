// Testa a §146.1 (distribuição automática de leads: presença, clique no telefone, faixa Distribuição na Equipe).
// DADOS FICTÍCIOS — o repositório é público.
const { montarPainel } = require('./painel_teste_base.js');
const { rodar } = montarPainel();
rodar(`
  const chamadas = (nome) => window.__rpcCalls.filter(c => c.nome === nome);
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };

  // ==== presença ====
  kbEstado.naEquipe = false;
  window.__rpcCalls.length = 0;
  eq(await kbPresencaPing(), null, 'fora da equipe não manda presença');
  eq(chamadas('leads_presenca_ping').length, 0, 'nenhuma chamada fora da equipe');
  kbEstado.naEquipe = true;
  window.__rpcRespostas.leads_presenca_ping = { data: { equipe: true, pausa_ate: null }, error: null };
  await kbPresencaPing();
  eq(chamadas('leads_presenca_ping').map(c => c.args), [{ p_acao: null }], 'ping comum manda p_acao nulo');
  eq(kbEstado.presenca, { equipe: true, pausa_ate: null }, 'guarda a presença');
  window.__rpcRespostas.leads_presenca_ping = { data: null, error: { message: 'function does not exist' } };
  await kbPresencaPing();
  eq(kbEstado.presenca, { equipe: true, pausa_ate: null }, 'erro do banco (função ainda não existe) não apaga nem quebra');
  kbAgendar();
  assert(kbEstado.timerPresenca, 'kbAgendar liga o timer de presença');
  kbParar();
  eq(kbEstado.timerPresenca, null, 'kbParar desliga o timer de presença');

  // ==== clique no telefone: o registro 'ligar' é feito pelo data-kb-contato dos botões; kbLigar NÃO chama de novo (revisão I-5) ====
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.registrar_contato_lead = { data: null, error: null };
  await kbLigar('(11) 90000-0001', { aba: 'NOVEMBRO', lead_id: 'L1', dono_id: 'c1', telefone: '(11) 90000-0001' });
  await espera();
  eq(chamadas('registrar_contato_lead').length, 0, 'kbLigar não duplica o registro do clique');

  // ==== faixa Distribuição ====
  eq(kbFaixaDistribHtml(null), '', 'sem dados (banco sem a função): faixa some');
  const D = { cfg: { modo: 'sombra', peso_conversao: 0.5, piso: 0.15, teto: 0.4, prazo_atender_min: 5, prazo_devolver_min: 15 },
    aviso: { robo_parado: '2026-11-10T16:00:00Z', parados: [{ aba: 'NOVEMBRO', id: 'L9', em: new Date().toISOString() }] },
    no_expediente: true, fila: 2,
    consultores: [
      { consultor_id: 'c1', nome: 'Zz Ana Teste', ativo: true, estado: 'na_vez', conv: 0.18, vel: 0.62, nota: 1.12, fatia: 0.32, recebidos_hoje: 5, vel_n: 10, vel_ok: 7, devolvidos_hoje: 0, clicou_nao_ligou: 0, teria: 6, recebeu: 4 },
      { consultor_id: 'c2', nome: 'Zz Beto Teste', ativo: false, estado: 'offline', conv: 0.15, vel: 0.2, nota: 0.8, fatia: null, recebidos_hoje: 0, vel_n: 3, vel_ok: 0, devolvidos_hoje: 1, clicou_nao_ligou: 2, teria: 0, recebeu: 1 },
    ] };
  const h = kbFaixaDistribHtml(D);
  assert(h.includes('Distribuição: Sombra'), 'mostra o modo');
  assert(h.includes('data-kb-dist-modo="manual"') && h.includes('data-kb-dist-modo="sombra"'), 'botões Manual e Sombra');
  assert(/data-kb-dist-modo="automatico"[^>]*disabled/.test(h), 'Automático desabilitado na §146.1');
  assert(h.includes('32%') && h.includes('7 de 10'), 'fatia e rápidos na tabela');
  assert(h.includes('Na vez') && h.includes('Fora do painel'), 'estados escritos');
  assert(h.includes('kbDistAlerta') && h.includes('>2<'), 'clicou e não ligou em destaque');
  assert(h.includes('6') && h.includes('teria'), 'sombra: teria × recebeu');
  assert(h.includes('ProContact') && h.includes('L9') === false, 'aviso do robô parado; id do lead não aparece');
  assert(h.includes('1 lead parou') || h.includes('1 leads pararam') || h.includes('parou de circular'), 'aviso de lead parado');
  assert(!h.includes('<script'), 'sem script');
  const hEsc = kbFaixaDistribHtml(Object.assign({}, D, { consultores: [Object.assign({}, D.consultores[0], { nome: '<b>X</b>' })] }));
  assert(hEsc.includes('&lt;b&gt;X&lt;/b&gt;'), 'nome escapado');

  // ==== mudar modo e salvar parâmetros ====
  currentUser = { id: 'g1', nome: 'Gestor Teste', username: 'gest', role: 'admin' };
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.leads_dist_config = (a) => ({ data: Object.assign({}, D.cfg, a.p), error: null });
  window.__rpcRespostas.leads_dist_equipe = { data: D, error: null };
  await kbDistModo('manual');
  eq(chamadas('leads_dist_config').map(c => c.args), [{ p: { modo: 'manual' } }], 'muda o modo');
  await kbDistModo('automatico');
  eq(chamadas('leads_dist_config').length, 1, 'automático não é enviado na §146.1');
  window.__rpcCalls.length = 0;
  await kbDistSalvarCfg({ peso: '60', piso: '10', teto: '45', atender: '5', devolver: '20' });
  eq(chamadas('leads_dist_config').map(c => c.args), [{ p: { peso_conversao: 0.6, piso: 0.1, teto: 0.45, prazo_atender_min: 5, prazo_devolver_min: 20 } }], 'parâmetros em fração e minutos');
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.leads_dist_config = { data: null, error: { message: 'piso precisa ser menor que o teto', code: '22023' } };
  await kbDistSalvarCfg({ peso: '50', piso: '50', teto: '40', atender: '5', devolver: '15' });
  assert(avisos().includes('piso precisa ser menor que o teto'), 'mostra o motivo da recusa');
  // revisão M-6: campo vazio não vira 0
  window.__rpcCalls.length = 0;
  await kbDistSalvarCfg({ peso: '', piso: '15', teto: '40', atender: '5', devolver: '15' });
  eq(chamadas('leads_dist_config').length, 0, 'campo vazio não é enviado');
  assert(avisos().includes('Preencha todos os ajustes'), 'avisa para preencher');
  fim();
`);
