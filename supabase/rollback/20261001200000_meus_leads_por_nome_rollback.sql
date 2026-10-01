-- Rollback de 20261001200000_meus_leads_por_nome.sql: volta "Meus leads para tratar" à regra da seção 59
-- (só quem está em leads_equipe com profile_id; todas as abas). Reverter o painel ANTES (o painel novo chama
-- meus_leads_vinculado; sem ela a seção só fica escondida, nada quebra).
create or replace function public.meus_leads_para_tratar()
returns table (aba text, lead_id text, nome text, telefone text, status text, categoria text,
               criado_em_lead timestamptz, tentativas int, atendidas int, ultima_ligacao timestamptz)
language sql stable security definer set search_path = public as $$
  select l.aba, l.id, l.full_name, l.phone_number, l.status, l.categoria, l.criado_em_lead,
         coalesce(c.t, 0)::int, coalesce(c.a, 0)::int, c.u
    from public.leads_equipe e
    join public.leads l on public.norm_nome(l.consultor) = public.norm_nome(e.nome_planilha)
    left join lateral (
      select count(*) as t, count(*) filter (where m.atendida) as a, max(m.gerada_em) as u
        from public.ligacoes_manuais m
       where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number)
    ) c on true
   where e.profile_id = auth.uid() and l.categoria in ('andamento', 'sem_contato')
   order by l.criado_em_lead;
$$;
revoke all on function public.meus_leads_para_tratar() from public, anon;
grant execute on function public.meus_leads_para_tratar() to authenticated;

drop function if exists public.meus_leads_vinculado();
drop function if exists public.meus_leads_nomes();
