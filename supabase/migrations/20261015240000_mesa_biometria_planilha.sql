-- §92 (15/10/2026): mesa_biometria acha o cliente na PLANILHA de leads e conta as ligações em todos os números dele.
-- O NEO não manda telefone; o cliente do pedido é procurado na planilha (leads), nesta ordem:
--   1) CNPJ igual (só dígitos);
--   2) mesmo consultor e mesmo nome (MEI: o NEO traz "68.175.456 NOME DA PESSOA" — números tirados);
--   3) mesmo consultor e CNPJ com no máximo 2 dígitos diferentes (CNPJ digitado errado no formulário).
-- O celular mostrado é o do lead mais recente achado; as ligações manuais contam para QUALQUER número da planilha
-- daquele cliente. Sem lead: Caderno de Ligação e base de clientes pelo CNPJ (como na §90).
-- Mesmo retorno da §91 (20261015230000), então create or replace.
begin;

create or replace function public.mesa_biometria()
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
           regexp_replace(coalesce(x.cnpj, ''), '[^0-9]', '', 'g') as doc,
           trim(regexp_replace(public.norm_nome(regexp_replace(coalesce(x.cliente, ''), '[0-9./-]', '', 'g')), '\s+', ' ', 'g')) as nome_cli
      from ped x
      join public.consultor_neo cn on cn.neo_usuario_id = x.usuario_id
      join public.leads_equipe e on e.monitorar and e.profile_id = cn.profile_id
  ), achado as (
    -- leads da planilha que são deste cliente, com o passo que achou (1 = CNPJ, 2 = nome, 3 = CNPJ quase igual)
    select b.numero_pedido, b.etapa, l.phone_number, l.criado_em_lead, m.passo
      from base b
      join public.leads l on nullif(trim(l.phone_number), '') is not null
      cross join lateral (select regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g') as ldoc) ld
      cross join lateral (select case
          when length(b.doc) >= 11 and ld.ldoc = b.doc then 1
          when public.norm_nome(l.consultor) = public.norm_nome(b.nome_planilha) and length(b.nome_cli) >= 5
               and trim(regexp_replace(public.norm_nome(l.full_name), '\s+', ' ', 'g')) = b.nome_cli then 2
          when public.norm_nome(l.consultor) = public.norm_nome(b.nome_planilha) and length(b.doc) = 14 and length(ld.ldoc) = 14
               and (select count(*) from generate_series(1, 14) i where substr(ld.ldoc, i, 1) <> substr(b.doc, i, 1)) <= 2 then 3
        end as passo) m
     where m.passo is not null
  ), melhor as (
    select distinct on (a.numero_pedido, a.etapa) a.numero_pedido, a.etapa, a.phone_number as tel, a.passo
      from achado a order by a.numero_pedido, a.etapa, a.passo, a.criado_em_lead desc
  ), chaves as (
    select a.numero_pedido, a.etapa, array_agg(distinct public.chave_tel(a.phone_number)) filter (where public.chave_tel(a.phone_number) is not null) as ks
      from achado a where a.passo = (select min(a2.passo) from achado a2 where a2.numero_pedido = a.numero_pedido and a2.etapa = a.etapa)
     group by a.numero_pedido, a.etapa
  ), com_tel as (
    select b.*, coalesce(mb.tel, tc.tel, tb.tel) as tel,
           case mb.passo when 1 then 'lead' when 2 then 'lead_nome' when 3 then 'lead_cnpj_parecido' end as fonte_lead,
           tc.tel as tel_caderno, tb.tel as tel_clientes, ch.ks
      from base b
      left join melhor mb on mb.numero_pedido = b.numero_pedido and mb.etapa = b.etapa
      left join chaves ch on ch.numero_pedido = b.numero_pedido and ch.etapa = b.etapa
      left join lateral (select c.telefone as tel from public.caderno_notas c
                          where mb.tel is null and length(b.doc) >= 11 and regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') = b.doc
                            and nullif(trim(c.telefone), '') is not null
                          order by c.atualizado_em desc limit 1) tc on true
      left join lateral (select coalesce(nullif(trim(k.telefone_contato), ''), nullif(trim(k.tel1), ''), nullif(trim(k.tel2), '')) as tel
                           from public.clientes k
                          where mb.tel is null and tc.tel is null and length(b.doc) >= 11 and regexp_replace(coalesce(k.cnpj, ''), '[^0-9]', '', 'g') = b.doc
                            and coalesce(nullif(trim(k.telefone_contato), ''), nullif(trim(k.tel1), ''), nullif(trim(k.tel2), '')) is not null
                          limit 1) tb on true
  )
  select t.nome_planilha, t.usuario, t.numero_pedido, t.cliente, t.cnpj, t.etapa, t.desde, t.valor, t.quantidade, t.produtos,
         t.tel, coalesce(t.fonte_lead, case when t.tel_caderno is not null then 'caderno' when t.tel_clientes is not null then 'clientes' end),
         coalesce(g.etapa_n, 0)::int, coalesce(g.cons_n, 0)::int, coalesce(g.total_n, 0)::int, g.ultima
    from com_tel t
    left join lateral (
      select count(*) filter (where t.desde is null or m.gerada_em >= t.desde) as etapa_n,
             count(*) filter (where (t.desde is null or m.gerada_em >= t.desde) and lower(m.usuario) = lower(t.usuario_telefonia)) as cons_n,
             count(*) as total_n, max(m.gerada_em) as ultima
        from public.ligacoes_manuais m
       where t.tel is not null and m.chave_tel is not null
         and m.chave_tel = any(coalesce(t.ks, array[public.chave_tel(t.tel)]))
    ) g on true
   order by t.nome_planilha, t.desde;
end $f$;

revoke all on function public.mesa_biometria() from public, anon;
grant execute on function public.mesa_biometria() to authenticated;

commit;
