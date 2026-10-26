-- §112: telefone, e-mail e CNPJ dos leads deixam de ser legíveis direto da tabela pelo navegador. O consultor
-- só os recebe pelas RPCs (no lead dele); a Digital de admin/supervisor lê o CNPJ por leads_digital_admin().
begin;
revoke select on public.leads from anon, authenticated;
grant select (aba, id, criado_em_lead, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, form_id, form_name,
              is_organic, platform, tipo_empresa, qtd_linhas, full_name, city, state, lead_status, consultor, status,
              categoria, obs, converteu, receita, atualizado_em, primeira_sync_em, dono_id, pego_em, classificado_em,
              classificado_por, retorno_em, aba_planilha)
  on public.leads to authenticated;

create or replace function public.leads_digital_admin()
returns table(aba text, id text, consultor text, status text, categoria text, converteu boolean, receita numeric,
              criado_em_lead timestamptz, cnpj text)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query select l.aba, l.id, l.consultor, l.status, l.categoria, l.converteu, l.receita, l.criado_em_lead, l.cnpj
                 from public.leads l order by l.aba, l.id;
end $$;
grant execute on function public.leads_digital_admin() to authenticated;
commit;
