-- Desfaz 20260930200000_painel_consultor.sql. Não mexe em nada que o painel antigo usa.
drop function if exists public.cnpjs_com_pedido_aberto_de_outros(text[]);
drop function if exists public.minhas_movimentacoes(int, uuid);
drop function if exists public.producao_meus_pedidos(uuid);
drop function if exists public.producao_dono_neo(uuid);
drop function if exists public.neo_usuarios_detectados();
drop function if exists public.meu_neo_usuario_id();
drop table if exists public.metas_consultor;
drop trigger if exists trg_producao_neo_etapa on public.producao_pedidos_neo;
drop function if exists public.producao_neo_registra_etapa();
drop table if exists public.producao_etapa_historico;
drop table if exists public.consultor_neo;
drop trigger if exists trg_producao_neo_raw_usuario on public.producao_neo_raw;
drop function if exists public.producao_neo_raw_sync_usuario();
drop index if exists public.idx_producao_neo_numero_pedido;
drop index if exists public.idx_producao_neo_usuario_id;
alter table public.producao_pedidos_neo drop column if exists usuario_id;
