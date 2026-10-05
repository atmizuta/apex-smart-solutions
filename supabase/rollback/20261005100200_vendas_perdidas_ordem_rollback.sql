-- Rollback de 20261005100200_vendas_perdidas_ordem.sql. Recria a versão anterior da RPC (sem o desempate por
-- q.np — volta a ter ordem instável entre linhas com o mesmo perdido_em na paginação do fetchAllRows).

create or replace function public.vendas_perdidas(p_de date, p_ate date)
returns table (numero_pedido text, usuario text, profile_id uuid, cliente text, produtos text, valor numeric,
               perdido_em timestamptz, categoria text, subcategoria text, tags text[], tag_pedido text)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with p as (
    select n.numero_pedido as np, max(n.usuario) as usu, max(n.usuario_id) as uid, max(n.cliente) as cli,
           string_agg(distinct n.produto, ' + ') as prods, coalesce(sum(n.valor), 0) as val,
           max(coalesce(n.atualizacao, n.cadastro)) as atu,
           string_agg(distinct nullif(btrim(n.tag), ''), ',') as tg
      from public.producao_pedidos_neo n
     where n.etapa = 'VENDA PERDIDA (NEOCRM)' and n.numero_pedido is not null
     group by n.numero_pedido
  ),
  q as (
    select p.*, coalesce((select max(h.em) from public.producao_etapa_historico h
                           where h.numero_pedido = p.np and h.etapa_nova = 'VENDA PERDIDA (NEOCRM)'), p.atu) as perd
      from p
  )
  select q.np, q.usu,
         (select cn.profile_id from public.consultor_neo cn where cn.neo_usuario_id = q.uid),
         coalesce(a.cliente, q.cli), coalesce(q.prods, a.produtos), q.val, q.perd,
         a.categoria, a.subcategoria, a.tags, q.tg
    from q left join public.producao_atividades a on a.numero_pedido = q.np
   where (q.perd at time zone 'America/Sao_Paulo')::date between p_de and p_ate
   order by q.perd desc;
end $$;
revoke all on function public.vendas_perdidas(date, date) from public, anon;
grant execute on function public.vendas_perdidas(date, date) to authenticated;
