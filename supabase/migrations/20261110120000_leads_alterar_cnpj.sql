-- §147 (10/11, Rafael): o consultor altera o CNPJ do lead na ficha (cliente digitou errado ou fechou em outro CNPJ).
-- Quem pode: o dono do lead e admin/supervisor; lead sem dono ou apagado, não. CNPJ novo = 14 dígitos com DV válido.
-- O CNPJ novo substitui o antigo em tudo (Conferir com NEO, venda no NEO, Kanban...); o antigo fica em leads_cnpj_trocas
-- e aparece no Histórico da ficha. A planilha-espelho recebe o CNPJ novo (leads_espelho_enfileirar).
-- Não usa leads_historico: a trava da coluna acao só muda com DROP do CHECK.
-- Spec: docs/superpowers/specs/2026-11-10-alterar-cnpj-design.md.
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/leads_alterar_cnpj_check.sql (desfaz tudo).
begin;

create table if not exists public.leads_cnpj_trocas (
  id        bigint generated always as identity primary key,
  lead_aba  text not null,
  lead_id   text not null,
  antes     text,
  depois    text not null,
  motivo    text not null check (length(trim(motivo)) >= 3),
  por       uuid references public.profiles(id) on delete set null,
  em        timestamptz not null default now()
);
create index if not exists leads_cnpj_trocas_lead_idx on public.leads_cnpj_trocas (lead_aba, lead_id);
alter table public.leads_cnpj_trocas enable row level security;   -- sem policy: só pelas funções abaixo
revoke all on table public.leads_cnpj_trocas from public, anon, authenticated;

-- CNPJ numérico com os dois dígitos verificadores (pesos 5..2,9..2 e 6..2,9..2). Pura, testável sem auth.
create or replace function public.leads_cnpj_valido(p text)
 returns boolean language plpgsql immutable set search_path to 'public'
as $function$
declare d text := coalesce(p, ''); s int; r int; dv1 int; dv2 int; i int;
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if d !~ '^[0-9]{14}$' or d ~ '^(.)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + substr(d, i, 1)::int * p1[i]; end loop;
  r := s % 11; dv1 := case when r < 2 then 0 else 11 - r end;
  s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::int * p2[i]; end loop;
  r := s % 11; dv2 := case when r < 2 then 0 else 11 - r end;
  return substr(d, 13, 1)::int = dv1 and substr(d, 14, 1)::int = dv2;
end $function$;

create or replace function public.leads_alterar_cnpj(p_aba text, p_id text, p_cnpj text, p_motivo text)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_dig text; v_dono uuid; v_antes text;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escreva o motivo (pelo menos 3 letras).' using errcode = '22023';
  end if;
  v_dig := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  if not public.leads_cnpj_valido(v_dig) then
    raise exception 'CNPJ inválido: confira os 14 números.' using errcode = '22023';
  end if;
  select l.dono_id, l.cnpj into v_dono, v_antes
    from public.leads l where l.aba = p_aba and l.id = p_id and l.apagado_em is null
   for update;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if v_dono is null then raise exception 'Pegue o lead antes de alterar o CNPJ.' using errcode = '42501'; end if;
  if not v_gestor and v_dono <> auth.uid() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if regexp_replace(coalesce(v_antes, ''), '[^0-9]', '', 'g') = v_dig then
    raise exception 'Este já é o CNPJ do lead.' using errcode = '22023';
  end if;
  update public.leads set cnpj = v_dig, atualizado_em = now() where aba = p_aba and id = p_id;
  insert into public.leads_cnpj_trocas (lead_aba, lead_id, antes, depois, motivo, por)
  values (p_aba, p_id, nullif(trim(coalesce(v_antes, '')), ''), v_dig, trim(p_motivo), auth.uid());
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return v_dig;
end $function$;

