-- §142: conferência da migration 20261107120000 (tudo desfeito no fim: o DO termina com exceção de propósito).
-- Rodar no execute_sql. O resultado vem na mensagem 'RESULTADO: ...'.
begin;

create table if not exists public.leads_neo_ok (
  lead_aba   text not null,
  lead_id    text not null,
  tipo       text not null,
  neo_pedido text,
  neo_etapa  text,
  motivo     text not null check (length(trim(motivo)) >= 3),
  marcado_por uuid,
  marcado_em timestamptz not null default now(),
  primary key (lead_aba, lead_id)
);
alter table public.leads_neo_ok enable row level security;   -- sem policy: só pelas funções abaixo
revoke all on table public.leads_neo_ok from public, anon, authenticated;

-- Classificação pura (testável sem auth): painel × NEO → tipo ou null.
create or replace function public.leads_neo_tipo(p_converteu boolean, p_categoria text, p_grupo_neo text)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case
    when coalesce(p_converteu, false) and p_grupo_neo = 'perdido' then 'venda_neo_perdido'
    when coalesce(p_converteu, false) and p_grupo_neo = 'sem'     then 'venda_sem_neo'
    when not coalesce(p_converteu, false) and p_categoria = 'perdido' and p_grupo_neo = 'ganho'     then 'perdido_neo_ganho'
    when not coalesce(p_converteu, false) and p_categoria = 'perdido' and p_grupo_neo = 'andamento' then 'perdido_neo_andamento'
    when not coalesce(p_converteu, false) and coalesce(p_categoria, 'sem_contato') in ('sem_contato', 'andamento') and p_grupo_neo = 'ganho'   then 'aberto_neo_ganho'
    when not coalesce(p_converteu, false) and coalesce(p_categoria, 'sem_contato') in ('sem_contato', 'andamento') and p_grupo_neo = 'perdido' then 'aberto_neo_perdido'
    when coalesce(p_converteu, false) and coalesce(p_categoria, '') <> 'convertido' then 'venda_status'
  end
$function$;

create or replace function public.leads_neo_grupo(p_etapa text)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case
    when p_etapa is null then 'sem'
    when p_etapa ~* '(PERDID|DEVOLVID|CANCELAD)' then 'perdido'
    when p_etapa in ('CONCLUIDO (NEOCRM)', 'ENTREGA (NEOCRM)', 'FATURAMENTO (NEOCRM)',
                     'PORTABILIDADE EM ANDAMENTO (NEOCRM)', 'VALIDAÇÃO ESIM (NEOCRM)') then 'ganho'
    else 'andamento'
  end
$function$;

