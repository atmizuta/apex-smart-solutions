-- 01/10/2026 — "Meus leads para tratar": leads "CLIENTE NÃO RESPONDE" entram como "para resgatar" e o consultor
-- ganha o próprio placar de ligações do dia. REGRAS_NEGOCIO.md seção 64. Aditiva.

-- 1) A lista passa a incluir "CLIENTE NÃO RESPONDE" (categoria continua 'perdido' nos números da Digital/Dashboard).
--    Mesma assinatura da seção 61 (com obs) — create or replace basta.
create or replace function public.meus_leads_para_tratar()
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
     and (l.categoria in ('andamento', 'sem_contato') or public.norm_nome(l.status) = 'cliente nao responde')
   order by l.criado_em_lead;
$$;
revoke all on function public.meus_leads_para_tratar() from public, anon;
grant execute on function public.meus_leads_para_tratar() to authenticated;

-- 2) Placar do próprio consultor: ligações dele para leads no dia p_ref (SP) e a MÉDIA da equipe (quem tem usuário
--    da telefonia em leads_equipe e ligou para lead nesse dia). Nunca devolve números de outra pessoa.
--    tem_telefonia = o login tem usuario_telefonia; tem_dados = existe algum relatório importado. Metas de config.
create or replace function public.meu_placar_ligacoes(p_ref date)
returns table (lig_hoje bigint, media_equipe numeric, tem_telefonia boolean, tem_dados boolean,
               min_tentativas int, max_tentativas int, meta_ligacoes_dia int)
language sql stable security definer set search_path = public as $$
  with metas as (
    select coalesce((select cfg.valor::jsonb from public.config cfg where cfg.chave = 'monitor_leads_metas'), '{}'::jsonb) as m
  ),
  eu as (
    select lower(btrim(e.usuario_telefonia)) as u from public.leads_equipe e
     where e.profile_id = auth.uid() and coalesce(btrim(e.usuario_telefonia), '') <> '' limit 1
  ),
  equipe as (
    select distinct lower(btrim(e.usuario_telefonia)) as u from public.leads_equipe e where coalesce(btrim(e.usuario_telefonia), '') <> ''
  ),
  chaves as (
    select distinct public.chave_tel(ld.phone_number) as k from public.leads ld where ld.phone_number is not null
  ),
  hoje as (
    select lower(btrim(m.usuario)) as u, count(*) as n
      from public.ligacoes_manuais m join chaves c on c.k = m.chave_tel
     where (m.gerada_em at time zone 'America/Sao_Paulo')::date = p_ref
     group by 1
  )
  select coalesce((select h.n from hoje h join eu on eu.u = h.u), 0)::bigint,
         (select round(avg(h.n)::numeric, 1) from hoje h join equipe q on q.u = h.u),
         exists (select 1 from eu),
         exists (select 1 from public.ligacoes_manuais),
         coalesce((select (metas.m ->> 'min_tentativas')::int from metas), 3),
         coalesce((select (metas.m ->> 'max_tentativas')::int from metas), 10),
         coalesce((select (metas.m ->> 'meta_ligacoes_dia')::int from metas), 80);
$$;
revoke all on function public.meu_placar_ligacoes(date) from public, anon;
grant execute on function public.meu_placar_ligacoes(date) to authenticated;