-- Igual à versão no ar (10/11), mais o union das trocas de CNPJ (tipo 'cnpj').
create or replace function public.leads_ficha_detalhes(p_aba text, p_id text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor');
        l public.leads%rowtype; v_livre boolean; i record; v_anuncio jsonb; v_ev jsonb;
begin
  select * into l from public.leads where aba = p_aba and id = p_id;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  v_livre := l.dono_id is null and l.categoria = 'sem_contato';
  if not v_gestor then
    if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
    if not v_livre and l.dono_id is distinct from auth.uid() then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
  end if;
  v_anuncio := jsonb_build_object('campanha', l.campaign_name, 'conjunto', l.adset_name, 'anuncio', l.ad_name,
                                  'formulario', l.form_name, 'plataforma', l.platform, 'organico', l.is_organic);
  if v_livre and not v_gestor then
    return jsonb_build_object('anuncio', v_anuncio, 'resumo', null, 'eventos',
      jsonb_build_array(jsonb_build_object('em', l.criado_em_lead, 'tipo', 'chegou', 'titulo', 'Lead chegou', 'detalhe', l.campaign_name, 'quem', null)));
  end if;
  select * into i from public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.em desc), '[]'::jsonb) into v_ev from (
    select l.criado_em_lead as em, 'chegou'::text as tipo, 'Lead chegou'::text as titulo, l.campaign_name as detalhe, null::text as quem
    union all
    select h.em, h.acao,
           case h.acao when 'pegar' then 'Pegou o lead' when 'classificar' then 'Classificou: ' || coalesce(h.depois ->> 'status', '')
                       when 'redistribuir' then 'Passou para ' || coalesce(h.depois ->> 'consultor', '') else 'Devolveu aos Livres' end,
           case when h.acao = 'classificar' then nullif(h.depois ->> 'obs', '') end, p.nome
      from public.leads_historico h left join public.profiles p on p.id = h.por
     where h.lead_aba = l.aba and h.lead_id = l.id
    union all
    select t.em, 'cnpj', 'Trocou o CNPJ', concat_ws(' · ', coalesce(t.antes, 'sem CNPJ') || ' → ' || t.depois, t.motivo), p.nome
      from public.leads_cnpj_trocas t left join public.profiles p on p.id = t.por
     where t.lead_aba = l.aba and t.lead_id = l.id
    union all
    select c.em, 'clique', case c.canal when 'whatsapp' then 'Abriu o WhatsApp' when 'ligar' then 'Clicou em Ligar' else 'Contato registrado' end, null, p.nome
      from public.leads_contatos c left join public.profiles p on p.id = c.profile_id
     where c.lead_aba = l.aba and c.lead_id = l.id
    union all
    select m.gerada_em, 'ligacao', case when m.atendida then 'Ligação atendida' else 'Ligação não atendida' end,
           nullif(concat_ws(' · ', case when coalesce(m.seg_falados, 0) > 0 then (m.seg_falados / 60) || ' min ' || (m.seg_falados % 60) || ' s' end, nullif(m.tabulacao, '')), ''),
           m.usuario
      from public.ligacoes_manuais m
     where public.chave_tel(l.phone_number) is not null and m.chave_tel = public.chave_tel(l.phone_number)
       and m.gerada_em >= l.criado_em_lead - interval '1 hour'
    union all
    select d.gerada_em, 'discador', case when d.status = 'ANSWERED' then 'Discador: atendida' else 'Discador: ' || lower(coalesce(d.status, '')) end,
           case when coalesce(d.seg_falados, 0) > 0 then (d.seg_falados / 60) || ' min ' || (d.seg_falados % 60) || ' s' end, null
      from public.discador_chamadas d
     where length(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g')) = 14
       and d.cnpj = regexp_replace(l.cnpj, '[^0-9]', '', 'g') and d.gerada_em >= l.criado_em_lead - interval '1 hour'
    union all
    select a.criado_em, 'retorno', case a.status when 'pendente' then 'Retorno agendado' when 'feito' then 'Retorno feito' else 'Retorno cancelado' end,
           to_char(a.quando at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), null
      from public.agenda_retornos a where a.lead_aba = l.aba and a.lead_id = l.id
  ) e where e.em is not null;
  return jsonb_build_object('anuncio', v_anuncio,
    'resumo', jsonb_build_object('ligacoes', i.ligacoes, 'atendidas', i.atendidas, 'cliques', i.cliques, 'ultimo', i.ultimo),
    'eventos', v_ev);
end $function$;

revoke all on function public.leads_cnpj_valido(text) from public, anon;
revoke all on function public.leads_alterar_cnpj(text, text, text, text) from public, anon;
grant execute on function public.leads_cnpj_valido(text) to authenticated, service_role;
grant execute on function public.leads_alterar_cnpj(text, text, text, text) to authenticated, service_role;

commit;
