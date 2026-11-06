-- §139: conferência da migration 20261106120000 (tudo desfeito no fim: o DO termina com exceção de propósito).
-- Rodar no execute_sql. O resultado vem na mensagem 'RESULTADO: ...'.
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

do $$
declare v_admin uuid; v_cons uuid; v_total int; v_conv int; v_esp int; v_espconv int; v_dif int; v_ok boolean;
        v_t0 timestamptz; v_ms int; v_repique int; v_semdono int;
begin
  if has_function_privilege('anon', 'public.leads_agencia()', 'execute') then raise exception 'FALHOU: anon executa leads_agencia'; end if;
  if not has_function_privilege('agencia', 'public.leads_agencia()', 'execute') then raise exception 'FALHOU: papel agencia não executa'; end if;

  select p.id into v_admin from public.profiles p where p.role = 'admin' order by p.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_t0 := clock_timestamp();
  select count(*), count(*) filter (where a.categoria = 'convertido'), count(*) filter (where a.aba = 'REPIQUE'), count(*) filter (where a.dono_nome is null)
    into v_total, v_conv, v_repique, v_semdono from public.leads_agencia() a;
  v_ms := extract(milliseconds from clock_timestamp() - v_t0)::int;
  select count(*), count(*) filter (where l.converteu) into v_esp, v_espconv from public.leads l where l.apagado_em is null;
  if v_total <> v_esp then raise exception 'FALHOU: leads_agencia devolveu % de % leads', v_total, v_esp; end if;
  if v_conv <> v_espconv then raise exception 'FALHOU: % convertidos na Lista, % com converteu', v_conv, v_espconv; end if;

  -- por guia, os mesmos leads/convertidos/receita da Conversão
  select count(*) into v_dif from (
    (select r.aba, sum(r.leads)::bigint, sum(r.convertidos)::bigint, sum(r.receita) from public.conversao_resumo() r group by r.aba
     except
     select a.aba, count(*), count(*) filter (where a.converteu), coalesce(sum(a.receita) filter (where a.converteu), 0)
       from public.leads_agencia() a where nullif(trim(a.aba), '') is not null group by a.aba)
    union all
    (select a.aba, count(*), count(*) filter (where a.converteu), coalesce(sum(a.receita) filter (where a.converteu), 0)
       from public.leads_agencia() a where nullif(trim(a.aba), '') is not null group by a.aba
     except
     select r.aba, sum(r.leads)::bigint, sum(r.convertidos)::bigint, sum(r.receita) from public.conversao_resumo() r group by r.aba)
  ) x;
  if v_dif <> 0 then raise exception 'FALHOU: % guia(s) diferentes entre leads_agencia e conversao_resumo', v_dif; end if;

  -- consultor e usuário sem perfil: recusados
  select p.id into v_cons from public.profiles p where p.role = 'consultor' order by p.created_at limit 1;
  foreach v_admin in array array[v_cons, gen_random_uuid()] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    v_ok := false;
    begin
      perform 1 from public.leads_agencia();
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then raise exception 'FALHOU: % leu leads_agencia', coalesce(v_admin::text, 'sem perfil'); end if;
  end loop;

  raise exception 'RESULTADO: OK — % leads (% convertidos, % Repique, % sem consultor), guias iguais à Conversão, consultor e sem perfil recusados, anon sem acesso; % ms',
    v_total, v_conv, v_repique, v_semdono, v_ms;
end $$;
