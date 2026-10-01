-- Fase 2 da sincronização NeoSales: o dashboard passa a ler a produção sincronizada.
-- A tabela do upload manual vira backup (producao_pedidos_manual) e "producao_pedidos" passa a ser uma VIEW
-- somente-leitura sobre producao_pedidos_neo. Assim as leituras do painel e a função reconciliacao_neocrm
-- continuam funcionando sem mudança, e a Edge Function segue gravando em producao_pedidos_neo.
-- security_invoker: a view respeita o RLS de quem consulta (mesma regra de antes: só usuário logado).
-- Sem grant de escrita: um "Upload Dash" antigo aberto em alguma aba falha com "permission denied" em vez de
-- gravar algo. Reversível: supabase/rollback/20260930000000_producao_neo_cutover_rollback.sql
begin;

alter table public.producao_pedidos rename to producao_pedidos_manual;

create view public.producao_pedidos with (security_invoker = true) as
  select id, numero_pedido, grupo, usuario, etapa, cadastro, atualizacao, valor, quantidade,
         produto, cliente, cnpj, tag, criado_em, data_portabilidade, data_instalacao
  from public.producao_pedidos_neo;

revoke all on public.producao_pedidos from anon, authenticated;
grant select on public.producao_pedidos to authenticated, service_role;

commit;
