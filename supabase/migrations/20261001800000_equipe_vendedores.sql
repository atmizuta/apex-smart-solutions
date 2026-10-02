-- 01/10/2026 — lista de todos os consultores da Apex para a matriz "Vendas Diárias por Vendedor" (Cadastro Diário)
-- mostrar também quem zerou no mês. REGRAS_NEGOCIO.md seção 66. Aditiva.
-- Fonte: consultor_neo (vínculo login do painel x ID do NeoCRM). Nome = o mesmo que o dashboard usa (producao_pedidos.usuario,
-- maiúsculo, vindo do NeoCRM) — o mais recente pelo usuario_id; sem pedido nenhum, o nome do perfil em maiúsculo.
-- security definer porque o consultor só enxerga a própria linha de consultor_neo; devolve só nomes (já visíveis no dashboard).
create or replace function public.equipe_vendedores()
returns setof text
language sql stable security definer set search_path = public as $$
  select distinct coalesce(
           (select upper(btrim(n.usuario)) from public.producao_pedidos_neo n
             where n.usuario_id = c.neo_usuario_id and coalesce(btrim(n.usuario), '') <> ''
             order by n.sincronizado_em desc nulls last limit 1),
           upper(btrim(p.nome)))
    from public.consultor_neo c
    join public.profiles p on p.id = c.profile_id;
$$;
revoke all on function public.equipe_vendedores() from public, anon;
grant execute on function public.equipe_vendedores() to authenticated;
