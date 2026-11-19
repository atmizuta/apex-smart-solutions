-- Conferência (só leitura) da migration 20261013100000_relatorio_pedidos_parados.
select 'pedidos' as item, count(distinct numero_pedido)::text as valor from public.relatorio_pedidos_parados_linhas()
union all select 'linhas', count(*)::text from public.relatorio_pedidos_parados_linhas()
union all select 'etapas fora do esperado', count(*)::text from public.relatorio_pedidos_parados_linhas()
  where etapa not in ('ANTIFRAUDE (NEOCRM)', 'ENTREGA (NEOCRM)')
union all select 'sem na_etapa_desde', count(*)::text from public.relatorio_pedidos_parados_linhas() where na_etapa_desde is null
union all select 'linhas de Campinas', count(*)::text from public.relatorio_pedidos_parados_linhas() where operacao = 'campinas'
union all select 'agenda do job', (select schedule from cron.job where jobname = 'relatorio-pedidos-parados')
union all select 'anon executa?', has_function_privilege('anon', 'public.relatorio_pedidos_parados_linhas()', 'execute')::text
union all select 'authenticated executa?', has_function_privilege('authenticated', 'public.relatorio_pedidos_parados_linhas()', 'execute')::text
union all select 'RLS destinatários', (select relrowsecurity::text from pg_class where oid = 'public.relatorio_destinatarios'::regclass)
union all select 'RLS log', (select relrowsecurity::text from pg_class where oid = 'public.relatorio_envio_log'::regclass);
