-- §138.1 (05/11, Rafael): Conversão dos leads em Meus leads. Spec: docs/superpowers/specs/2026-11-05-conversao-leads-design.md (seção 4).
-- conversao_resumo(): só somas por guia (mês) e consultor — nada de cliente, telefone, e-mail, CNPJ ou id de lead.
-- meu_perfil(): a linha do próprio usuário em profiles (o login da agência lê o perfil por aqui; ver 20261105120100).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/conversao_resumo_check.sql (desfaz tudo).
begin;

create or replace function public.conversao_resumo()
 returns table(aba text, ordem timestamptz, consultor text, leads int, convertidos int, receita numeric, conv_sem_receita int)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_role text; v_op text;
begin
  select p.role, coalesce(p.operacao, 'apex') into v_role, v_op from public.profiles p where p.id = auth.uid();
  if v_role is null or not (v_role in ('admin', 'agencia') or (v_role in ('supervisor', 'consultor') and v_op = 'apex')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with base as (
    select l.aba as b_aba, l.criado_em_lead as b_criado,
           coalesce(nullif(trim(l.consultor), ''), nullif(trim(pr.nome), '')) as b_consultor,
           coalesce(l.converteu, false) as b_conv, l.receita as b_receita
      from public.leads l
      left join public.profiles pr on pr.id = l.dono_id
     where l.apagado_em is null and nullif(trim(l.aba), '') is not null
  ), ordens as (
    select b.b_aba as o_aba, min(b.b_criado) as o_ordem from base b group by b.b_aba
  )
  select b.b_aba, o.o_ordem, b.b_consultor,
         count(*)::int,
         (count(*) filter (where b.b_conv))::int,
         coalesce(sum(b.b_receita) filter (where b.b_conv), 0)::numeric,
         (count(*) filter (where b.b_conv and coalesce(b.b_receita, 0) = 0))::int
    from base b join ordens o on o.o_aba = b.b_aba
   group by b.b_aba, o.o_ordem, b.b_consultor
   order by o.o_ordem, b.b_aba, b.b_consultor;
end $function$;

create or replace function public.meu_perfil()
 returns table(id uuid, nome text, username text, role text, operacao text)
 language sql stable security definer set search_path to 'public'
as $function$
  select p.id, p.nome, p.username, p.role, coalesce(p.operacao, 'apex') from public.profiles p where p.id = auth.uid()
$function$;

revoke all on function public.conversao_resumo() from public, anon;
revoke all on function public.meu_perfil() from public, anon;
grant execute on function public.conversao_resumo() to authenticated, service_role;
grant execute on function public.meu_perfil() to authenticated, service_role;

commit;
