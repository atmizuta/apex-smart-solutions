// Testa o Kanban de Portabilidade (controle do SMS da Anatel). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const hoje = pbHoje();
  const C = (o) => Object.assign({ cnpj: '00000000000100', usuario_id: 1, cliente: 'Zz Um', usuario: 'Zza', total: 2, abertas: 2, portadas: 0, encerradas: 0, etapa: 'aguardando_sms', reenvios: 0, proximo_retorno: null, observacao: null, primeiro_cadastro: '2026-11-03T03:00:00+00:00',
    linhas: [{ item_id: 1, pedido: '1', etapa: 'BIOMETRIA (NEOCRM)', situacao: 'aberta', ddd: '11', telefone: '(11) 99157-0918' }, { item_id: 2, pedido: '2', etapa: 'ENTREGA (NEOCRM)', situacao: 'aberta', ddd: '11', telefone: '11988887777' }] }, o);
  let quadro = [C({}), C({ cnpj: '00000000000200', cliente: 'Zz Dois', usuario_id: 2, usuario: 'Zzb', etapa: 'sms_reenviado', reenvios: 1, proximo_retorno: '2020-01-01', linhas: [{ item_id: 9, pedido: '9', etapa: 'ENTREGA (NEOCRM)', situacao: 'aberta', ddd: '12', telefone: '12977776666' }] }),
    C({ cnpj: '00000000000300', cliente: 'Zz Tres', etapa: 'portado', abertas: 0, portadas: 2 }), C({ cnpj: '00000000000400', cliente: 'Zz Quatro', etapa: 'encerrado', abertas: 0, encerradas: 2 })];
  window.__rpcRespostas.portabilidade_quadro = () => ({ data: quadro, error: null });
  window.__rpcRespostas.portabilidade_historico_cliente = () => ({ data: [{ tipo: 'reenvio', texto: 'SMS reenviado (1º)', criado_em: '2026-11-26T13:00:00Z', quem: 'Zza' }], error: null });
  window.__rpcRespostas.portabilidade_registrar = (a) => ({ data: { etapa: a.p_etapa || (a.p_reenviou ? 'sms_reenviado' : 'aguardando_sms'), reenvios: a.p_reenviou ? 1 : 0, proximo_retorno: a.p_retorno || null, observacao: a.p_observacao || null }, error: null });
  // permissão: consultor vê a aba; só-renovação não
  currentUser = { id: 'u-a', nome: 'Zza', role: 'consultor', operacao: 'apex' }; rnAplicarPermissao();
  eq(document.getElementById('tabBtnPortabilidade').style.display, 'inline-block', 'consultor vê Portabilidade');
  currentUser = { id: 'u-r', nome: 'Zzr', role: 'consultor', operacao: 'apex', equipe: 'renovacao' }; rnAplicarPermissao();
  eq(document.getElementById('tabBtnPortabilidade').style.display, 'none', 'time de renovação não vê');
  currentUser = { id: 'u-adm', nome: 'Zzadm', role: 'admin', operacao: 'apex' }; rnAplicarPermissao();
  await pbCarregar();
  const col = (k) => [...document.querySelectorAll('[data-pb-coluna="' + k + '"] .pbCard')].map(c => c.querySelector('.rnNome').textContent);
  eq([col('aguardando_sms'), col('sms_reenviado'), col('portado'), col('sem_resposta')], [['Zz Um'], ['Zz Dois'], ['Zz Tres'], []], 'clientes nas colunas certas; encerrado fica fora');
  assert(document.getElementById('pbSumario').textContent.includes('1 encerrado'), 'sumário cita encerrados');
  assert(document.querySelector('[data-pb-coluna="aguardando_sms"] .pbCard').textContent.includes('(11) 99157-0918') && document.querySelector('[data-pb-coluna="aguardando_sms"] .pbCard').textContent.includes('(11) 98888-7777'), 'cartão mostra os números das linhas');
  assert(document.querySelector('[data-pb-coluna="sms_reenviado"] .pbAtraso'), 'retorno vencido destacado');
  // filtros
  const bu = document.getElementById('pbBusca'); bu.value = '98888'; bu.dispatchEvent(new window.Event('input', { bubbles: true }));
  eq([col('aguardando_sms'), col('sms_reenviado')], [['Zz Um'], []], 'busca por telefone');
  bu.value = ''; bu.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('[data-pb-chip="atrasados"]').click(); eq(col('sms_reenviado'), ['Zz Dois'], 'chip atrasados'); eq(col('aguardando_sms'), [], 'chip esconde os demais');
  document.querySelector('[data-pb-chip="atrasados"]').click();
  // reenviei o SMS
  document.querySelector('[data-pb-coluna="aguardando_sms"] .pbCard').click(); await espera(40);
  assert(document.getElementById('pbFicha').textContent.includes('Reenviei o SMS'), 'ficha abre');
  document.querySelector('#pbFicha [data-pb-reenviei]').click(); await espera(40);
  eq(window.__rpcCalls.filter(c => c.nome === 'portabilidade_registrar').pop().args.p_reenviou, true, 'chama a RPC de reenvio');
  eq(col('sms_reenviado').includes('Zz Um'), true, 'card vai para SMS reenviado');
  // salvar etapa/retorno/obs
  [...document.querySelectorAll('[data-pb-coluna="sms_reenviado"] .pbCard')].find(c => c.textContent.includes('Zz Um')).click(); await espera(40);
  document.getElementById('pbFEtapa').value = 'sem_resposta'; document.getElementById('pbFRetorno').value = '2026-12-01'; document.getElementById('pbFObs').value = 'Zz sem sinal';
  document.querySelector('#pbFicha [data-pb-salvar]').click(); await espera(40);
  const a = window.__rpcCalls.filter(c => c.nome === 'portabilidade_registrar').pop().args;
  eq([a.p_etapa, a.p_retorno, a.p_observacao, a.p_usuario], ['sem_resposta', '2026-12-01', 'Zz sem sinal', 1], 'salva etapa, retorno e observação');
  eq(col('sem_resposta').length, 1, 'card muda de coluna');
  // portado é automático
  document.querySelector('[data-pb-coluna="portado"] .pbCard').click(); await espera(40);
  assert(!document.getElementById('pbFicha').textContent.includes('Reenviei o SMS'), 'portado não tem botão de reenvio');
  fecharOverlay(document.getElementById('pbFicha'));
  // exportar
  let saida = null; XLSX.writeFile = (wb, nome) => { saida = { wb, nome }; };
  pbExportar(); const ln = XLSX.utils.sheet_to_json(saida.wb.Sheets['Portabilidade']);
  eq([ln.length, ln[0]['Telefone']], [5, '(11) 99157-0918'], 'exporta uma linha por número');
  // erro de carga
  window.__rpcRespostas.portabilidade_quadro = () => ({ data: null, error: { message: 'x' } });
  await pbCarregar(); assert(document.getElementById('pbCols').textContent.includes('Não foi possível'), 'mostra erro');
  fim();
`);
