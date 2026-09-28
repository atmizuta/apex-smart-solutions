// Supabase FALSO para a página de demonstração local (25/09/2026). Não acessa o banco real.
// Carregado pelo demo_local.html DEPOIS do supabase-js do CDN, sobrescrevendo window.supabase.
(function(){
  const hoje = new Date();
  const dia = (n) => new Date(hoje.getTime() - n * 864e5).toISOString();
  const consultores = ['Caio Almeida', 'Giovanna Reis', 'Vitor Lima', 'Ana Souza', 'Bruno Costa'];
  const cidades = ['Campinas', 'São José dos Campos', 'Sorocaba', 'Ribeirão Preto', 'Jundiaí'];
  const etapas = ['CONCLUIDO (NEOCRM)', 'ENTREGA (NEOCRM)', 'FATURAMENTO (NEOCRM)', 'VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)', 'ANALISE DE CREDITO (NEOCRM)'];
  const produtos = ['Móvel 15GB', 'Móvel 30GB', 'Banda Larga 500MB', 'Banda Larga 1GB', 'Aparelho', 'SVA Fixa'];
  const r = (arr, i) => arr[i % arr.length];
  const cnpj = (i) => String(10000000000100 + i * 7919).padStart(14, '0');

  const db = {
    profiles: [{ id: 'demo-admin', nome: 'Demonstração', username: 'demo', role: 'admin', created_at: dia(90) }]
      .concat(consultores.map((n, i) => ({ id: 'demo-c' + i, nome: n, username: n.split(' ')[0].toLowerCase(), role: 'consultor', created_at: dia(60) }))),
    clientes: Array.from({ length: 80 }, (_, i) => ({ id: i + 1, cnpj: cnpj(i), razao_social: `EMPRESA EXEMPLO ${i + 1} LTDA`, tempo_contrato_voz: 6 + (i * 7) % 30,
      linhas_voz: 1 + (i % 12), linhas_fixas: i % 3, telefone_contato: '(19) 99999-' + String(1000 + i).slice(-4), nome_admin: r(consultores, i), cidade: r(cidades, i),
      apto_renovacao: (6 + (i * 7) % 30) > 15 ? 'APTO' : 'NAO APTO', cep: '13000-000', valor_contrato: 150 + (i * 37) % 900, arpu: 45 + i % 40, ddd: '19', atualizado_em: dia(i % 20) })),
    propostas: Array.from({ length: 18 }, (_, i) => ({ id: 'p' + i, consultor_id: 'demo-c' + (i % 5), cliente_nome: `EMPRESA EXEMPLO ${i + 1} LTDA`, cliente_cnpj: cnpj(i),
      cliente_cidade: r(cidades, i), cliente_ddd: '19', origem: i % 2 ? 'base' : 'avulsa', tipo_proposta: 'renovacao', valor_atual: 400 + i * 35, valor_proposto: 360 + i * 30,
      estagio: r(['lead', 'proposta_enviada', 'negociacao', 'fechado_ganho', 'fechado_perdido'], i), estagio_entrada_em: dia(i % 4), criado_em: dia(i), atualizado_em: dia(i % 3), dados: {} })),
    propostas_historico: [],
    producao_pedidos: Array.from({ length: 140 }, (_, i) => ({ id: i + 1, numero_pedido: 'PED' + (5000 + Math.floor(i / 2)), grupo: 'APEX', usuario: r(consultores, i),
      etapa: r(etapas, i), cadastro: dia(i % 25), atualizacao: dia(i % 25), valor: 60 + (i * 13) % 240, quantidade: 1 + i % 3, produto: r(produtos, i),
      cliente: `EMPRESA EXEMPLO ${1 + i % 60} LTDA`, cnpj: cnpj(i % 60), tag: '', criado_em: dia(i % 25) })),
    leads: Array.from({ length: 90 }, (_, i) => ({ id: 'l' + i, criado_em_lead: dia(i % 28), full_name: 'Lead ' + (i + 1), cnpj: cnpj(i), city: r(cidades, i),
      consultor: r(consultores, i), status: r(['CONVERTIDO', 'EM ANDAMENTO', 'PERDIDO', 'SEM CONTATO'], i), categoria: r(['convertido', 'andamento', 'perdido', 'sem_contato'], i),
      converteu: i % 4 === 0, receita: i % 4 === 0 ? 120 + i * 3 : 0, platform: i % 2 ? 'ig' : 'fb', atualizado_em: dia(i % 5) })),
    clientes_movimentacao: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, tipo: r(['entrou', 'saiu', 'mudou'], i), cnpj: cnpj(i), razao_social: `EMPRESA EXEMPLO ${i + 1} LTDA`,
      cidade: r(cidades, i), dados_antes: {}, dados_depois: {}, campos_alterados: ['valor_contrato'], detectado_em: dia(i % 30) })),
    clientes_movimentacao_resumo: [], consultas_log: [], cobertura_kmz: [],
    config: [{ chave: 'leads_ultima_sync', valor: new Date().toLocaleString('pt-BR') }],
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

  const sessao = { user: { id: 'demo-admin', email: 'demo@apexclientes.com' } };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: sessao } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      signInWithPassword: async () => ({ data: { session: sessao, user: sessao.user }, error: null }), signOut: async () => ({ error: null }), getUser: async () => ({ data: { user: sessao.user } }) },
    from: builder,
    rpc: async (nome) => nome === 'get_my_role' ? { data: 'admin', error: null } : { data: { total: 22, ganho: 9, perdido: 5, andamento: 6, semPedido: 2, pedidosGanho: [], pedidosPerdido: [], pedidosAndamento: [] }, error: null },
    functions: { invoke: async () => ({ data: { ok: true, demo: true, total: 90, atualizado_em: new Date().toLocaleString('pt-BR') }, error: null }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  }) };
  console.info('[demo] Supabase falso ativo — nada aqui toca o banco real.');
})();
