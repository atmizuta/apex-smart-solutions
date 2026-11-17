// Testa a §157 — aba "Consultar sócios" (campo livre). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const clicar = (sel) => document.querySelector(sel).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const res = () => document.getElementById('scResultado');
  const enviar = (v) => { document.getElementById('scCnpj').value = v; document.getElementById('scForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); };
  const pedidos = () => window.__rpcCalls.filter(c => c.nome === 'socios_pedir_cnpj');
  const BASE = { receita_mes: '2026-09', socios: [{ nome: 'ZZ SOCIA BASE', cpf: '12345678909', principal: true, obito: false }] };
  const RES = { socios: [{ nome: 'ZZ SOCIA NV', cpf: '12345678909', participacao: 100, telefones_consultados: true,
    telefones: [{ tipo: 'celular', numero: '11900000001', operadora: 'CLARO', whatsapp: true }] }] };
  const linha = (o) => Object.assign({ cnpj_digits: '11222333000181', razao_social: 'ZZ EMPRESA TESTE LTDA', pedido_por: 'u-a', pedido_em: new Date().toISOString(), iniciado_em: null, concluido_em: null, resultado: null, erro: null, copiado_de: null }, o);

  // visibilidade
  currentUser = { id: 'u-c', nome: 'Zzc', role: 'consultor', operacao: 'campinas', equipe: null }; scAplicarPermissao();
  eq(document.getElementById('tabBtnSocios').style.display, 'none', 'Campinas não vê');
  currentUser = { id: 'u-r', nome: 'Zzr', role: 'consultor', operacao: 'apex', equipe: 'renovacao' }; scAplicarPermissao();
  eq(document.getElementById('tabBtnSocios').style.display, 'none', 'time da Renovação não vê');
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: null }; scAplicarPermissao();
  eq(document.getElementById('tabBtnSocios').style.display, 'inline-block', 'consultor Apex vê');

  window.__tabelas.socios_consultas = [];
  document.querySelector('#tabsNav button[data-tab="socios"]').click(); await espera(30);
  assert(document.getElementById('panel-socios').classList.contains('active'), 'abre a aba');
  assert(/Nenhuma consulta ainda/.test(document.getElementById('scLista').textContent), 'lista vazia');

  // DV inválido não chama o banco
  enviar('11.222.333/0001-82'); await espera(10);
  eq(pedidos().length, 0, 'DV inválido não chama o banco');
  assert(/os dígitos não batem/.test(document.getElementById('scAviso').textContent), 'aviso de DV');

  // resultado guardado
  window.__tabelas.socios_consultas = [linha({ id: 90, status: 'pronto', concluido_em: '2026-11-10T13:00:00Z', resultado: RES, copiado_de: 5 })];
  window.__rpcRespostas.socios_pedir_cnpj = () => ({ data: { ok: true, id: 90, status: 'pronto', guardado: true, razao_social: 'ZZ EMPRESA TESTE LTDA', base: BASE }, error: null });
  enviar('11.222.333/0001-81'); await espera(40);
  eq(pedidos()[0].args, { p_cnpj: '11222333000181', p_atualizar: false }, 'chama com só dígitos');
  assert(/ZZ EMPRESA TESTE LTDA/.test(res().textContent) && /11\\.222\\.333\\/0001-81/.test(res().textContent), 'cabeçalho com razão e CNPJ');
  assert(/ZZ SOCIA NV/.test(res().textContent) && /Consultado na Nova Vida em 10\\/11 10:00/.test(res().textContent), 'guardado com a data original');
  assert(res().querySelector('[data-sc-pedir="atualizar"]'), 'botão Atualizar');
  assert(/ZZ EMPRESA TESTE LTDA/.test(document.getElementById('scLista').textContent) && /pronto · 1 sócio/.test(document.getElementById('scLista').textContent), 'lista com a consulta');

  // Atualizar → p_atualizar true → em andamento → releitura → pronto
  window.__tabelas.socios_consultas.unshift(linha({ id: 91, status: 'pendente' }));
  window.__rpcRespostas.socios_pedir_cnpj = () => ({ data: { ok: true, id: 91, status: 'pendente', razao_social: 'ZZ EMPRESA TESTE LTDA', base: BASE }, error: null });
  clicar('#scResultado [data-sc-pedir="atualizar"]'); await espera(40);
  eq(pedidos().at(-1).args.p_atualizar, true, 'Atualizar ignora o guardado');
  assert(/Consultando na Nova Vida… 0:0\\d/.test(res().textContent) && /ZZ SOCIA BASE/.test(res().textContent), 'em andamento com a base');
  assert(scEstado.timer, 'agendou a releitura');
  Object.assign(window.__tabelas.socios_consultas[0], { status: 'pronto', concluido_em: '2026-11-17T18:00:00Z', resultado: RES });
  await scReler(); await espera(20);
  assert(/Consultado na Nova Vida em 17\\/11 15:00/.test(res().textContent) && !scEstado.timer, 'pronto pela releitura e parou');

  // limite
  window.__rpcRespostas.socios_pedir_cnpj = () => ({ data: { ok: false, motivo: 'limite' }, error: null });
  enviar('11444777000161'); await espera(20);
  assert(/Você já fez 20 consultas hoje/.test(document.getElementById('scAviso').textContent), 'aviso de limite');

  // reabrir da lista não chama socios_pedir_cnpj
  window.__rpcRespostas.socios_base_do_pedido = () => ({ data: { ok: true, razao_social: 'ZZ EMPRESA TESTE LTDA', base: BASE }, error: null });
  const antes = pedidos().length;
  scEstado.atual = null; res().innerHTML = '';
  await scCarregarLista();
  clicar('#scLista [data-sc-abrir="90"]'); await espera(40);
  eq(pedidos().length, antes, 'reabrir não consulta de novo');
  assert(/ZZ SOCIA NV/.test(res().textContent), 'reabriu o resultado');

  // trocar de aba para a releitura; trocar de usuário limpa
  window.__tabelas.socios_consultas[0].status = 'pendente';
  await scAbrirPedido(91); await espera(10);
  assert(scEstado.timer, 'releitura ligada');
  document.querySelector('#tabsNav button[data-tab="busca"]').click(); await espera(10);
  assert(!scEstado.timer, 'sair da aba para a releitura');
  scAplicarPermissao();
  assert(!scEstado.atual && res().innerHTML === '', 'trocar de usuário limpa');
  fim();
`);
