-- §139 (06/11, Rafael): a agência vê cada lead e se a Apex converteu (Meus leads → Lista, só leitura).
-- leads_agencia(): TODOS os leads (inclusive sem consultor e Repique), com contato (telefone, e-mail, CNPJ),
-- SEM as anotações dos consultores (obs) e sem dado da produção do NEO.
-- Mesma regra da Conversão (conversao_resumo): consultor = nome da planilha ou dono; convertido = converteu.
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/leads_agencia_check.sql (desfaz tudo).
begin;

create or replace function public.leads_agencia()
 returns table(aba text, lead_id text, nome text, cidade text, uf text, qtd_linhas text, tipo_empresa text,
               telefone text, email text, cnpj text, status text, categoria text, converteu boolean, receita numeric,
               retorno_em date, dono_nome text, pego_em timestamptz, classificado_em timestamptz, criado_em_lead timestamptz,
               primeira_ligacao timestamptz, livre boolean, ligacoes int, ultima_ligacao timestamptz, ultima_atendida boolean,
               ultima_seg int, ultima_tabulacao text, campanha text, formulario text)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_role text;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('admin', 'agencia') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with base as (
    select l.*, coalesce(l.converteu, false) as b_conv,
           nullif(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g'), '') as doc,
           public.chave_tel(l.phone_number) as chave
      from public.leads l
     where l.apagado_em is null
  )
  select b.aba, b.id, b.full_name, b.city, b.state, b.qtd_linhas, b.tipo_empresa,
         b.phone_number, b.email, b.cnpj, b.status,
         case when b.b_conv then 'convertido' else b.categoria end,
         b.b_conv, b.receita, b.retorno_em,
         coalesce(nullif(trim(b.consultor), ''), nullif(trim(pr.nome), '')),
         b.pego_em, b.classificado_em, b.criado_em_lead,
         lg.primeira,
         (b.dono_id is null and b.categoria = 'sem_contato'),
         coalesce(lg.n, 0), ul.em, ul.atendida, ul.seg, ul.tab,
         b.campaign_name, b.form_name
    from base b
    left join public.profiles pr on pr.id = b.dono_id
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

revoke all on function public.leads_agencia() from public, anon;
grant execute on function public.leads_agencia() to authenticated, agencia, service_role;

commit;
