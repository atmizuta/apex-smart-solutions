// Testa o Caderno de Ligação (06/10/2026) — REGRAS_NEGOCIO.md §72. DADOS FICTÍCIOS (CPF/CNPJ de exemplo, válidos só no dígito).
const { montarPainel } = require('./painel_teste_base.js');
const { window, rodar } = montarPainel();
window.__JSDOM = require('jsdom').JSDOM;
rodar(`
  // ==== TASK 5: funções puras ====
  assert(cdCpfValido('123.456.789-09') && !cdCpfValido('123.456.789-00') && !cdCpfValido('111.111.111-11'), 'CPF: dígito e repetidos');
  assert(cdCnpjValido('11.222.333/0001-81') && !cdCnpjValido('11.222.333/0001-80') && !cdCnpjValido('00000000000000'), 'CNPJ: dígito e repetidos');
  eq(cdReconhecer('cnpj 11.222.333/0001-81 cpf 123.456.789-09 tel (19) 99000-0001 cep 13010-000 x@teste.com'),
     { email: 'x@teste.com', cnpj: '11222333000181', cpf: '12345678909', telefone: '19990000001', cep: '13010000' }, 'reconhece os 5');
  eq(cdReconhecer('ligar 11987654321'), { telefone: '11987654321' }, '11 dígitos com 9 na 3ª posição = celular, não CPF');
  eq(cdReconhecer('doc 12345678909'), { cpf: '12345678909' }, '11 dígitos com CPF válido e 3º dígito ≠ 9 = CPF');
  eq(cdReconhecer('fixo 1932541000'), { telefone: '1932541000' }, 'fixo com DDD');
  eq(cdReconhecer('12 linhas, paga 900'), {}, 'texto comercial não vira dado');
  const n0 = cdNovaNota();
  assert(/^[0-9a-f-]{36}$/.test(n0.id) && n0.texto === '' && Array.isArray(n0.objecoes), 'nota nova com uuid');
  assert(cdNotaVazia(n0), 'nota nova é vazia');
  const n1 = Object.assign(cdNovaNota(), { telefone: '19990000001', texto: 'cpf 123.456.789-09, cnpj 11.222.333/0001-81' });
  eq(cdSugestoesPreencher(n1), [{ campo: 'cpf', valor: '12345678909' }, { campo: 'cnpj', valor: '11222333000181' }], 'só sugere campo vazio (telefone já preenchido)');
  eq([cdNum('1.234,56'), cdNum('12'), cdNum(''), cdNum('abc')], [1234.56, 12, null, null], 'números em formato BR');
  const n2 = Object.assign(cdNovaNota(), { telefone: '(19) 99000-0001', nome: ' Empresa Teste ', cnpj: '11.222.333/0001-81', cep: '13010-000', qtd_linhas: '12', valor_plano: '899,90', fidelidade_vence: '2027-03', texto: 'linha 1\\nlinha 2' });
  const p2 = cdPayload(n2);
  eq([p2.cnpj, p2.cep, p2.qtd_linhas, p2.valor_plano, p2.fidelidade_vence, p2.nome], ['11222333000181', '13010000', 12, 899.9, '2027-03-01', 'Empresa Teste'], 'payload normalizado');
  assert(!('atualizado_em' in p2) && p2.id === n2.id, 'payload sem atualizado_em (o banco preenche)');
  const r2 = cdRetornoDaNota(n2, '2026-10-07T09:00:00-03:00', 'manual');
  eq([r2.nome, r2.telefone, r2.qtd_linhas, r2.valor_plano, r2.observacao, r2.nota_id, r2.origem, r2.tipo], ['Empresa Teste', '(19) 99000-0001', 12, 899.9, 'linha 1', n2.id, 'manual', 'ligacao'], 'retorno nasce da nota');
  assert(/^[0-9a-f-]{36}$/.test(r2.id), 'retorno com uuid');
  eq(cdRetornoDaNota(Object.assign(cdNovaNota(), { telefone: '19990000001', cnpj: '11222333000181' }), '2026-10-07T09:00:00-03:00', 'manual').nome, 'CNPJ 11.222.333/0001-81', 'sem nome usa o CNPJ');
  eq(cdSugestaoFidelidade('2027-03', '2026-10-06'), { dia: '2027-01-15', rotulo: 'Agendar retorno 45 dias antes do vencimento (15/01)' }, 'fidelidade: 45 dias antes do dia 1º');
  eq(cdSugestaoFidelidade('2026-11', '2026-10-06').dia, '2026-10-07', 'já dentro da janela: amanhã');
  eq(cdSugestaoFidelidade('', '2026-10-06'), null, 'sem vencimento');
  const ctx = cdContextoIA(Object.assign(cdNovaNota(), { nome: 'Fulano Teste', cpf: '12345678909', telefone: '19990000001', qtd_linhas: '12', operadora_atual: 'Vivo', texto: 'falar com 19 99000-0001 ou x@teste.com' }));
  eq(Object.keys(ctx).sort(), ['fidelidade_vence', 'interesse', 'operadora_atual', 'qtd_linhas', 'texto', 'valor_plano'], 'contexto só com campos permitidos');
  assert(!/99000|teste\\.com/.test(ctx.texto) && ctx.texto.includes('[TELEFONE]'), 'texto mascarado no navegador');
  assert(!cdTemContexto(cdNovaNota()) && cdTemContexto(Object.assign(cdNovaNota(), { operadora_atual: 'Vivo' })), 'tem contexto');

  // cdMascarar: mesma regra do mascarar() da Edge Function caderno-ia (ia.ts) — classificador único por quantidade de dígitos.
  eq(cdMascarar('13010000'), '[CEP]', 'mascarar: 8 dígitos seguidos = CEP');
  eq(cdMascarar('123 456 789-09'), '[CPF]', 'mascarar: 11 dígitos com separadores livres, 3º dígito ≠ 9 = CPF');
  eq(cdMascarar('019 99000-0001'), '[TELEFONE]', 'mascarar: 0 de tronco cai, sobra 11 dígitos com 9 na 3ª posição = telefone');
  eq(cdMascarar('06/10/2026'), '06/10/2026', 'mascarar: data dd/mm/aaaa não é mascarada');
  eq(cdMascarar('12 linhas'), '12 linhas', 'mascarar: menos de 8 dígitos não é mascarado');

  // cdNum: tipagem BR — "." só é separador de milhar com 3 dígitos e sem vírgula; com vírgula é decimal BR.
  eq(cdNum('899,90'), 899.9, 'num: vírgula decimal BR');
  eq(cdNum('1.200'), 1200, 'num: ponto como milhar (3 dígitos, sem vírgula)');
  eq(cdNum('12.500'), 12500, 'num: ponto como milhar (outro caso)');
  eq(cdNum('99.90'), 99.9, 'num: ponto decimal (não são 3 dígitos após o ponto, sem vírgula)');
  eq(cdNum(42), 42, 'num: número já pronto passa direto');

  // ==== TASK 7: gaveta, salvamento, histórico, retorno ====
  const nowReal = Date.now;
  const AGORA = sp('2026-10-06T10:00:00');
  Date.now = () => AGORA;
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  cdEstado.debounceMs = 0;
  try{ localStorage.clear(); }catch(_e){}
  cadernoAoEntrar();
  assert(document.getElementById('cdBotao').style.display !== 'none', 'botão do Caderno aparece logado');
  document.getElementById('cdBotao').click();
  assert(document.getElementById('cdGaveta').classList.contains('aberta'), 'abre a gaveta');
  assert(document.activeElement === document.getElementById('cdF_telefone'), 'cursor no telefone');
  // Alt+N fecha e abre
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', altKey: true }));
  assert(!document.getElementById('cdGaveta').classList.contains('aberta'), 'Alt+N fecha');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', altKey: true }));
  assert(document.getElementById('cdGaveta').classList.contains('aberta'), 'Alt+N abre');

  // digitar salva (local + banco), sem duplicar
  const idNota = cdEstado.nota.id;
  window.__tabelas.caderno_notas = [{ id: 'antiga', consultor_id: 'c1', chave_tel: '1990000001', nome: 'Empresa Teste', texto: 'ligou ontem\\nqueria 70GB', resultado: 'nao_atendeu', atualizado_em: '2026-10-05T15:00:00Z' }];
  window.__tabelas.agenda_retornos = [{ id: 'rp', consultor_id: 'c1', chave_tel: '1990000001', status: 'pendente', quando: '2026-10-08T14:30:00-03:00', nome: 'Empresa Teste' }];
  const digita = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
  digita('cdF_telefone', '(19) 99000-0001');
  digita('cdF_nome', 'Empresa Teste');
  digita('cdTexto', 'cnpj 11.222.333/0001-81, 12 linhas na Vivo');
  await espera(40);
  const ups = window.__escritas.filter(e => e.tabela === 'caderno_notas' && e.op === 'upsert');
  assert(ups.length >= 1 && ups.every(u => u.rows.id === idNota && u.opts.onConflict === 'id'), 'upsert pelo mesmo id');
  eq(document.getElementById('cdStatus').textContent, 'Salvo ✓', 'indicador salvo');
  const ls = JSON.parse(localStorage.getItem('caderno_rascunho_c1'));
  assert(ls && ls.nota.id === idNota && ls.pendente === false, 'rascunho local marcado como enviado');
  // sugestão de preencher (CNPJ reconhecido)
  const sug = document.querySelector('#cdSugestoes [data-cd-preencher="cnpj"]');
  assert(sug, 'sugere preencher CNPJ');
  sug.click(); await espera(10);
  eq(document.getElementById('cdF_cnpj').value, '11.222.333/0001-81', 'preencheu formatado');
  // histórico e retorno pendente do mesmo telefone
  await espera(40);
  assert(document.getElementById('cdHistorico').textContent.includes('ligou ontem') && document.getElementById('cdHistorico').textContent.includes('Não atendeu'), 'histórico do cliente');
  assert(document.getElementById('cdRetornoPendente').textContent.includes('qui 08/10 14:30'), 'retorno pendente mostrado');
  // CPF inválido: aviso discreto
  digita('cdF_cpf', '123.456.789-00');
  assert(document.getElementById('cdF_cpf').closest('.field').classList.contains('cdAviso'), 'aviso de CPF inválido');

  // sem rede: guarda local, tenta de novo; nada se perde
  window.__falharEscrita = (t, op) => (t === 'caderno_notas' ? { message: 'Failed to fetch' } : null);
  digita('cdTexto', 'cnpj 11.222.333/0001-81, 12 linhas na Vivo. Volta amanhã');
  await espera(40);
  eq(document.getElementById('cdStatus').textContent, 'Sem internet: guardado neste computador', 'indicador offline');
  assert(JSON.parse(localStorage.getItem('caderno_rascunho_c1')).pendente === true, 'rascunho pendente');
  // recarregar a página (novo estado) restaura e reenvia
  window.__falharEscrita = null;
  cdEstado.nota = null;
  await cdRestaurar(); await espera(30);
  eq(cdEstado.nota.id, idNota, 'restaurou a mesma nota');
  assert(document.getElementById('cdTexto').value.includes('Volta amanhã'), 'texto restaurado');
  eq(document.getElementById('cdStatus').textContent, 'Salvo ✓', 'reenviado depois de restaurar');

  // agendar retorno do próprio Caderno
  const btnAmanha = [...document.querySelectorAll('#cdAtalhos [data-cd-dia]')].find(b => b.textContent === 'Amanhã 9h');
  btnAmanha.click(); await espera(40);
  const ret = window.__escritas.filter(e => e.tabela === 'agenda_retornos' && e.op === 'insert').pop();
  eq([ret.rows.quando, ret.rows.nome, ret.rows.nota_id, ret.rows.origem], ['2026-10-07T09:00:00-03:00', 'Empresa Teste', idNota, 'manual'], 'retorno nasce do Caderno');
  // "Não atendeu" oferece tentar em 2h
  document.querySelector('#cdResultado [data-cd-res="nao_atendeu"]').click(); await espera(10);
  const tentar = document.querySelector('#cdSugestaoRetorno [data-cd-dia]');
  assert(tentar && tentar.textContent.includes('Tentar de novo em 2h'), 'sugestão após não atendeu');
  tentar.click(); await espera(40);
  eq(window.__escritas.filter(e => e.tabela === 'agenda_retornos' && e.op === 'insert').pop().rows.origem, 'nao_atendeu', 'origem nao_atendeu');
  // fidelidade sugere 45 dias antes
  digita('cdF_fidelidade_vence', '2027-03');
  const fid = document.querySelector('#cdSugestaoRetorno [data-cd-origem="fidelidade"]');
  assert(fid && fid.textContent.includes('15/01'), 'sugestão de fidelidade');
  fid.click(); await espera(40);
  eq(window.__escritas.filter(e => e.tabela === 'agenda_retornos' && e.op === 'insert').pop().rows.quando, '2027-01-15T09:00:00-03:00', 'retorno da fidelidade às 9h');

  // novo atendimento: nova nota, a anterior já salva
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'N', altKey: true, shiftKey: true }));
  await espera(30); // cdNovo salva a nota atual antes de trocar
  assert(cdEstado.nota.id !== idNota && document.getElementById('cdF_telefone').value === '', 'novo atendimento em branco');
  // nota vazia não é gravada
  const antes = window.__escritas.length;
  cdAgendarSalvar(); await espera(20);
  eq(window.__escritas.length, antes, 'nota vazia não grava');

  // abrir a partir de um retorno da Agenda
  window.__tabelas.caderno_notas.push({ id: 'n-ret', consultor_id: 'c1', telefone: '19990000003', nome: 'Retorno Teste', texto: 'detalhes', interesse: [], objecoes: [] });
  await cdAbrirDoRetorno({ id: 'r9', nota_id: 'n-ret', nome: 'Retorno Teste', telefone: '19990000003' }); await espera(20);
  eq([cdEstado.nota.id, document.getElementById('cdF_nome').value], ['n-ret', 'Retorno Teste'], 'abre a nota de origem');
  await cdAbrirDoRetorno({ id: 'r10', nota_id: null, nome: 'Sem Nota Teste', telefone: '19990000004' }); await espera(20);
  eq([document.getElementById('cdF_nome').value, document.getElementById('cdF_telefone').value], ['Sem Nota Teste', '19990000004'], 'sem nota: Caderno novo já com nome e telefone');

  // fila de pendentes: trocar de atendimento sem internet não perde a nota anterior (revisão §72)
  await cdNovo(); await espera(10);
  const idA = cdEstado.nota.id;
  window.__falharEscrita = (t) => (t === 'caderno_notas' ? { message: 'Failed to fetch' } : null);
  digita('cdF_telefone', '19990000005');
  digita('cdTexto', 'nota A sem internet');
  await espera(40);
  let filaPend = JSON.parse(localStorage.getItem('caderno_pendentes_c1'));
  assert(filaPend && filaPend[idA] && filaPend[idA].texto === 'nota A sem internet', 'nota A entra na fila de pendentes (sem internet)');
  // troca de atendimento (Alt+Shift+N) continua sem internet: a nota A não pode sumir
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'N', altKey: true, shiftKey: true }));
  await espera(40);
  const idB = cdEstado.nota.id;
  assert(idB !== idA, 'trocou para a nota B');
  digita('cdF_telefone', '19990000006');
  digita('cdTexto', 'nota B sem internet');
  await espera(40);
  filaPend = JSON.parse(localStorage.getItem('caderno_pendentes_c1'));
  assert(filaPend[idA] && filaPend[idA].texto === 'nota A sem internet', 'nota A continua na fila depois de trocar de atendimento');
  assert(filaPend[idB] && filaPend[idB].texto === 'nota B sem internet', 'nota B também entra na fila (ainda sem internet)');
  // cdAbrirDoRetorno com uma pendente no meio: a pendente continua guardada
  await cdAbrirDoRetorno({ id: 'r11', nota_id: null, nome: 'Outro Retorno', telefone: '19990000008' });
  await espera(30);
  filaPend = JSON.parse(localStorage.getItem('caderno_pendentes_c1'));
  assert(filaPend[idA] && filaPend[idB], 'abrir outro retorno sem internet não derruba as pendentes da fila');
  // rede volta: o evento "online" reenvia a fila inteira, sem duplicar e sem perder nada
  window.__falharEscrita = null;
  window.dispatchEvent(new window.Event('online'));
  await espera(80);
  const upA = window.__escritas.filter(e => e.tabela === 'caderno_notas' && e.op === 'upsert' && e.rows.id === idA).pop();
  const upB = window.__escritas.filter(e => e.tabela === 'caderno_notas' && e.op === 'upsert' && e.rows.id === idB).pop();
  assert(upA && upA.rows.texto === 'nota A sem internet', 'nota A é reenviada quando a rede volta');
  assert(upB && upB.rows.texto === 'nota B sem internet', 'nota B é reenviada quando a rede volta');
  filaPend = JSON.parse(localStorage.getItem('caderno_pendentes_c1')) || {};
  assert(!filaPend[idA] && !filaPend[idB], 'nenhuma das duas fica na fila depois de enviada');

  // salvamento serializado por nota: uma resposta atrasada (da v1) não pode apagar a v2 editada por cima (fix round 2)
  await cdNovo(); await espera(10);
  const idV = cdEstado.nota.id;
  const fromOriginal = sb.from.bind(sb);
  let primeiraChamada = true;
  sb.from = (tabela) => {
    const b = fromOriginal(tabela);
    if(tabela !== 'caderno_notas') return b;
    return Object.assign({}, b, { upsert: (rows, opts) => {
      if(primeiraChamada){ primeiraChamada = false; return new Promise(resolve => setTimeout(() => resolve(b.upsert(rows, opts)), 60)); }
      return b.upsert(rows, opts);
    } });
  };
  digita('cdF_telefone', '19990000009');
  digita('cdTexto', 'v1');
  await espera(5); // dispara o upsert da v1 (lento: só responde em 60ms) — é a única chamada em voo
  // edita por cima sem passar por cdAgendarSalvar (como aconteceria se o debounce ainda estivesse
  // esperando a digitação parar): isola o mecanismo de versão, sem um segundo envio encadeado para
  // "consertar" sozinho — só a resposta (atrasada) da v1 está em voo quando a v2 é escrita.
  cdEstado.nota.texto = 'v2';
  cdTocar(cdEstado.nota);
  document.getElementById('cdTexto').value = 'v2';
  assert(document.getElementById('cdStatus').textContent !== 'Salvo ✓', 'não mostra salvo logo depois de editar por cima de um envio em voo');
  await espera(110); // a v1 (atrasada) responde, vê que já está velha e manda a v2 na hora; espera a v2 confirmar
  sb.from = fromOriginal;
  const upsV = window.__escritas.filter(e => e.tabela === 'caderno_notas' && e.op === 'upsert' && e.rows.id === idV);
  assert(upsV.length >= 2, 'a v1 atrasada e a v2 chegam a virar upsert (a v1 não é descartada, só não vale mais)');
  eq(upsV[upsV.length - 1].rows.texto, 'v2', 'a última versão que o banco recebe é a v2, nunca a v1 atrasada por cima dela');
  eq(document.getElementById('cdStatus').textContent, 'Salvo ✓', 'confirma salvo só depois que a versão mais nova (v2) chegou no banco');
  let filaV = JSON.parse(localStorage.getItem('caderno_pendentes_c1')) || {};
  assert(!filaV[idV], 'depois de confirmar a v2, a nota sai da fila de pendentes');

  // cdEnviarPendentes chamado duas vezes seguidas: nunca duas passadas em paralelo pela mesma nota
  window.__falharEscrita = (t) => (t === 'caderno_notas' ? { message: 'Failed to fetch' } : null);
  await cdNovo(); await espera(10);
  const idX = cdEstado.nota.id;
  digita('cdF_telefone', '19990000010');
  digita('cdTexto', 'fila dupla X');
  await espera(40);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'N', altKey: true, shiftKey: true }));
  await espera(40);
  const idY = cdEstado.nota.id;
  digita('cdF_telefone', '19990000011');
  digita('cdTexto', 'fila dupla Y');
  await espera(40);
  window.__falharEscrita = null;
  const antesX = window.__escritas.filter(e => e.tabela === 'caderno_notas' && e.op === 'upsert' && e.rows.id === idX).length;
  const antesY = window.__escritas.filter(e => e.tabela === 'caderno_notas' && e.op === 'upsert' && e.rows.id === idY).length;
  await Promise.all([cdEnviarPendentes(), cdEnviarPendentes()]); // as duas chamadas "ao mesmo tempo": a segunda só reagenda, não roda junto
  await espera(30);
  const depoisX = window.__escritas.filter(e => e.tabela === 'caderno_notas' && e.op === 'upsert' && e.rows.id === idX).length;
  const depoisY = window.__escritas.filter(e => e.tabela === 'caderno_notas' && e.op === 'upsert' && e.rows.id === idY).length;
  eq(depoisX - antesX, 1, 'nota X é enviada uma única vez mesmo com duas chamadas simultâneas de cdEnviarPendentes');
  eq(depoisY - antesY, 1, 'nota Y é enviada uma única vez mesmo com duas chamadas simultâneas de cdEnviarPendentes');
  const filaDupla = JSON.parse(localStorage.getItem('caderno_pendentes_c1')) || {};
  assert(!filaDupla[idX] && !filaDupla[idY], 'as duas saem da fila depois do envio (sem duplicar nem perder)');

  // logout limpa
  cadernoResetar();
  assert(document.getElementById('cdBotao').style.display === 'none' && !document.getElementById('cdGaveta').classList.contains('aberta'), 'logout esconde o Caderno');
  Date.now = nowReal;

  // ==== TASK 11: janela flutuante ====
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  cadernoAoEntrar(); cdAbrir();
  const pip = new window.__JSDOM('<!doctype html><html><head></head><body></body></html>').window;
  window.documentPictureInPicture = { requestWindow: async (o) => { window.__pipOpts = o; return pip; } };
  await cdAbrirFlutuante();
  eq(window.__pipOpts, { width: 420, height: 720 }, 'tamanho da janela');
  assert(pip.document.getElementById('cdGaveta') && pip.document.getElementById('cdGaveta').classList.contains('flutuante'), 'gaveta foi para a janela flutuante');
  assert(!document.getElementById('cdGaveta'), 'saiu da página principal');
  assert(pip.document.head.querySelectorAll('style').length >= 1, 'estilos copiados');
  // digitar na janela flutuante continua salvando
  const tel = pip.document.getElementById('cdF_telefone');
  tel.value = '19990000009'; tel.dispatchEvent(new pip.Event('input', { bubbles: true }));
  await espera(30);
  assert(window.__escritas.some(e => e.tabela === 'caderno_notas' && e.rows.telefone === '19990000009'), 'salva a partir da janela flutuante');
  // Alt+N na janela flutuante funciona
  pip.document.dispatchEvent(new pip.KeyboardEvent('keydown', { key: 'N', altKey: true, shiftKey: true }));
  await espera(30);
  eq(pip.document.getElementById('cdF_telefone').value, '', 'Alt+Shift+N na flutuante');
  // fechar a janela devolve a gaveta
  pip.dispatchEvent(new pip.Event('pagehide'));
  assert(document.getElementById('cdGaveta') && !document.getElementById('cdGaveta').classList.contains('flutuante'), 'volta para a página');
  // sem PiP: usa janela comum
  delete window.documentPictureInPicture;
  const pop = new window.__JSDOM('<!doctype html><html><head></head><body></body></html>').window;
  window.open = (u, nome, feat) => { window.__popup = { u, nome, feat }; return pop; };
  await cdAbrirFlutuante();
  eq([window.__popup.nome, window.__popup.feat], ['cadernoApex', 'width=420,height=720'], 'reserva com window.open');
  assert(pop.document.getElementById('cdGaveta'), 'gaveta na janela comum');
  pop.dispatchEvent(new pop.Event('pagehide'));
  // janela bloqueada: avisa e não perde a gaveta
  window.open = () => null;
  const okFlutuar = await cdAbrirFlutuante();
  assert(!okFlutuar && document.getElementById('cdGaveta') && avisos().includes('janela flutuante'), 'popup bloqueado: aviso');

  // ==== TASK 11 fix round 1: logout com a janela flutuante aberta (achado crítico da revisão) —
  // não pode deixar a janela aberta (dado do consultor anterior visível numa tela compartilhada) nem
  // deixar cdEstado.doc preso no documento antigo (quebraria o Caderno do próximo login) ====
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  cadernoAoEntrar(); cdAbrir();
  const pip2 = new window.__JSDOM('<!doctype html><html><head></head><body></body></html>').window;
  window.__pip2Fechada = false;
  pip2.close = () => { window.__pip2Fechada = true; };
  window.documentPictureInPicture = { requestWindow: async () => pip2 };
  await cdAbrirFlutuante();
  assert(pip2.document.getElementById('cdGaveta').classList.contains('flutuante'), 'flutuando de novo antes do logout');
  const telLogout = pip2.document.getElementById('cdF_telefone');
  telLogout.value = '19990000012'; telLogout.dispatchEvent(new pip2.Event('input', { bubbles: true }));
  await espera(30);
  cadernoResetar();
  delete window.documentPictureInPicture;
  assert(cdEstado.doc === document, 'logout com a janela flutuante aberta: cdEstado.doc volta a apontar pro documento principal');
  assert(document.getElementById('cdGaveta') && !document.getElementById('cdGaveta').classList.contains('flutuante'), 'gaveta de volta no app principal depois do logout');
  assert(window.__pip2Fechada, 'logout fecha a janela flutuante (não deixa dado do consultor anterior visível numa tela compartilhada)');
  // o próximo consultor loga e o Caderno da página principal funciona normalmente (nada ficou preso na janela antiga)
  currentUser = { id: 'c2', nome: 'Outro Consultor', username: 'cons2', role: 'consultor' };
  cadernoAoEntrar(); cdAbrir();
  digita('cdF_telefone', '19990000013');
  await espera(30);
  assert(window.__escritas.some(e => e.tabela === 'caderno_notas' && e.rows.telefone === '19990000013'), 'depois do logout com a janela flutuante, o Caderno da página principal volta a salvar normalmente');

  // ==== mais testes entram aqui ====
  fim();
`);
