-- 01/10/2026 — "Meus leads para tratar" mostra a OBS da planilha (REGRAS_NEGOCIO.md seção 61).
-- Acrescenta a coluna `obs` no fim do retorno de meus_leads_para_tratar(). Mudar o tipo de retorno exige
-- drop + create; o resto (vínculo por equipe/nome único, sem Repique, só em aberto) é igual à seção 60.
-- O painel antigo continua funcionando com a função nova (só ignora a coluna a mais).
drop function if exists public.meus_leads_para_tratar();
create function public.meus_leads_para_tratar()
returns table (aba text, lead_id text, nome text, telefone text, status text, categoria text,
               criado_em_lead timestamptz, tentativas int, atendidas int, ultima_ligacao timestamptz, obs text)
language sql stable security definer set search_path = public as $$
  select l.aba, l.id, l.full_name, l.phone_number, l.status, l.categoria, l.criado_em_lead,
         coalesce(c.t, 0)::int, coalesce(c.a, 0)::int, c.u, l.obs
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
