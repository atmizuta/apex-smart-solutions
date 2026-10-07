// Testa "Minhas anotações" (aba Anotações, 07/10/2026) — REGRAS_NEGOCIO.md §73.
// Mesma técnica dos outros testes do Caderno/Agenda: decodifica o <script> real de _template.html,
// mocka o Supabase e roda num jsdom. DADOS FICTÍCIOS — o repositório é público.
const { montarPainel } = require('./painel_teste_base.js');
const { rodar } = montarPainel();
rodar(`
  const nowReal = Date.now;
  Date.now = () => sp('2026-10-07T10:00:00');

  function nota(id, consultor_id, campos){
    return Object.assign({
      id, consultor_id, telefone: '', chave_tel: null, nome: '', cnpj: null, texto: '',
      resultado: null, qtd_linhas: null, valor_plano: null, objecoes: [],
      atualizado_em: '2026-10-07T09:00:00-03:00',
    }, campos);
  }

  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };

  // ==== aba no menu, logo abaixo de Agenda, visível a todos ====
  const btnAn = document.querySelector('#tabsNav button[data-tab="anotacoes"]');
  assert(btnAn && btnAn.querySelector('.sbLabel').textContent === 'Anotações', 'botão Anotações no menu');
  const botoesNav = [...document.querySelectorAll('#tabsNav button[data-tab]')].map(b => b.dataset.tab);
  eq(botoesNav[botoesNav.indexOf('agenda') + 1], 'anotacoes', 'Anotações fica logo abaixo de Agenda');
  assert(btnAn.style.display !== 'none', 'Anotações visível a qualquer perfil (sem display:none)');

  // ==== só as próprias notas (filtro explícito .eq consultor_id), mesmo sendo supervisor ====
  window.__tabelas.caderno_notas = [
    nota('n1', 'c1', { nome: 'Empresa Testex Fibra Ltda', telefone: '(19) 3521-4477', chave_tel: '1935214477', texto: 'cliente quer saber preço\\nmandar proposta amanhã', resultado: 'atendeu', atualizado_em: '2026-10-07T09:00:00-03:00' }),
    nota('n2', 'c2', { nome: 'Nota De Outro Consultor', atualizado_em: '2026-10-07T08:00:00-03:00' }),
    nota('n3', 's1', { nome: 'Nota Do Supervisor', atualizado_em: '2026-10-07T08:30:00-03:00' }),
  ];
  btnAn.click();
  await espera(60);
  assert(document.getElementById('panel-anotacoes').classList.contains('active'), 'abre a aba');
  eq(anEstado.notas.map(n => n.id), ['n1'], 'consultor só vê as próprias notas (n2 e n3 ficam de fora mesmo estando na "tabela")');
  assert(document.getElementById('anLista').textContent.includes('Empresa Testex Fibra Ltda'), 'card da própria nota aparece na lista');
  assert(!document.getElementById('anLista').textContent.includes('Nota De Outro Consultor'), 'nota de outro consultor não aparece');
  eq(document.getElementById('anContador').textContent, '1 anotações', 'contador com o total');

  // supervisor também só vê as próprias (igual à Agenda — I-2)
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  await loadAnotacoes();
  eq(anEstado.notas.map(n => n.id), ['n3'], 'supervisor também só vê as próprias notas');
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };

  // ==== busca por nome / telefone (dígitos, com ou sem pontuação) / CNPJ / texto ====
  window.__tabelas.caderno_notas.push(
    // chave_tel '1188887777' é o que o gatilho do banco (chave_tel(), §72) de fato grava pra esse
    // telefone: DDD (11) + os 8 últimos dígitos, sem o "9" do celular — REVISÃO §73, achado 1.
    nota('n4', 'c1', { nome: 'Outra Empresa Teste', telefone: '(11) 98888-7777', chave_tel: '1188887777', cnpj: '12345678000199', texto: 'sem relação', atualizado_em: '2026-10-07T07:00:00-03:00' })
  );
  document.getElementById('anBusca').value = 'Testex';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);
  eq(anEstado.notas.map(n => n.id), ['n1'], 'busca por nome (ilike)');

  document.getElementById('anBusca').value = '3521-4477';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);
  eq(anEstado.notas.map(n => n.id), ['n1'], 'busca por telefone com pontuação casa pelos dígitos (chave_tel)');

  // REVISÃO §73, achado 1 (CRÍTICO): celular de 9 dígitos — chaveTel() derruba o "9" (e o DDI 55),
  // então bater os dígitos crus contra chave_tel (substring) falha; com >=10 dígitos o filtro tem que
  // normalizar com chaveTel() e comparar IGUAL (chave_tel.eq.<chave>).
  document.getElementById('anBusca').value = '(11) 98888-7777';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);
  eq(anEstado.notas.map(n => n.id), ['n4'], 'busca por celular de 9 dígitos formatado acha pela chave_tel normalizada (sem o "9" perdido)');

  document.getElementById('anBusca').value = '11988887777';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);
  eq(anEstado.notas.map(n => n.id), ['n4'], 'busca por celular só com dígitos (sem pontuação)');

  document.getElementById('anBusca').value = '+55 11 98888-7777';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);
  eq(anEstado.notas.map(n => n.id), ['n4'], 'busca por celular com DDI +55 na frente');

  document.getElementById('anBusca').value = '12.345.678/0001-99';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);
  eq(anEstado.notas.map(n => n.id), ['n4'], 'busca por CNPJ com pontuação casa pelos dígitos');

  document.getElementById('anBusca').value = 'mandar proposta';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);
  eq(anEstado.notas.map(n => n.id), ['n1'], 'busca pelo texto da anotação (ilike)');

  // REVISÃO §73, achado 2: * (curinga do ilike do PostgREST) e _ (curinga de 1 caractere do LIKE) não
  // podem ir crus pro .or() — senão o próprio usuário digitando um "_" vira um curinga sem querer.
  const filtroCuringas = anFiltroBusca('abc*def_ghi%jkl,(mno)');
  assert(!filtroCuringas.includes('*') && !filtroCuringas.includes('_'), 'filtro de busca remove * e _ (curingas do ilike/like) do termo digitado, além de , ( ) %');
  // aspas e barra invertida têm significado no filtro or() do PostgREST: também saem do termo
  const filtroAspas = anFiltroBusca('padaria "bom" sabor\\\\x');
  assert(!filtroAspas.includes('"') && !filtroAspas.includes('\\\\'), 'filtro de busca remove aspas e barra invertida');

  // debounce: não dispara a cada tecla, só depois de ~300ms parado
  let chamadas = 0;
  const fromOriginalDeb = sb.from;
  sb.from = (t) => { if(t === 'caderno_notas') chamadas++; return fromOriginalDeb(t); };
  document.getElementById('anBusca').value = 'm';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('anBusca').value = 'ma';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('anBusca').value = 'man';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(80);
  eq(chamadas, 0, 'debounce: ainda não buscou com 80ms');
  await espera(350);
  eq(chamadas, 1, 'debounce: buscou uma vez só, ~300ms depois de parar de digitar');
  sb.from = fromOriginalDeb;
  document.getElementById('anBusca').value = '';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);

  // ==== pílulas de período (Hoje · 7 dias · 30 dias padrão · Tudo), por atualizado_em em SP ====
  window.__tabelas.caderno_notas.push(
    nota('n5', 'c1', { nome: 'Nota 3 Dias Teste', atualizado_em: '2026-10-04T09:00:00-03:00' }),
    nota('n6', 'c1', { nome: 'Nota 10 Dias Teste', atualizado_em: '2026-09-27T09:00:00-03:00' }),
    nota('n7', 'c1', { nome: 'Nota 40 Dias Teste', atualizado_em: '2026-08-28T09:00:00-03:00' }),
  );
  assert(document.querySelector('#anPeriodo [data-an-periodo="30d"]').classList.contains('active'), '30 dias é o padrão');
  await loadAnotacoes();
  eq(anEstado.notas.map(n => n.id).sort(), ['n1', 'n4', 'n5', 'n6'], '30 dias: pega até "10 dias atrás", fora "40 dias atrás"');

  document.querySelector('#anPeriodo [data-an-periodo="hoje"]').click();
  await espera(30);
  assert(document.querySelector('#anPeriodo [data-an-periodo="hoje"]').classList.contains('active'), 'pílula "Hoje" marcada');
  eq(anEstado.notas.map(n => n.id).sort(), ['n1', 'n4'], 'Hoje: só as de hoje (07/10)');

  document.querySelector('#anPeriodo [data-an-periodo="7d"]').click();
  await espera(30);
  eq(anEstado.notas.map(n => n.id).sort(), ['n1', 'n4', 'n5'], '7 dias: inclui a de 3 dias atrás, fora a de 10 dias');

  document.querySelector('#anPeriodo [data-an-periodo="tudo"]').click();
  await espera(30);
  eq(anEstado.notas.map(n => n.id).sort(), ['n1', 'n4', 'n5', 'n6', 'n7'], 'Tudo: todas as próprias notas, sem corte de data');

  // ==== pílulas de resultado (Todos · Atendeu · Não atendeu · Caixa postal · Sem interesse · Fechou) ====
  window.__tabelas.caderno_notas.push(nota('n8', 'c1', { nome: 'Nota Fechou Teste', resultado: 'fechou', atualizado_em: '2026-10-07T06:00:00-03:00' }));
  await loadAnotacoes(); // ainda em "Tudo"
  document.querySelector('#anResultado [data-an-resultado="fechou"]').click();
  await espera(30);
  assert(document.querySelector('#anResultado [data-an-resultado="fechou"]').classList.contains('active'), 'pílula "Fechou" marcada');
  eq(anEstado.notas.map(n => n.id), ['n8'], 'filtro de resultado: só "Fechou"');
  assert(document.getElementById('anLista').textContent.includes('Fechou'), 'rótulo do resultado aparece no card');
  document.querySelector('#anResultado [data-an-resultado="todos"]').click();
  await espera(30);
  assert(document.querySelector('#anResultado [data-an-resultado="todos"]').classList.contains('active'), 'volta para "Todos"');

  // ==== card: linhas/valor do plano, chips de objeção (rótulo da biblioteca ou a chave crua) ====
  objEstado.lista = [{ chave: 'caro', rotulo: 'Tá caro' }];
  window.__tabelas.caderno_notas.push(nota('n9', 'c1', {
    nome: 'Nota Com Contexto Teste', qtd_linhas: 5, valor_plano: 450, objecoes: ['caro', 'chave_sem_label'],
    texto: 'linha 1 da nota\\nlinha 2 da nota\\nlinha 3 não deve aparecer', atualizado_em: '2026-10-07T05:00:00-03:00',
  }));
  await loadAnotacoes();
  const txtLista = document.getElementById('anLista').textContent;
  assert(txtLista.includes('5 linha') && txtLista.includes('R$') && txtLista.includes('450'), 'linhas e valor do plano aparecem no card');
  assert(txtLista.includes('Tá caro'), 'chip de objeção usa o rótulo da biblioteca quando carregada');
  assert(txtLista.includes('chave_sem_label'), 'chip de objeção sem rótulo na biblioteca mostra a própria chave');
  assert(txtLista.includes('linha 1 da nota') && txtLista.includes('linha 2 da nota') && !txtLista.includes('linha 3 não deve aparecer'), 'só as 2 primeiras linhas da anotação aparecem no card');

  // ==== escapar tudo (nota com <img onerror> no texto vira texto, não HTML) ====
  window.__tabelas.caderno_notas.push(nota('nxss', 'c1', { nome: '<img src=x onerror=alert(1)>', texto: '<img src=x onerror=alert(2)>', atualizado_em: '2026-10-07T04:00:00-03:00' }));
  await loadAnotacoes();
  assert(document.querySelector('#anLista img') === null, 'nenhuma tag <img> de verdade é criada a partir da nota');
  assert(document.getElementById('anLista').innerHTML.includes('&lt;img'), 'o texto da nota aparece escapado (entidade HTML), não como tag');

  // ==== clicar no card abre a nota no Caderno (mesmo registro) ====
  let aberto = null;
  const cdAbrirOriginal = cdAbrirDoRetorno;
  cdAbrirDoRetorno = (r) => { aberto = r.nota_id; };
  document.querySelector('#anLista .anCard[data-id="n1"]').click();
  eq(aberto, 'n1', 'clique no card abre a nota correspondente no Caderno');
  cdAbrirDoRetorno = cdAbrirOriginal;

  // ==== paginação: 50 por página, "Carregar mais" ====
  window.__tabelas.caderno_notas = [];
  for(let i = 0; i < 60; i++){
    const dia = String(7 - (i % 7)).padStart(2, '0'); // várias datas de outubro, todas dentro de "Tudo"
    window.__tabelas.caderno_notas.push(nota('p' + i, 'c1', { nome: 'Nota Pag ' + i, atualizado_em: '2026-10-' + dia + 'T0' + (i % 9) + ':00:00-03:00' }));
  }
  document.querySelector('#anPeriodo [data-an-periodo="tudo"]').click();
  await espera(30);
  eq(document.querySelectorAll('#anLista .anCard').length, 50, '1ª página: 50 cartões');
  eq(document.getElementById('anContador').textContent, '60 anotações', 'contador mostra o total (60), não só a página carregada');
  assert(document.getElementById('anCarregarMais').style.display !== 'none', '"Carregar mais" aparece quando há mais página');
  assert(document.getElementById('anCarregarMais').disabled === false, '"Carregar mais" começa habilitado');
  document.getElementById('anCarregarMais').click();
  await espera(40);
  eq(document.querySelectorAll('#anLista .anCard').length, 60, 'depois de "Carregar mais": as 60 carregadas, sem duplicar as 50 primeiras');
  assert(document.getElementById('anCarregarMais').style.display === 'none', '"Carregar mais" some quando acabou');

  // ==== REVISÃO §73, achado 3: dois cliques rápidos em "Carregar mais" não podem disparar 2 pedidos
  // (e embaralhar a ordem das páginas se a 2ª resposta chegar antes da 1ª) — reentrância bloqueada
  // enquanto uma página já está sendo carregada; o botão fica desabilitado nesse meio tempo. ====
  window.__tabelas.caderno_notas = [];
  for(let i = 0; i < 130; i++){
    // minuto a minuto, sempre decrescente — q0 é sempre a mais recente, dá pra conferir a ordem.
    const t = new Date(Date.parse('2026-10-07T12:00:00-03:00') - i * 60000).toISOString();
    window.__tabelas.caderno_notas.push(nota('q' + i, 'c1', { nome: 'Nota Reentrância ' + i, atualizado_em: t }));
  }
  document.querySelector('#anPeriodo [data-an-periodo="tudo"]').click();
  await espera(30);
  eq(document.querySelectorAll('#anLista .anCard').length, 50, 'reentrância, pré: 1ª página (50 de 130)');
  let chamadasReentr = 0;
  const fromOriginalReentr = sb.from;
  sb.from = (t) => { if(t === 'caderno_notas') chamadasReentr++; return fromOriginalReentr(t); };
  document.getElementById('anCarregarMais').click();
  assert(document.getElementById('anCarregarMais').disabled === true, '"Carregar mais" desabilita assim que clicado (pedido em voo)');
  document.getElementById('anCarregarMais').click(); // 2º clique enquanto o 1º ainda está em voo: tem que ser ignorado
  await espera(50);
  eq(chamadasReentr, 1, 'dois cliques rápidos em "Carregar mais" disparam só 1 pedido ao banco');
  eq(document.querySelectorAll('#anLista .anCard').length, 100, 'depois: 100 notas (50+50), sem duplicar nem faltar por causa da corrida');
  eq([...document.querySelectorAll('#anLista .anCard')].slice(0, 3).map(c => c.dataset.id), ['q0', 'q1', 'q2'], 'ordem continua da mais recente pra mais antiga, sem embaralhar');
  assert(document.getElementById('anCarregarMais').disabled === false, '"Carregar mais" reabilita depois de carregar (ainda há mais página: 100 de 130)');
  sb.from = fromOriginalReentr;

  // ==== respostas atrasadas (digitar rápido / trocar filtro) não sobrescrevem a mais nova ====
  const fromOriginalRace = sb.from;
  let chamadasRace = 0;
  sb.from = (t) => {
    const real = fromOriginalRace(t);
    if(t !== 'caderno_notas') return real;
    chamadasRace++;
    if(chamadasRace === 1){
      const thenOriginal = real.then.bind(real);
      real.then = (ok, ko) => new Promise(r => setTimeout(r, 60)).then(() => thenOriginal(ok, ko));
    }
    return real;
  };
  document.querySelector('#anResultado [data-an-resultado="atendeu"]').click(); // 1ª chamada: fica lenta (60ms)
  document.querySelector('#anResultado [data-an-resultado="todos"]').click(); // 2ª chamada: rápida, deve vencer
  await espera(100);
  assert(document.querySelector('#anResultado [data-an-resultado="todos"]').classList.contains('active'), 'corrida: pílula fica na última escolhida');
  eq(document.querySelectorAll('#anLista .anCard').length, 50, 'corrida: resposta atrasada (Atendeu, vazia) não apaga a lista já carregada de "Todos"');
  sb.from = fromOriginalRace;

  // ==== SEÇÃO 74 (07/10/2026): lixeira do cartão — confirmação em tela, exclui, some da lista sem
  // abrir o Caderno, e avisa a Agenda/alertas (agenda:mudou) ====
  window.__tabelas.caderno_notas.push(nota('nDel', 'c1', { nome: 'Nota Para Excluir Teste Unica', texto: 'apagar isso', atualizado_em: '2026-10-07T11:00:00-03:00' }));
  // busca isola o cartão (nome único), sem depender da paginação/ordem da massa de dados dos testes anteriores
  document.getElementById('anBusca').value = 'Excluir Teste Unica';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);
  eq(anEstado.notas.map(n => n.id), ['nDel'], 'busca isola o cartão a excluir');
  let abriuCaderno = false;
  const cdAbrirOriginalDel = cdAbrirDoRetorno;
  cdAbrirDoRetorno = () => { abriuCaderno = true; };
  let agendaMudouCount = 0;
  document.addEventListener('agenda:mudou', () => { agendaMudouCount++; });
  const cartaoDel = document.querySelector('#anLista .anCard[data-id="nDel"]');
  assert(cartaoDel, 'cartão da nota a excluir aparece na lista');
  const lixeira = cartaoDel.querySelector('[data-an-excluir="nDel"]');
  assert(lixeira, 'cartão tem botão de lixeira (excluir)');
  lixeira.click();
  assert(!abriuCaderno, 'clicar na lixeira não abre o Caderno (não é o clique no cartão)');
  assert(document.getElementById('cdExcluirOverlay').classList.contains('active'), 'lixeira pede confirmação em tela (sem window.confirm)');
  document.getElementById('cdExcluirConfirmar').click();
  await espera(30);
  assert(window.__escritas.some(e => e.tabela === 'caderno_notas' && e.op === 'delete' && e.filtro.id === 'nDel'), 'confirmar a lixeira chama delete com o id certo');
  assert(!document.querySelector('#anLista .anCard[data-id="nDel"]'), 'cartão some da lista depois de excluído');
  assert(!abriuCaderno, 'excluir pela lixeira nunca abre o Caderno');
  assert(agendaMudouCount > 0, 'agenda:mudou disparado depois de excluir (Agenda/alertas atualizam)');
  cdAbrirDoRetorno = cdAbrirOriginalDel;
  document.getElementById('anBusca').value = '';
  document.getElementById('anBusca').dispatchEvent(new window.Event('input', { bubbles: true }));
  await espera(350);

  // ==== falha ao carregar: aviso, sem quebrar o painel ====
  // volta pro período "30 dias" (com corte de data, chama .gte) pra bater com a cadeia simulada abaixo.
  document.querySelector('#anPeriodo [data-an-periodo="30d"]').click();
  await espera(30);
  const fromOriginalErro = sb.from;
  sb.from = (t) => t === 'caderno_notas' ? { select: () => ({ eq: () => ({ gte: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }) }) } : fromOriginalErro(t);
  await loadAnotacoes();
  eq(document.getElementById('anStatus').textContent, 'Não foi possível carregar suas anotações agora.', 'aviso de falha ao carregar');
  sb.from = fromOriginalErro;
  assert(document.getElementById('panel-anotacoes').classList.contains('active'), 'painel continua funcionando depois da falha');

  // ==== logout limpa a lista (cadernoResetar) ====
  await loadAnotacoes();
  assert(document.getElementById('anLista').children.length > 0, 'pré: lista tem itens antes do logout');
  cadernoResetar();
  eq(document.getElementById('anLista').innerHTML, '', 'logout limpa a lista de anotações');
  eq(anEstado.notas.length, 0, 'logout limpa o estado');
  eq(document.getElementById('anBusca').value, '', 'logout limpa a busca');
  assert(document.querySelector('#anPeriodo [data-an-periodo="30d"]').classList.contains('active'), 'logout volta o período para "30 dias"');
  assert(document.querySelector('#anResultado [data-an-resultado="todos"]').classList.contains('active'), 'logout volta o resultado para "Todos"');

  Date.now = nowReal;
  fim();
`);
