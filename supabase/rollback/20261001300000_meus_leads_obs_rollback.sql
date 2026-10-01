-- Rollback de 20261001300000_meus_leads_obs.sql: volta meus_leads_para_tratar() ao retorno da seção 60 (sem obs).
-- Reverter o painel ANTES (o painel da seção 61 só mostra a OBS se ela vier; sem ela, simplesmente não aparece).
drop function if exists public.meus_leads_para_tratar();
create function public.meus_leads_para_tratar()
returns table (aba text, lead_id text, nome text, telefone text, status text, categoria text,
               criado_em_lead timestamptz, tentativas int, atendidas int, ultima_ligacao timestamptz)
language sql stable security definer set search_path = public as $$
  select l.aba, l.id, l.full_name, l.phone_number, l.status, l.categoria, l.criado_em_lead,
         coalesce(c.t, 0)::int, coalesce(c.a, 0)::int, c.u
    from public.leads l
    left join lateral (
      select count(*) as t, count(*) filter (where m.atendida) as a, max(m.gerada_em) as u
        from public.ligacoes_manuais m
       where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number)
    ) c on true
   where public.norm_nome(l.consultor) in (select public.meus_leads_nomes())
     and coalesce(l.aba, '') <> 'REPIQUE'
     and l.categoria in ('andamento', 'sem_contato')
   order by l.criado_em_lead;
$$;
revoke all on function public.meus_leads_para_tratar() from public, anon;
grant execute on function public.meus_leads_para_tratar() to authenticated;
