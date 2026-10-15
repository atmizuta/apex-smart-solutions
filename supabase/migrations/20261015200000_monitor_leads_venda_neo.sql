-- §88 (15/10/2026): monitor_leads_leads devolve também venda_neo — o CNPJ do lead tem pedido no NeoCRM
-- (producao_pedidos) fora de VENDA PERDIDA / DEVOLVIDO / CANCELADO. O painel trata esse lead como venda:
-- sai de "Leads sem nenhuma ligação", da cadência e do "Necessita repasse", mesmo que a planilha não diga VENDA.
-- Muda o tipo de retorno, então é drop + create (mesmas permissões da 20261001000000).
begin;

drop function if exists public.monitor_leads_leads(text);

create function public.monitor_leads_leads(p_aba text)
 returns table(lead_id text, nome text, telefone text, consultor text, status text, categoria text, receita numeric,
               criado_em_lead timestamptz, tentativas integer, atendidas integer, ultima_ligacao timestamptz, venda_neo boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if public.get_my_role() not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with neo as (
    select distinct regexp_replace(p.cnpj, '[^0-9]', '', 'g') as doc
      from public.producao_pedidos p
     where p.cnpj is not null
       and coalesce(p.etapa, '') !~* '(PERDID|DEVOLVID|CANCELAD)'
  )
  select l.id, l.full_name, l.phone_number, l.consultor, l.status, l.categoria, l.receita, l.criado_em_lead,
         coalesce(c.t, 0)::int, coalesce(c.a, 0)::int, c.u,
         exists (select 1 from neo
                  where length(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g')) >= 11
                    and neo.doc = regexp_replace(l.cnpj, '[^0-9]', '', 'g'))
    from public.leads l
    join public.leads_equipe e on e.monitorar and public.norm_nome(e.nome_planilha) = public.norm_nome(l.consultor)
    left join lateral (
      select count(*) as t, count(*) filter (where m.atendida) as a, max(m.gerada_em) as u
        from public.ligacoes_manuais m
       where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number)
    ) c on true
   where l.aba = p_aba
   order by l.criado_em_lead;
end $function$;

revoke all on function public.monitor_leads_leads(text) from public, anon;
grant execute on function public.monitor_leads_leads(text) to authenticated;

commit;