-- Lista de divergências. Consultor: só os dele. Admin/supervisor: todos (p_dono null, inclui sem consultor) ou de um dono.
-- Devolve também os já marcados "Está certo" (ok_*), para o gestor ver quem marcou e por quê; o painel esconde do consultor.
create or replace function public.leads_conferir_neo(p_dono uuid default null)
 returns table(aba text, lead_id text, nome text, dono_id uuid, dono_nome text, status text, converteu boolean, receita numeric,
               criado_em_lead timestamptz, tipo text, sem_cnpj boolean, neo_pedido text, neo_etapa text,
               neo_atualizacao timestamptz, neo_valor numeric, neo_pedidos int,
               ok_motivo text, ok_por_nome text, ok_em timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_alvo uuid;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  return query
  with base as (
    select l.aba, l.id, l.full_name, l.dono_id, l.status, l.categoria, coalesce(l.converteu, false) as conv, l.receita, l.criado_em_lead,
           nullif(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g'), '') as doc
      from public.leads l
     where coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null
       and (v_alvo is null or l.dono_id = v_alvo)
       and (v_gestor or l.dono_id is not null)
  ), ped as (
    select regexp_replace(p.cnpj, '[^0-9]', '', 'g') as doc, p.numero_pedido, p.etapa, p.atualizacao, p.cadastro, p.valor
      from public.producao_pedidos p
     where p.cnpj is not null
       and regexp_replace(p.cnpj, '[^0-9]', '', 'g') in (select b.doc from base b where length(b.doc) >= 11)
  ), ult as (
    select distinct on (doc) doc, numero_pedido, etapa, coalesce(atualizacao, cadastro) as em
      from ped
     order by doc, atualizacao desc nulls last, cadastro desc nulls last
  ), tot as (
    select doc, count(distinct numero_pedido)::int as n from ped group by doc
  ), cruzado as (
    select b.*, u.numero_pedido, u.etapa, u.em, t.n,
           (select sum(coalesce(x.valor, 0)) from ped x where x.doc = u.doc and x.numero_pedido = u.numero_pedido) as valor,
           public.leads_neo_tipo(b.conv, b.categoria,
             public.leads_neo_grupo(case when length(b.doc) >= 11 then u.etapa end)) as tipo
      from base b
      left join ult u on length(b.doc) >= 11 and u.doc = b.doc
      left join tot t on t.doc = u.doc
  )
  select c.aba, c.id, c.full_name, c.dono_id, pr.nome, c.status, c.conv, c.receita, c.criado_em_lead,
         c.tipo, coalesce(length(c.doc), 0) < 11, c.numero_pedido, c.etapa, c.em, c.valor, coalesce(c.n, 0),
         ok.motivo, po.nome, ok.marcado_em
    from cruzado c
    left join public.profiles pr on pr.id = c.dono_id
    left join public.leads_neo_ok ok on ok.lead_aba = c.aba and ok.lead_id = c.id
          and ok.tipo = c.tipo and ok.neo_pedido is not distinct from c.numero_pedido and ok.neo_etapa is not distinct from c.etapa
    left join public.profiles po on po.id = ok.marcado_por
   where c.tipo is not null
   order by pr.nome nulls last, c.tipo, c.criado_em_lead desc;
end $function$;

-- "Está certo assim": grava a exceção para a situação atual (tipo + pedido + etapa). Consultor só nos leads dele.
create or replace function public.leads_neo_marcar_ok(p_aba text, p_id text, p_motivo text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_dono uuid; r record;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escreva o motivo (pelo menos 3 letras).' using errcode = '22023';
  end if;
  select l.dono_id into v_dono from public.leads l where l.aba = p_aba and l.id = p_id and l.apagado_em is null;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if not v_gestor and (v_dono is null or v_dono <> auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select c.tipo, c.neo_pedido, c.neo_etapa into r
    from public.leads_conferir_neo(case when v_gestor then v_dono end) c
   where c.aba = p_aba and c.lead_id = p_id;
  if r.tipo is null then raise exception 'Este lead já bate com o NEO.' using errcode = '22023'; end if;
  insert into public.leads_neo_ok (lead_aba, lead_id, tipo, neo_pedido, neo_etapa, motivo, marcado_por, marcado_em)
  values (p_aba, p_id, r.tipo, r.neo_pedido, r.neo_etapa, trim(p_motivo), auth.uid(), now())
  on conflict (lead_aba, lead_id) do update
     set tipo = excluded.tipo, neo_pedido = excluded.neo_pedido, neo_etapa = excluded.neo_etapa,
         motivo = excluded.motivo, marcado_por = excluded.marcado_por, marcado_em = excluded.marcado_em;
end $function$;

revoke all on function public.leads_neo_tipo(boolean, text, text) from public, anon;
revoke all on function public.leads_neo_grupo(text) from public, anon;
revoke all on function public.leads_conferir_neo(uuid) from public, anon;
revoke all on function public.leads_neo_marcar_ok(text, text, text) from public, anon;
grant execute on function public.leads_neo_tipo(boolean, text, text) to authenticated, service_role;
grant execute on function public.leads_neo_grupo(text) to authenticated, service_role;
grant execute on function public.leads_conferir_neo(uuid) to authenticated, service_role;
grant execute on function public.leads_neo_marcar_ok(text, text, text) to authenticated, service_role;


do $$
declare v_admin uuid; v_cons uuid; v_outro record; v_meu record; v_total int; v_semdono int; v_cons_n int; v_esp_n int;
        v_ruim int; v_t0 timestamptz; v_ms int; v_ok boolean;
begin
  -- privilégios
  if has_function_privilege('anon', 'public.leads_conferir_neo(uuid)', 'execute') then raise exception 'FALHOU: anon executa leads_conferir_neo'; end if;
  if has_function_privilege('anon', 'public.leads_neo_marcar_ok(text,text,text)', 'execute') then raise exception 'FALHOU: anon executa leads_neo_marcar_ok'; end if;
  if has_table_privilege('authenticated', 'public.leads_neo_ok', 'select') then raise exception 'FALHOU: authenticated lê leads_neo_ok direto'; end if;

  -- classificação pura
  if public.leads_neo_grupo(null) <> 'sem' or public.leads_neo_grupo('VENDA PERDIDA (NEOCRM)') <> 'perdido'
     or public.leads_neo_grupo('DEVOLVIDO (NEOCRM)') <> 'perdido' or public.leads_neo_grupo('CONCLUIDO (NEOCRM)') <> 'ganho'
     or public.leads_neo_grupo('VALIDAÇÃO ESIM (NEOCRM)') <> 'ganho' or public.leads_neo_grupo('BIOMETRIA (NEOCRM)') <> 'andamento' then
    raise exception 'FALHOU: leads_neo_grupo';
  end if;
  if public.leads_neo_tipo(true, 'convertido', 'perdido') <> 'venda_neo_perdido' or public.leads_neo_tipo(true, 'convertido', 'sem') <> 'venda_sem_neo'
     or public.leads_neo_tipo(false, 'perdido', 'ganho') <> 'perdido_neo_ganho' or public.leads_neo_tipo(false, 'perdido', 'andamento') <> 'perdido_neo_andamento'
     or public.leads_neo_tipo(false, 'andamento', 'ganho') <> 'aberto_neo_ganho' or public.leads_neo_tipo(false, 'sem_contato', 'perdido') <> 'aberto_neo_perdido'
     or public.leads_neo_tipo(true, 'perdido', 'ganho') <> 'venda_status'
     or public.leads_neo_tipo(true, 'convertido', 'ganho') is not null or public.leads_neo_tipo(true, 'convertido', 'andamento') is not null
     or public.leads_neo_tipo(false, 'perdido', 'perdido') is not null or public.leads_neo_tipo(false, 'perdido', 'sem') is not null
     or public.leads_neo_tipo(false, 'andamento', 'sem') is not null or public.leads_neo_tipo(false, 'andamento', 'andamento') is not null then
    raise exception 'FALHOU: leads_neo_tipo';
  end if;

  -- admin vê tudo
  select p.id into v_admin from public.profiles p where p.role = 'admin' order by p.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_t0 := clock_timestamp();
  select count(*), count(*) filter (where c.dono_id is null) into v_total, v_semdono from public.leads_conferir_neo(null) c;
  v_ms := extract(milliseconds from clock_timestamp() - v_t0)::int;
  if v_total = 0 then raise exception 'FALHOU: nenhuma divergência (esperado ~290 em 07/11)'; end if;
  select count(*) into v_ruim from public.leads_conferir_neo(null) c
    left join public.leads l on l.aba = c.aba and l.id = c.lead_id
   where l.id is null or l.apagado_em is not null or c.aba = 'REPIQUE'
      or (c.tipo like 'venda%' and not coalesce(l.converteu, false))
      or (c.tipo not like 'venda%' and coalesce(l.converteu, false))
      or (c.tipo = 'venda_sem_neo' and c.neo_pedido is not null);
  if v_ruim > 0 then raise exception 'FALHOU: % linha(s) incoerentes com a tabela leads', v_ruim; end if;

  -- consultor vê só os dele (mesmos leads que o admin vê para esse dono)
  select c.dono_id into v_cons from public.leads_conferir_neo(null) c
    join public.leads_equipe e on e.profile_id = c.dono_id
   join public.profiles p on p.id = c.dono_id and p.role not in ('admin', 'supervisor')
   group by 1 order by count(*) desc limit 1;
  if v_cons is null then raise exception 'FALHOU: nenhum consultor da equipe com divergência para testar'; end if;
  select count(*) into v_esp_n from public.leads_conferir_neo(v_cons) c;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  select count(*) into v_cons_n from public.leads_conferir_neo(null) c;
  if v_cons_n <> v_esp_n then raise exception 'FALHOU: consultor vê % leads, admin vê % dele', v_cons_n, v_esp_n; end if;
  if exists (select 1 from public.leads_conferir_neo(v_admin) c where c.dono_id is distinct from v_cons) then
    raise exception 'FALHOU: consultor passou p_dono e viu lead de outro';
  end if;

  -- Está certo: motivo obrigatório, só no lead dele, sai da lista e volta quando o NEO muda
  select c.aba, c.lead_id into v_meu from public.leads_conferir_neo(null) c limit 1;
  begin perform public.leads_neo_marcar_ok(v_meu.aba, v_meu.lead_id, ' a '); raise exception 'FALHOU: aceitou motivo curto';
  exception when sqlstate '22023' then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select c.aba, c.lead_id into v_outro from public.leads_conferir_neo(null) c where c.dono_id is distinct from v_cons and c.dono_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  if v_outro.lead_id is not null then
    begin perform public.leads_neo_marcar_ok(v_outro.aba, v_outro.lead_id, 'teste da conferência'); raise exception 'FALHOU: consultor marcou lead de outro';
    exception when sqlstate '42501' then null; end;
  end if;
  perform public.leads_neo_marcar_ok(v_meu.aba, v_meu.lead_id, 'teste da conferência');
  select c.ok_em is not null into v_ok from public.leads_conferir_neo(null) c where c.aba = v_meu.aba and c.lead_id = v_meu.lead_id;
  if not v_ok then raise exception 'FALHOU: Está certo não marcou o lead'; end if;
  update public.leads_neo_ok set neo_etapa = 'ETAPA QUE MUDOU' where lead_aba = v_meu.aba and lead_id = v_meu.lead_id;
  select c.ok_em is not null into v_ok from public.leads_conferir_neo(null) c where c.aba = v_meu.aba and c.lead_id = v_meu.lead_id;
  if v_ok then raise exception 'FALHOU: NEO mudou e o lead não voltou para a lista'; end if;

  raise exception 'RESULTADO: OK — % divergências (% sem consultor), consultor vê só as % dele, Está certo marca/volta, motivo e dono travados, anon sem acesso; % ms',
    v_total, v_semdono, v_cons_n, v_ms;
end $$;
