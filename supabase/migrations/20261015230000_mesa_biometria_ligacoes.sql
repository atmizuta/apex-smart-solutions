-- §91 (15/10/2026): mesa_biometria ganha o "radar de ligações" — ligações manuais (ligacoes_manuais) para o celular
-- do cliente: desde que o pedido entrou na etapa (lig_etapa), quantas delas foram do próprio consultor
-- (usuario = leads_equipe.usuario_telefonia → lig_consultor), total de sempre (lig_total) e a última (ultima_lig).
-- O resto é igual à §90 (20261015220000). Muda o tipo de retorno: drop + create, mesmas permissões.
begin;

drop function if exists public.mesa_biometria();

create function public.mesa_biometria()
returns table(consultor text, usuario_neo text, numero_pedido text, cliente text, cnpj text, etapa text,
              desde timestamptz, valor numeric, quantidade numeric, produtos text, telefone text, fonte_tel text,
              lig_etapa integer, lig_consultor integer, lig_total integer, ultima_lig timestamptz)
language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with ped as (
    select n.numero_pedido, n.usuario_id, n.etapa, max(n.usuario) as usuario, max(n.cliente) as cliente, max(n.cnpj) as cnpj,
           max(n.atualizacao) as atualizacao, sum(n.valor) as valor, sum(n.quantidade) as quantidade,
           string_agg(distinct n.produto, ' · ') as produtos
      from public.producao_pedidos_neo n
     where n.numero_pedido is not null
       and n.etapa in ('BIOMETRIA (NEOCRM)', 'AGUARDANDO ASSINATURA (NEOCRM)')
     group by n.numero_pedido, n.usuario_id, n.etapa
  ), base as (
    select e.nome_planilha, e.usuario_telefonia, x.usuario, x.numero_pedido, x.cliente, x.cnpj, x.etapa,
           public.producao_na_etapa_desde(x.numero_pedido, x.etapa, x.atualizacao) as desde, x.valor, x.quantidade, x.produtos,
           coalesce(tl.tel, tc.tel, tb.tel) as tel,
           case when tl.tel is not null then 'lead' when tc.tel is not null then 'caderno' when tb.tel is not null then 'clientes' end as fonte
      from ped x
      join public.consultor_neo cn on cn.neo_usuario_id = x.usuario_id
      join public.leads_equipe e on e.monitorar and e.profile_id = cn.profile_id
      cross join lateral (select regexp_replace(coalesce(x.cnpj, ''), '[^0-9]', '', 'g') as doc) d
      left join lateral (select l.phone_number as tel from public.leads l
                          where length(d.doc) >= 11 and regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g') = d.doc
                            and nullif(trim(l.phone_number), '') is not null
                          order by l.criado_em_lead desc limit 1) tl on true
      left join lateral (select c.telefone as tel from public.caderno_notas c
                          where length(d.doc) >= 11 and regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') = d.doc
                            and nullif(trim(c.telefone), '') is not null
                          order by c.atualizado_em desc limit 1) tc on true
      left join lateral (select coalesce(nullif(trim(k.telefone_contato), ''), nullif(trim(k.tel1), ''), nullif(trim(k.tel2), '')) as tel
                           from public.clientes k
                          where length(d.doc) >= 11 and regexp_replace(coalesce(k.cnpj, ''), '[^0-9]', '', 'g') = d.doc
                            and coalesce(nullif(trim(k.telefone_contato), ''), nullif(trim(k.tel1), ''), nullif(trim(k.tel2), '')) is not null
                          limit 1) tb on true
  )
  select b.nome_planilha, b.usuario, b.numero_pedido, b.cliente, b.cnpj, b.etapa, b.desde, b.valor, b.quantidade, b.produtos,
         b.tel, b.fonte,
         coalesce(g.etapa_n, 0)::int, coalesce(g.cons_n, 0)::int, coalesce(g.total_n, 0)::int, g.ultima
    from base b
    left join lateral (
      select count(*) filter (where b.desde is null or m.gerada_em >= b.desde) as etapa_n,
             count(*) filter (where (b.desde is null or m.gerada_em >= b.desde) and lower(m.usuario) = lower(b.usuario_telefonia)) as cons_n,
             count(*) as total_n, max(m.gerada_em) as ultima
        from public.ligacoes_manuais m
       where b.tel is not null and m.chave_tel is not null and m.chave_tel = public.chave_tel(b.tel)
    ) g on true
   order by b.nome_planilha, b.desde;
end $f$;

revoke all on function public.mesa_biometria() from public, anon;
grant execute on function public.mesa_biometria() to authenticated;

commit;
