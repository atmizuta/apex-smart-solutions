-- §112 (ajuste 26/10 à noite): ficha do lead ao clicar no cartão do Kanban.
-- Mesma regra de proteção do leads_kanban: consultor só abre lead dele ou lead Livre; no Livre não recebe
-- celular, e-mail nem CNPJ. Admin/supervisor abrem qualquer lead com todos os dados.
begin;
create or replace function public.leads_ficha(p_aba text, p_id text)
returns table(aba text, lead_id text, nome text, cidade text, uf text, qtd_linhas text, tipo_empresa text,
              telefone text, email text, cnpj text, status text, categoria text, obs text, converteu boolean,
              receita numeric, retorno_em date, dono_id uuid, dono_nome text, criado_em_lead timestamptz,
              campanha text, venda_neo boolean, receita_neo numeric, livre boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_livre boolean; v_dono uuid;
begin
  select l.dono_id, (l.dono_id is null and l.categoria = 'sem_contato') into v_dono, v_livre
    from public.leads l where l.aba = p_aba and l.id = p_id;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if not v_gestor then
    if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
    if not v_livre and v_dono is distinct from auth.uid() then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
  end if;
  return query
  select l.aba, l.id, l.full_name, l.city, l.state, l.qtd_linhas, l.tipo_empresa,
         case when v_livre and not v_gestor then null else l.phone_number end,
         case when v_livre and not v_gestor then null else l.email end,
         case when v_livre and not v_gestor then null else l.cnpj end,
         l.status, l.categoria, l.obs, l.converteu, l.receita, l.retorno_em, l.dono_id, pr.nome, l.criado_em_lead,
         l.campaign_name, (n.valor is not null), n.valor, v_livre
    from public.leads l
    left join public.profiles pr on pr.id = l.dono_id
    left join lateral (
      select sum(coalesce(p.valor, 0)) as valor from public.producao_pedidos p
       where length(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g')) >= 11
         and regexp_replace(coalesce(p.cnpj, ''), '[^0-9]', '', 'g') = regexp_replace(l.cnpj, '[^0-9]', '', 'g')
         and coalesce(p.etapa, '') !~* '(PERDID|DEVOLVID|CANCELAD)'
      having count(*) > 0
    ) n on true
   where l.aba = p_aba and l.id = p_id;
end $$;
revoke execute on function public.leads_ficha(text, text) from public, anon;
grant execute on function public.leads_ficha(text, text) to authenticated;
commit;
