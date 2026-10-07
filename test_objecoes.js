// Testa as Objeções com IA (06/10/2026) — REGRAS_NEGOCIO.md §72. DADOS FICTÍCIOS.
const { montarPainel } = require('./painel_teste_base.js');
const { window, rodar } = montarPainel();
window.__tabelas.objecoes_respostas = [
  { chave: 'caro', rotulo: 'Tá caro', fala: 'Fala caro.', pergunta: 'Pergunta caro?', alternativa: 'Alt caro.', ordem: 1, ativo: true },
  { chave: 'pensar', rotulo: 'Vou pensar', fala: 'Fala pensar.', pergunta: 'Pergunta pensar?', alternativa: 'Alt pensar.', ordem: 2, ativo: true },
  { chave: 'velha', rotulo: 'Desativada', fala: 'x', pergunta: '', alternativa: '', ordem: 3, ativo: false },
];
rodar(`
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  cdEstado.debounceMs = 0;
  objEstado.timeoutMs = 80;
  await objCarregar();
  cdAbrir();
  const chips = [...document.querySelectorAll('#cdObjecoes [data-obj]')];
  eq(chips.map(c => c.dataset.obj), ['caro', 'pensar'], 'chips ativos na ordem');
  assert(chips[0].title.includes('Alt+1'), 'atalho no título');

  // sem contexto: resposta da biblioteca na hora, sem chamar a IA
  chips[0].click();
  const resp = document.getElementById('objResposta');
  assert(resp.textContent.includes('Fala caro.') && resp.textContent.includes('Pergunta caro?') && resp.textContent.includes('Alt caro.'), 'biblioteca na hora');
  eq(window.__invocacoes.length, 0, 'sem contexto não chama a IA');
  assert(cdEstado.nota.objecoes.includes('caro'), 'objeção entra na nota');
  // copiar e usei
  document.querySelector('#objResposta [data-obj-copiar]').click(); await espera(10);
  eq(window.__copiados[0], 'Fala caro. Pergunta caro?', 'copiar fala + pergunta');
  document.querySelector('#objResposta [data-obj-usei]').click(); await espera(10);
  const uso = window.__escritas.find(e => e.tabela === 'objecoes_uso');
  eq([uso.rows.objecao, uso.rows.fonte, uso.rows.nota_id], ['caro', 'biblioteca', cdEstado.nota.id], 'Usei registra');

  // com contexto: chama a IA em segundo plano, nunca com dado pessoal
  Object.assign(cdEstado.nota, { nome: 'Fulano Teste', cpf: '12345678909', telefone: '19990000001', qtd_linhas: '12', operadora_atual: 'Vivo', texto: 'ligar 19 99000-0001' });
  window.__invokeResposta = () => Promise.resolve({ data: { fala: 'Para 12 linhas na Vivo...', pergunta: 'Posso simular?' }, error: null });
  document.querySelector('#cdObjecoes [data-obj="caro"]').click();
  assert(document.getElementById('objResposta').textContent.includes('Fala caro.'), 'biblioteca aparece antes da IA');
  assert(document.getElementById('objIA').textContent.includes('Adaptando'), 'IA carregando');
  await espera(30);
  const inv = window.__invocacoes[0];
  eq(inv.nome, 'caderno-ia', 'chama caderno-ia');
  const corpo = JSON.stringify(inv.body);
  assert(!/Fulano|12345678909|19990000001|99000-0001/.test(corpo) && corpo.includes('[TELEFONE]') && inv.body.objecao_chave === 'caro', 'corpo sem dado pessoal');
  assert(document.getElementById('objIA').textContent.includes('Para este cliente') && document.getElementById('objIA').textContent.includes('Para 12 linhas na Vivo'), 'resposta da IA');
  // cache: mesmo clique não chama de novo
  document.querySelector('#cdObjecoes [data-obj="caro"]').click(); await espera(20);
  eq(window.__invocacoes.length, 1, 'cache de 10 min');
  // 👍
  document.querySelector('#objIA [data-obj-util="1"]').click(); await espera(10);
  const u2 = window.__escritas.filter(e => e.tabela === 'objecoes_uso').pop();
  eq([u2.rows.fonte, u2.rows.util], ['ia', true], 'útil registrado');

  // IA que nunca responde: depois do tempo, aviso — biblioteca continua
  window.__invokeResposta = () => new Promise(() => {});
  document.querySelector('#cdObjecoes [data-obj="pensar"]').click();
  await espera(150);
  assert(document.getElementById('objIA').textContent.includes('IA indisponível agora'), 'timeout vira aviso');
  assert(document.getElementById('objResposta').textContent.includes('Fala pensar.'), 'biblioteca segue na tela');
  // IA com erro (429)
  window.__invokeResposta = () => Promise.resolve({ data: null, error: { message: 'limite', context: { json: async () => ({ error: 'limite' }) } } });
  objEstado.cache.clear();
  document.querySelector('#cdObjecoes [data-obj="pensar"]').click(); await espera(30);
  assert(document.getElementById('objIA').textContent.includes('IA indisponível agora'), 'erro vira aviso');

  // "O cliente disse…"
  window.__invokeResposta = () => Promise.resolve({ data: { fala: 'Resposta livre.', pergunta: 'E aí?' }, error: null });
  const livre = document.getElementById('objLivre');
  livre.value = 'meu contador cuida disso';
  livre.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await espera(30);
  const invL = window.__invocacoes.pop();
  eq([invL.body.objecao_livre, invL.body.objecao_chave], ['meu contador cuida disso', undefined], 'pergunta livre');
  assert(document.getElementById('objIA').textContent.includes('Resposta livre.'), 'resposta livre na tela');

  // Alt+2 dispara o 2º chip
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', altKey: true }));
  assert(document.getElementById('objResposta').textContent.includes('Fala pensar.'), 'Alt+2');

  // treinar no Apex Mind usa o SSO
  window.__invokeResposta = (nome) => Promise.resolve(nome === 'sso-pratica-vendas' ? { data: { url: 'https://mind.teste/api/auth/sso?token=x' }, error: null } : { data: {}, error: null });
  document.querySelector('#objResposta [data-obj-treinar]').click(); await espera(20);
  assert(window.__abertos.includes('https://mind.teste/api/auth/sso?token=x'), 'abre o Apex Mind por SSO');

  // Fix round 1 (revisão Task 8, Crítico): re-render parcial não pode apagar o que o consultor está
  // digitando em "O cliente disse…" nem a resposta "Para este cliente" já na tela.
  window.__invokeResposta = () => Promise.resolve({ data: { fala: 'Resposta IA antes do clique.', pergunta: 'Pergunta antes?' }, error: null });
  objEstado.cache.clear();
  document.querySelector('#cdObjecoes [data-obj="caro"]').click();
  await espera(30);
  assert(document.getElementById('objIA').textContent.includes('Resposta IA antes do clique.'), 'IA mostrada antes do teste de re-render');
  document.getElementById('objLivre').value = 'meu contador cuida disso';
  // (a) clicar num resultado dispara cdPreencherTela → objRenderChips: não pode apagar #objLivre nem #objIA
  document.querySelector('#cdResultado [data-cd-res="atendeu"]').click();
  eq(document.getElementById('objLivre').value, 'meu contador cuida disso', 'texto do campo livre preservado após clicar em resultado');
  assert(document.getElementById('objIA').textContent.includes('Resposta IA antes do clique.'), 'resposta da IA preservada após clicar em resultado');
  assert(document.querySelector('#cdObjecoes [data-obj="caro"]').classList.contains('active'), 'chip continua ativo após o re-render parcial');
  // (b) biblioteca recarregada (objCarregar de novo): a mesma garantia vale
  await objCarregar();
  eq(document.getElementById('objLivre').value, 'meu contador cuida disso', 'texto do campo livre preservado após objCarregar de novo');
  assert(document.getElementById('objIA').textContent.includes('Resposta IA antes do clique.'), 'resposta da IA preservada após objCarregar de novo');
  assert(document.querySelector('#cdObjecoes [data-obj="caro"]').classList.contains('active'), 'chip continua ativo depois de objCarregar de novo');
  // (c) a classe "active" do chip continua atualizando normalmente depois do re-render parcial
  document.querySelector('#cdObjecoes [data-obj="pensar"]').click();
  assert(document.querySelector('#cdObjecoes [data-obj="pensar"]').classList.contains('active'), 'novo chip clicado fica ativo');
  assert(document.querySelector('#cdObjecoes [data-obj="caro"]').classList.contains('active'), 'chip anterior (já registrado na nota) continua ativo');

  // biblioteca que falha ao carregar: aviso no bloco, Caderno segue
  window.__tabelas.objecoes_respostas = null;
  const sbFrom = sb.from;
  sb.from = (t) => t === 'objecoes_respostas' ? { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) } : sbFrom(t);
  await objCarregar();
  assert(document.getElementById('cdObjecoes').textContent.includes('Não foi possível carregar as objeções'), 'aviso de falha');
  sb.from = sbFrom;

  // ==== mais testes entram aqui ====
  fim();
`);
