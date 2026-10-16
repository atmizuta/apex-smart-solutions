-- §90 (15/10/2026): Mesa do Supervisor → sub-aba "Biometria". Pedidos do NeoCRM em BIOMETRIA ou AGUARDANDO
-- ASSINATURA dos consultores administrados (leads_equipe com monitorar), com o celular do cliente para a
-- supervisora retornar. Celular: lead (planilha) pelo CNPJ → Caderno de Ligação pelo CNPJ → base de clientes pelo CNPJ.
-- Só admin/supervisor (mesmo padrão da mesa_pendencias). Somente leitura.
begin;

create or replace function public.mesa_biometria()
returns table(consultor text, usuario_neo text, numero_pedido text, cliente text, cnpj text, etapa text,
              desde timestamptz, valor numeric, quantidade numeric, produtos text, telefone text, fonte_tel text)
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
  )
  select e.nome_planilha, x.usuario, x.numero_pedido, x.cliente, x.cnpj, x.etapa,
         public.producao_na_etapa_desde(x.numero_pedido, x.etapa, x.atualizacao), x.valor, x.quantidade, x.produtos,
         coalesce(tl.tel, tc.tel, tb.tel),
         case when tl.tel is not null then 'lead' when tc.tel is not null then 'caderno' when tb.tel is not null then 'clientes' end
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
   order by e.nome_planilha, 7;
end $f$;

revoke all on function public.mesa_biometria() from public, anon;
grant execute on function public.mesa_biometria() to authenticated;

commit;
