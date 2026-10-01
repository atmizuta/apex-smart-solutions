// Supabase FALSO para a página de demonstração local (25/09/2026). Não acessa o banco real.
// Carregado pelo demo_local.html DEPOIS do supabase-js do CDN, sobrescrevendo window.supabase.
(function(){
  const hoje = new Date();
  const dia = (n) => new Date(hoje.getTime() - n * 864e5).toISOString();
  const consultores = ['Caio Almeida', 'Giovanna Reis', 'Vitor Lima', 'Ana Souza', 'Bruno Costa'];
  const cidades = ['Campinas', 'São José dos Campos', 'Sorocaba', 'Ribeirão Preto', 'Jundiaí'];
  const etapas = ['CONCLUIDO (NEOCRM)', 'ENTREGA (NEOCRM)', 'FATURAMENTO (NEOCRM)', 'VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)', 'ANALISE DE CREDITO (NEOCRM)',
    'ANTIFRAUDE (NEOCRM)', 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', 'PORTABILIDADE EM TRATATIVA (NEOCRM)'];
  const produtos = ['Móvel 15GB', 'Móvel 30GB', 'Banda Larga 500MB', 'Banda Larga 1GB', 'Aparelho', 'SVA Fixa'];
  const r = (arr, i) => arr[i % arr.length];
  const cnpj = (i) => String(10000000000100 + i * 7919).padStart(14, '0');

  const db = {
    profiles: [{ id: 'demo-admin', nome: 'Demonstração', username: 'demo', role: 'admin', created_at: dia(90) }]
      .concat(consultores.map((n, i) => ({ id: 'demo-c' + i, nome: n, username: n.split(' ')[0].toLowerCase(), role: 'consultor', created_at: dia(60) }))),
    clientes: Array.from({ length: 80 }, (_, i) => ({ id: i + 1, cnpj: cnpj(i), cnpj_digits: cnpj(i), tel1: '(19) 99999-' + String(1000 + i).slice(-4), razao_social: `EMPRESA EXEMPLO ${i + 1} LTDA`, tempo_contrato_voz: 6 + (i * 7) % 30,
      linhas_voz: 1 + (i % 12), linhas_fixas: i % 3, telefone_contato: '(19) 99999-' + String(1000 + i).slice(-4), nome_admin: r(consultores, i), cidade: r(cidades, i),
      apto_renovacao: (6 + (i * 7) % 30) > 15 ? 'APTO' : 'NAO APTO', cep: '13000-000', valor_contrato: 150 + (i * 37) % 900, arpu: 45 + i % 40, ddd: '19', atualizado_em: dia(i % 20) })),
    propostas: Array.from({ length: 18 }, (_, i) => ({ id: 'p' + i, consultor_id: 'demo-c' + (i % 5), cliente_nome: `EMPRESA EXEMPLO ${i + 1} LTDA`, cliente_cnpj: cnpj(i),
      cliente_cidade: r(cidades, i), cliente_ddd: '19', origem: i % 2 ? 'base' : 'avulsa', tipo_proposta: 'renovacao', valor_atual: 400 + i * 35, valor_proposto: 360 + i * 30,
      estagio: r(['lead', 'proposta_enviada', 'negociacao', 'fechado_ganho', 'fechado_perdido'], i), estagio_entrada_em: dia(i % 4), criado_em: dia(i), atualizado_em: dia(i % 3), dados: {} })),
    propostas_historico: [],
    producao_pedidos: Array.from({ length: 140 }, (_, i) => ({ id: i + 1, numero_pedido: 'PED' + (5000 + Math.floor(i / 2)), grupo: 'APEX', usuario: r(consultores, i),
      etapa: r(etapas, i), cadastro: dia(i % 25), atualizacao: dia(i % 25), valor: 60 + (i * 13) % 240, quantidade: 1 + i % 3, produto: r(produtos, i),
      cliente: `EMPRESA EXEMPLO ${1 + i % 60} LTDA`, cnpj: cnpj(i % 60), tag: '', criado_em: dia(i % 25) })),
    leads: Array.from({ length: 90 }, (_, i) => ({ id: 'l' + i, aba: i % 9 === 0 ? 'REPIQUE' : (i % 4 === 0 ? 'AGOSTO' : 'SETEMBRO'), criado_em_lead: dia(i % 28), full_name: 'Lead ' + (i + 1), cnpj: cnpj(i), city: r(cidades, i),
      consultor: r(consultores, i), status: r(['CONVERTIDO', 'EM ANDAMENTO', 'PERDIDO', 'SEM CONTATO'], i), categoria: r(['convertido', 'andamento', 'perdido', 'sem_contato'], i),
      converteu: i % 4 === 0, receita: i % 4 === 0 ? 120 + i * 3 : 0, platform: i % 2 ? 'ig' : 'fb', atualizado_em: dia(i % 5) })),
    clientes_movimentacao: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, tipo: r(['entrou', 'saiu', 'mudou'], i), cnpj: cnpj(i), razao_social: `EMPRESA EXEMPLO ${i + 1} LTDA`,
      cidade: r(cidades, i), dados_antes: {}, dados_depois: {}, campos_alterados: ['valor_contrato'], detectado_em: dia(i % 30) })),
    clientes_movimentacao_resumo: [], consultas_log: [], cobertura_kmz: [],
    config: [{ chave: 'leads_ultima_sync', valor: new Date().toLocaleString('pt-BR') },
      { chave: 'producao_atualizado_em', valor: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }],
  };

  function builder(tabela){
    let dados = (db[tabela] || []).slice(), unico = false;
    const q = new Proxy({}, {
      get(_, p){
        if(p === 'then') return (res) => res({ data: unico ? (dados[0] || null) : dados, error: null, count: dados.length });
        if(p === 'single' || p === 'maybeSingle') return () => { unico = true; return q; };
        if(p === 'eq') return (col, val) => { dados = dados.filter(x => x[col] === undefined || x[col] === val); return q; };
        if(p === 'range') return (a, b) => { dados = dados.slice(a, b + 1); return q; };
        if(p === 'limit') return (n) => { dados = dados.slice(0, n); return q; };
        return () => q; // select, order, in, gte, lt, lte, ilike, or, insert, update, upsert, delete…
      },
    });
    return q;
  }

  // 30/09/2026: "?papel=consultor" abre a demo como o Caio Almeida (consultor), com a aba "Pedidos Parados" cheia de dados fictícios.
  const papel = new URLSearchParams(location.search).get('papel') === 'consultor' ? 'consultor' : 'admin';
  const sessao = { user: { id: papel === 'consultor' ? 'demo-c0' : 'demo-admin', email: 'demo@apexclientes.com' } };
  const ped = (n, etapa, diasAtras, valor, cli, extra) => Object.assign({ numero_pedido: 'DEMO' + n, grupo: 'VOZ - Portabilidade', usuario: 'CAIO ALMEIDA', etapa: etapa + ' (NEOCRM)',
    cadastro: dia(diasAtras + 6), atualizacao: dia(diasAtras), na_etapa_desde: dia(diasAtras), valor, quantidade: 1, produto: 'Claro Pós 25GB', cliente: cli, cnpj: cnpj(n), tag: '',
    data_portabilidade: null, data_instalacao: null }, extra || {});
  const meusPedidos = [
    ped(1, 'ANTIFRAUDE', 12, 189.9, 'Mercado Santo Antônio LTDA'), ped(2, 'ANTIFRAUDE', 4, 99.9, 'Clínica Vida e Saúde ME'),
    ped(3, 'BIOMETRIA', 9, 59.99, 'Padaria Pão Quente LTDA'), ped(4, 'BIOMETRIA', 3, 79.99, 'Oficina Irmãos Silva ME'),
    ped(5, 'AGUARDANDO ASSINATURA', 7, 149.9, 'Transportes Rota 66 LTDA'), ped(6, 'PORTABILIDADE EM TRATATIVA', 15, 119.9, 'Escritório Lima & Souza'),
    ped(7, 'PORTABILIDADE EM ANDAMENTO', 5, 89.9, 'Farmácia Central ME'), ped(8, 'ENTREGA', 2, 69.9, 'Loja Bella Moda LTDA', { data_portabilidade: dia(1) }),
    ped(9, 'ENTREGA', 8, 99.9, 'Academia Corpo Ativo LTDA', { data_portabilidade: dia(-3) }), ped(10, 'VALIDAÇÃO ESIM', 6, 59.99, 'Consultoria Nova Era ME', { data_portabilidade: dia(3) }),
    ped(11, 'CREDITO', 4, 109.9, 'Construtora Alicerce LTDA'), ped(12, 'NEGOCIACAO', 1, 79.9, 'Hotel Mirante LTDA'),
    ped(13, 'VENDA PERDIDA', 20, 129.9, 'Restaurante Sabor Caseiro', { tag: '#HOTLEAD' }), ped(14, 'VENDA PERDIDA', 45, 89.9, 'Auto Peças Horizonte', { tag: '#SEMCREDITO' }),
    ped(15, 'VENDA PERDIDA', 12, 59.9, 'Studio Corte Fino', { tag: '#SEMCREDITO' }), ped(16, 'VENDA PERDIDA', 30, 99.9, 'Imobiliária Norte Sul', { tag: '#SEMINTERESSE' }),
    ped(17, 'DEVOLVIDO', 10, 79.9, 'Distribuidora Boa Safra', { tag: '#COMRESTRICAO' }),
    ped(18, 'CONCLUIDO', 55, 149.9, 'Escola Aprender Mais LTDA', { data_portabilidade: dia(55) }), ped(19, 'CONCLUIDO', 80, 219.9, 'Grupo Horizonte Serviços', { data_portabilidade: dia(80) }),
    ped(20, 'CONCLUIDO', 9, 179.9, 'Vidraçaria Cristal ME', { data_portabilidade: dia(9) }), ped(21, 'CONCLUIDO', 14, 259.9, 'Gráfica Expressa LTDA', { data_instalacao: dia(14), grupo: 'BANDA LARGA - Novo' }),
  ];
  if(papel === 'consultor'){
    db.consultor_neo = [{ profile_id: 'demo-c0', neo_usuario_id: 1 }];
    db.metas_consultor = [{ profile_id: 'demo-c0', mes: new Date().toISOString().slice(0, 8) + '01', meta_receita: 1500 }];
    db.config.push({ chave: 'producao_neo_atualizado_em', valor: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) });
  }
  function rpcFalso(nome){
    let res = { data: { total: 22, ganho: 9, perdido: 5, andamento: 6, semPedido: 2, pedidosGanho: [], pedidosPerdido: [], pedidosAndamento: [] }, error: null };
    if(nome === 'get_my_role') res = { data: papel, error: null };
    if(nome === 'producao_meus_pedidos') res = { data: meusPedidos, error: null };
    if(nome === 'minhas_movimentacoes') res = { data: [{ numero_pedido: 'DEMO2', cliente: 'Clínica Vida e Saúde ME', etapa_anterior: 'CREDITO (NEOCRM)', etapa_nova: 'ANTIFRAUDE (NEOCRM)', em: dia(0.1), valor: 99.9 }], error: null };
    if(nome === 'cnpjs_com_pedido_aberto_de_outros') res = { data: [cnpj(13)], error: null };
    if(nome === 'neo_usuarios_detectados') res = { data: [], error: null };
    return { range: (a, b) => Promise.resolve(Array.isArray(res.data) ? Object.assign({}, res, { data: res.data.slice(a, b + 1) }) : res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  }
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: sessao } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      signInWithPassword: async () => ({ data: { session: sessao, user: sessao.user }, error: null }), signOut: async () => ({ error: null }), getUser: async () => ({ data: { user: sessao.user } }) },
    from: builder,
    rpc: rpcFalso,
    functions: { invoke: async () => ({ data: { ok: true, demo: true, total: 90, atualizado_em: new Date().toLocaleString('pt-BR') }, error: null }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  }) };
  console.info('[demo] Supabase falso ativo — nada aqui toca o banco real.');
})();
