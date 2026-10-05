-- 05/10/2026 (noite) — RPC vendas_perdidas v3: a análise da sub-aba "Vendas Perdidas" do Dashboard de Produção
-- precisa também do tipo de venda (grupo), da solicitação, da cidade e da data de cadastro de cada pedido.
-- REGRAS_NEGOCIO.md §70 (adendo docs/superpowers/specs/2026-10-05-vendas-perdidas-adendo-dashboard.md).
--   grupo       = max(producao_pedidos_neo.grupo) do pedido (ex.: "VOZ - Portabilidade")
--   solicitacao = max(producao_neo_raw.raw->>'solicitacao') entre os itens do pedido (vazio → null)
--   cidade      = max(producao_neo_raw.raw->>'cidade') entre os itens do pedido (vazio → null)
--   cadastro    = min(producao_pedidos_neo.cadastro) do pedido
-- O tipo de retorno muda, então a função é apagada e recriada (create or replace não troca colunas de saída).
-- Toda coluna de CTE tem apelido próprio (np, grp, cad, rnp…) para não colidir com os parâmetros OUT.

drop function if exists public.vendas_perdidas(date, date);

create function public.vendas_perdidas(p_de date, p_ate date)
returns table (numero_pedido text, usuario text, profile_id uuid, cliente text, produtos text, valor numeric,
               perdido_em timestamptz, categoria text, subcategoria text, tags text[], tag_pedido text,
               grupo text, solicitacao text, cidade text, cadastro timestamptz)
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
           string_agg(distinct nullif(btrim(n.tag), ''), ',') as tg,
           max(nullif(btrim(n.grupo), '')) as grp, min(n.cadastro) as cad
      from public.producao_pedidos_neo n
     where n.etapa = 'VENDA PERDIDA (NEOCRM)' and n.numero_pedido is not null
     group by n.numero_pedido
  ),
  q as (
    select p.*, coalesce((select max(h.em) from public.producao_etapa_historico h
                           where h.numero_pedido = p.np and h.etapa_nova = 'VENDA PERDIDA (NEOCRM)'), p.atu) as perd
      from p
  ),
  r as (
    select x.raw->>'numeroPedido' as rnp,
           max(nullif(btrim(x.raw->>'solicitacao'), '')) as sol,
           max(nullif(btrim(x.raw->>'cidade'), '')) as cid
      from public.producao_neo_raw x
     where x.raw->>'numeroPedido' in (select p.np from p)
     group by x.raw->>'numeroPedido'
  )
  select q.np, q.usu,
         (select cn.profile_id from public.consultor_neo cn where cn.neo_usuario_id = q.uid),
         coalesce(a.cliente, q.cli), coalesce(q.prods, a.produtos), q.val, q.perd,
         a.categoria, a.subcategoria, a.tags, q.tg,
         q.grp, r.sol, r.cid, q.cad
    from q
    left join public.producao_atividades a on a.numero_pedido = q.np
    left join r on r.rnp = q.np
   where (q.perd at time zone 'America/Sao_Paulo')::date between p_de and p_ate
   order by q.perd desc, q.np;
end $$;
revoke all on function public.vendas_perdidas(date, date) from public, anon;
grant execute on function public.vendas_perdidas(date, date) to authenticated;
