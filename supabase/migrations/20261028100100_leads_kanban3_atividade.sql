-- §122 (28/10): leads_kanban3 = leads_kanban2 + campanha/formulário (filtro de origem) + modo Todos (todas as etapas e
-- meses, sem livres). Nome novo porque mudar o retorno exige drop, e o conector do Supabase falha com drop.
-- leads_atividade_equipe: semáforo do supervisor (ligações pela regra da mesa_ligacoes_hoje + OBS escritas).
create or replace function public.leads_kanban3(p_dono uuid default null::uuid, p_todos boolean default false)
 returns table(aba text, lead_id text, nome text, cidade text, uf text, qtd_linhas text, tipo_empresa text, telefone text, email text, cnpj text,
               status text, categoria text, obs text, converteu boolean, receita numeric, retorno_em date, dono_id uuid, dono_nome text,
               pego_em timestamp with time zone, classificado_em timestamp with time zone, criado_em_lead timestamp with time zone,
               primeiro_clique timestamp with time zone, primeira_ligacao timestamp with time zone, venda_neo boolean, receita_neo numeric,
               livre boolean, ligacoes integer, ultima_ligacao timestamp with time zone, ultima_atendida boolean, ultima_seg integer,
               ultima_tabulacao text, campanha text, formulario text)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_alvo uuid; v_ini_mes timestamptz;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with base as (
    select l.*, (l.dono_id is null and l.categoria = 'sem_contato') as e_livre,
           nullif(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g'), '') as doc,
           public.chave_tel(l.phone_number) as chave
      from public.leads l
     where coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null
       and (
         (not coalesce(p_todos, false) and l.dono_id is null and l.categoria = 'sem_contato' and l.criado_em_lead >= now() - interval '60 days')
         or (l.dono_id is not null and (v_alvo is null or l.dono_id = v_alvo)
             and (coalesce(p_todos, false) or l.categoria in ('sem_contato', 'andamento')
                  or coalesce(l.classificado_em, l.criado_em_lead) >= v_ini_mes))
       )
  ), neo as (
    select regexp_replace(p.cnpj, '[^0-9]', '', 'g') as doc, sum(coalesce(p.valor, 0)) as valor
      from public.producao_pedidos p
     where p.cnpj is not null and coalesce(p.etapa, '') !~* '(PERDID|DEVOLVID|CANCELAD)'
       and regexp_replace(p.cnpj, '[^0-9]', '', 'g') in (select b.doc from base b where length(b.doc) >= 11)
     group by 1
  )
  select b.aba, b.id, b.full_name, b.city, b.state, b.qtd_linhas, b.tipo_empresa,
         case when b.e_livre and not v_gestor then null else b.phone_number end,
         case when b.e_livre and not v_gestor then null else b.email end,
         case when b.e_livre and not v_gestor then null else b.cnpj end,
         b.status, b.categoria, b.obs, b.converteu, b.receita, b.retorno_em, b.dono_id, pr.nome, b.pego_em,
         b.classificado_em, b.criado_em_lead,
         (select min(c.em) from public.leads_contatos c where c.lead_aba = b.aba and c.lead_id = b.id),
         lg.primeira,
         (n.doc is not null), n.valor, b.e_livre,
         coalesce(lg.n, 0), ul.em, ul.atendida, ul.seg, ul.tab,
         b.campaign_name, b.form_name
    from base b
    left join public.profiles pr on pr.id = b.dono_id
    left join neo n on length(b.doc) >= 11 and n.doc = b.doc
    left join lateral (
      select count(*)::int as n, min(x.em) as primeira from (
        select m.gerada_em as em from public.ligacoes_manuais m
         where b.chave is not null and m.chave_tel = b.chave and m.gerada_em >= b.criado_em_lead - interval '1 hour'
        union all
        select d.gerada_em from public.discador_chamadas d
         where length(b.doc) = 14 and d.cnpj = b.doc and d.gerada_em >= b.criado_em_lead - interval '1 hour'
      ) x
    ) lg on true
    left join lateral (
      select y.em, y.atendida, y.seg, y.tab from (
        select m.gerada_em as em, coalesce(m.atendida, false) as atendida, m.seg_falados as seg, m.tabulacao as tab from public.ligacoes_manuais m
         where b.chave is not null and m.chave_tel = b.chave and m.gerada_em >= b.criado_em_lead - interval '1 hour'
        union all
        select d.gerada_em, d.status = 'ANSWERED', d.seg_falados, d.tabulacao from public.discador_chamadas d
         where length(b.doc) = 14 and d.cnpj = b.doc and d.gerada_em >= b.criado_em_lead - interval '1 hour'
      ) y order by y.em desc limit 1
    ) ul on true
   order by b.criado_em_lead desc;
end $function$;

create or replace function public.leads_atividade_equipe()
 returns table(dono_id uuid, nome text, tem_telefonia boolean, ultima_ligacao timestamp with time zone, lig_hoje integer,
               ultima_obs timestamp with time zone, obs_hoje integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_ini_dia timestamptz;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_ini_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with eq as (
    select e.profile_id as e_id, p.nome as e_nome, nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as e_u
      from public.leads_equipe e join public.profiles p on p.id = e.profile_id where e.profile_id is not null
  ), obs as (   -- OBS escrita = classificação que mudou a OBS para um texto não vazio
    select h.por as o_por, h.em as o_em from public.leads_historico h
     where h.acao = 'classificar' and h.em >= now() - interval '7 days'
       and coalesce(btrim(h.depois ->> 'obs'), '') <> ''
       and coalesce(btrim(h.depois ->> 'obs'), '') <> coalesce(btrim(h.antes ->> 'obs'), '')
  )
  select eq.e_id, eq.e_nome, eq.e_u is not null,
         (select max(m.gerada_em) from public.ligacoes_manuais m
           where eq.e_u is not null and lower(btrim(m.usuario)) = eq.e_u and m.gerada_em >= now() - interval '7 days'),
         (select count(*) from public.ligacoes_manuais m
           where eq.e_u is not null and lower(btrim(m.usuario)) = eq.e_u and m.gerada_em >= v_ini_dia)::int,
         (select max(o.o_em) from obs o where o.o_por = eq.e_id),
         (select count(*) from obs o where o.o_por = eq.e_id and o.o_em >= v_ini_dia)::int
    from eq order by eq.e_nome;
end $function$;
