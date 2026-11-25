// Testa a §156 — aba Sócios da ficha da Renovação (base da Receita + Nova Vida). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-16'; rnHoraSP = () => '16:00';
  const L = (o) => Object.assign({ razao_social: 'Zz', telefone: '19900000001', linhas_voz: 1, apto: 'APTO', status: 3, na_base: true, consultor_id: 'u-a', prox_retorno: '2026-11-10' }, o);
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [L({ id: 1, razao_social: 'Zz Um', cnpj_digits: '00000000000191' }), L({ id: 2, razao_social: 'Zz Dois', cnpj_digits: '00000000000272', prox_retorno: '2026-11-11' })];
  window.__tabelas.propostas = []; window.__tabelas.renovacao_historico = [];
  window.__tabelas.socios_consultas = [];
  const BASE = { ok: true, receita_mes: '2026-09', socios: [{ nome: 'ZZ SOCIA BASE', cpf: '12345678909', principal: true, obito: false }, { nome: 'ZZ SOCIO FALECIDO', cpf: '98765432100', principal: false, obito: true }] };
  window.__rpcRespostas.socios_da_base = (a) => ({ data: a.p_carteira_id === 1 ? BASE : { ok: true, receita_mes: '2026-09', socios: [] }, error: null });
  const sec = () => document.querySelector('#rnFichaCorpo [data-rn-ficha-sec="socios"]');
  const aba = () => ({ click(){} });   // ficha única: as seções ficam sempre visíveis
  const clicar = (sel) => document.querySelector(sel).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await rnCarregar(); rnTrocarAba('hoje'); await espera(60);
  eq(rnEstado.fichaId, 1, 'ficha aberta no cliente 1');
  eq([...document.querySelectorAll('#rnFichaCorpo [data-rn-ficha-sec]')].map(b => b.dataset.rnFichaSec), ['atendimento', 'dados', 'propostas', 'historico', 'socios'], 'seção Sócios na ficha única (sem abas)');
  assert(!document.querySelector('#rnFichaCorpo [data-rn-ficha-aba]'), 'ficha sem abas');

  // 1. base com sócio: nome, CPF formatado, principal, óbito, fonte e botão Consultar na Nova Vida
  const t1 = sec().textContent;
  assert(/ZZ SOCIA BASE/.test(t1) && /123\\.456\\.789-09/.test(t1), 'mostra nome e CPF da base');
  assert(/principal/i.test(t1) && /consta óbito/i.test(t1), 'etiquetas principal e óbito');
  assert(/Receita Federal, base de 09\\/2026/.test(t1) && /sem telefones/.test(t1), 'fonte da base com o mês');
  assert(/Consultar na Nova Vida/.test(sec().querySelector('[data-rn-socios-pedir]').textContent), 'botão Consultar na Nova Vida');

  // copiar CPF
  let copiado = null; Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { copiado = t; } } });
  clicar('#rnFichaCorpo [data-rn-socios-copiar="12345678909"]'); await espera(10);
  eq(copiado, '12345678909', 'copia o CPF só com dígitos');

  // 2. pedir: chama a RPC com o id da carteira e entra em andamento
  window.__rpcRespostas.socios_pedir = () => ({ data: { ok: true, id: 50, status: 'pendente' }, error: null });
  window.__tabelas.socios_consultas = [{ id: 50, cnpj_digits: '00000000000191', status: 'pendente', pedido_por: 'u-a', pedido_em: new Date().toISOString(), concluido_em: null, resultado: null, erro: null }];
  clicar('#rnFichaCorpo [data-rn-socios-pedir]'); await espera(20);
  eq(window.__rpcCalls.filter(c => c.nome === 'socios_pedir').map(c => c.args), [{ p_carteira_id: 1 }], 'RPC socios_pedir com o id');
  assert(/Consultando na Nova Vida… 0:0\\d/.test(sec().textContent), 'mostra o relógio');
  assert(/ZZ SOCIA BASE/.test(sec().textContent), 'a base continua visível durante a consulta');
  assert(!sec().querySelector('[data-rn-socios-pedir]'), 'sem botão enquanto consulta (antes de 3 min)');
  assert(rnEstado.sociosTimer, 'agendou a releitura');

  // a releitura repinta só a seção: a observação em digitação não se perde
  aba('atendimento').click();
  document.getElementById('rnFichaForm').elements.observacoes.value = 'Zz digitando';
  window.__tabelas.socios_consultas[0].status = 'consultando';
  await rnSociosReler(); await espera(10);
  eq(document.getElementById('rnFichaForm').elements.observacoes.value, 'Zz digitando', 'releitura não apaga o atendimento');
  aba('socios').click();

  // 3. pendente há mais de 3 min: Tentar de novo
  window.__tabelas.socios_consultas[0].status = 'pendente';
  window.__tabelas.socios_consultas[0].pedido_em = new Date(Date.now() - 4 * 60000).toISOString();
  await rnSociosReler(); await espera(10);
  assert(/Tentar de novo/.test(sec().querySelector('[data-rn-socios-pedir]').textContent), 'Tentar de novo após 3 min');

  // 4. pronto: cartões da Nova Vida têm prioridade sobre a base; telefones com WhatsApp/Ligar; rodapé com Atualizar
  Object.assign(window.__tabelas.socios_consultas[0], { status: 'pronto', concluido_em: '2026-11-16T18:40:00Z', resultado: { socios: [
    { nome: 'ZZ SOCIA NV', cpf: '12345678909', participacao: 50, telefones_consultados: true, telefones: [
      { tipo: 'celular', numero: '11900000001', operadora: 'CLARO', whatsapp: true }, { tipo: 'fixo', numero: '1130000001', operadora: 'VIVO', whatsapp: false }] },
    { nome: 'ZZ SOCIO SEXTO', cpf: '98765432100', participacao: null, telefones_consultados: false, telefones: [] }] } });
  await rnSociosReler(); await espera(10);
  const t4 = sec().textContent;
  assert(/ZZ SOCIA NV/.test(t4) && !/ZZ SOCIA BASE/.test(t4), 'resultado da Nova Vida substitui a base');
  assert(/50%/.test(t4) && /\\(11\\) 90000-0001/.test(t4) && /\\(11\\) 3000-0001/.test(t4), 'participação e telefones formatados');
  eq(sec().querySelector('a[href^="https://wa.me/"]').getAttribute('href'), 'https://wa.me/5511900000001', 'WhatsApp do celular');
  eq(sec().querySelectorAll('a[href^="https://wa.me/"]').length, 1, 'fixo não tem WhatsApp');
  assert(/Telefones não consultados/.test(t4), 'sexto sócio sem telefones');
  assert(/Consultado em 16\\/11 15:40 por Zza Teste/.test(t4), 'rodapé com data e quem pediu');
  assert(/Atualizar/.test(sec().querySelector('[data-rn-socios-pedir]').textContent), 'botão Atualizar');
  assert(!rnEstado.sociosTimer, 'parou a releitura ao terminar');
  // layout (pedido do Rafael 17/11): cartão por sócio; telefones em linhas de grade com as ações alinhadas à direita
  eq(sec().querySelectorAll('.rnSoc').length, 2, 'um cartão .rnSoc por sócio');
  eq(sec().querySelectorAll('.rnSocFone').length, 2, 'uma linha .rnSocFone por telefone');
  assert([...sec().querySelectorAll('.rnSocFone')].every(l => l.querySelector('.rnSocAcoes [data-rn-canal="Ligação"]')), 'Ligar dentro da coluna de ações de cada linha');
  assert(!sec().querySelector('ul.rnHist'), 'sem lista com marcadores');
  assert(sec().querySelector('.rnSocRodape [data-rn-socios-pedir]').classList.contains('kbBtnSm'), 'Atualizar pequeno no rodapé');
  assert(sec().querySelector('.rnSocCpf [data-rn-socios-copiar]'), 'Copiar na linha do CPF');
  clicar('#rnFichaCorpo [data-rn-ficha-sec="socios"] [data-rn-canal="WhatsApp"]');
  eq(document.getElementById('rnFichaForm').elements.canal.value, 'WhatsApp', 'WhatsApp do sócio marca o canal');

  // 5. erro: mensagem + Tentar de novo, e o resultado anterior continua
  window.__tabelas.socios_consultas.unshift({ id: 51, cnpj_digits: '00000000000191', status: 'erro', pedido_por: 'u-a', pedido_em: new Date().toISOString(), concluido_em: new Date().toISOString(), resultado: null, erro: 'A consulta na Nova Vida falhou.' });
  await rnSociosCarregar(1); await espera(10);
  assert(/A consulta na Nova Vida falhou/.test(sec().textContent) && /Tentar de novo/.test(sec().textContent), 'erro com Tentar de novo');
  assert(/ZZ SOCIA NV/.test(sec().textContent), 'resultado anterior continua no erro');

  // 6. limite
  window.__rpcRespostas.socios_pedir = () => ({ data: { ok: false, motivo: 'limite' }, error: null });
  clicar('#rnFichaCorpo [data-rn-socios-pedir]'); await espera(20);
  assert(/Você já fez 20 consultas hoje/.test(sec().textContent), 'aviso de limite');

  // 7. cliente 2: base sem sócio; resposta atrasada do cliente 1 não pinta a ficha do 2
  window.__tabelas.socios_consultas = [];
  await rnAbrirFicha(2); await espera(30);
  aba('socios').click();
  assert(/A base da Receita não tem os sócios deste CNPJ/.test(sec().textContent), 'sem sócio na base');
  await rnSociosCarregar(1); await espera(10);
  assert(/não tem os sócios/.test(sec().textContent), 'resposta de outro cliente não pinta esta ficha');

  // 8. sem_socios
  window.__tabelas.socios_consultas = [{ id: 60, cnpj_digits: '00000000000272', status: 'sem_socios', pedido_por: 'u-a', pedido_em: '2026-11-16T18:00:00Z', concluido_em: '2026-11-16T18:02:00Z', resultado: null, erro: null }];
  await rnSociosCarregar(2); await espera(10);
  assert(/A Nova Vida não mostra sócios para este CNPJ/.test(sec().textContent), 'sem_socios');

  // fechar a ficha e trocar de usuário param a releitura
  window.__tabelas.socios_consultas[0].status = 'pendente';
  await rnSociosCarregar(2); await espera(10);
  assert(rnEstado.sociosTimer, 'agendou');
  rnFecharFicha();
  assert(!rnEstado.sociosTimer, 'fechar a ficha para a releitura');
  await rnAbrirFicha(2); await espera(30);
  rnAplicarPermissao();
  assert(!rnEstado.sociosTimer && !rnEstado.socios, 'trocar de usuário limpa os sócios');
  // 9. (revisão) sem_socios com sócio na base: a lista da Receita continua visível
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.socios_consultas = [{ id: 70, cnpj_digits: '00000000000191', status: 'sem_socios', pedido_por: 'u-a', pedido_em: '2026-11-16T18:00:00Z', concluido_em: '2026-11-16T18:02:00Z', resultado: null, erro: null }];
  await rnCarregar(); rnTrocarAba('hoje'); await espera(60);
  eq(rnEstado.fichaId, 1, 'ficha 1 de novo');
  aba('socios').click();
  assert(/A Nova Vida não mostra sócios/.test(sec().textContent) && /ZZ SOCIA BASE/.test(sec().textContent), 'sem_socios mantém a lista da base');

  // 10. (revisão) consultando há mais de 10 min: aparece Tentar de novo
  window.__tabelas.socios_consultas = [{ id: 71, cnpj_digits: '00000000000191', status: 'consultando', pedido_por: 'u-a', pedido_em: new Date(Date.now() - 12 * 60000).toISOString(), iniciado_em: new Date(Date.now() - 11 * 60000).toISOString(), concluido_em: null, resultado: null, erro: null }];
  await rnSociosCarregar(1); await espera(10);
  assert(/Tentar de novo/.test((sec().querySelector('[data-rn-socios-pedir]') || {}).textContent || ''), 'consultando preso há 10 min tem Tentar de novo');
  window.__tabelas.socios_consultas[0].iniciado_em = new Date(Date.now() - 2 * 60000).toISOString();
  await rnSociosCarregar(1); await espera(10);
  assert(!sec().querySelector('[data-rn-socios-pedir]'), 'consultando recente não tem botão');
  // 11. (revisão §157) avulsas na ficha: erro de outro consultor não aparece; cópia guardada não vira o "por"
  const RESX = { socios: [{ nome: 'ZZ SOCIA NV', cpf: '12345678909', participacao: 50, telefones_consultados: false, telefones: [] }] };
  window.__tabelas.socios_consultas = [
    { id: 82, cnpj_digits: '00000000000191', origem: 'avulsa', status: 'erro', pedido_por: 'u-x', pedido_em: '2026-11-17T12:00:00Z', concluido_em: '2026-11-17T12:01:00Z', resultado: null, erro: 'A consulta na Nova Vida falhou.', copiado_de: null },
    { id: 81, cnpj_digits: '00000000000191', origem: 'avulsa', status: 'pronto', pedido_por: 'u-x', pedido_em: '2026-11-17T11:00:00Z', concluido_em: '2026-11-16T18:40:00Z', resultado: RESX, erro: null, copiado_de: 80 },
    { id: 80, cnpj_digits: '00000000000191', origem: 'renovacao', status: 'pronto', pedido_por: 'u-a', pedido_em: '2026-11-16T18:00:00Z', concluido_em: '2026-11-16T18:40:00Z', resultado: RESX, erro: null, copiado_de: null },
  ];
  await rnSociosCarregar(1); await espera(10);
  assert(!/A consulta na Nova Vida falhou/.test(sec().textContent), 'erro avulso de outro consultor não aparece na ficha');
  assert(/Consultado em 16\\/11 15:40 por Zza Teste/.test(sec().textContent), 'rodapé com quem consultou de verdade');
  rnFecharFicha();
  fim();
`);
