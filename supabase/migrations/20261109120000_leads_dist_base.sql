-- §146.1 (09/11, Rafael): base da distribuição automática de leads.
-- Spec: docs/superpowers/specs/2026-11-09-leads-distribuicao-automatica-design.md · Plano: docs/superpowers/plans/2026-11-09-leads-distribuicao-automatica.md
-- Entregas (leads_distribuicao), presença (leads_presenca), sombra (leads_dist_sombra), configuração e sinais de atendimento.
-- Inerte com modo = manual (padrão). Sem DROP. Aplicar com execute_sql (begin/commit). Check: supabase/tests/leads_dist_base_check.sql.
begin;

-- Uma linha por entrega de lead. consultor_id nulo + fechado_em nulo = aguardando o motor.
create table if not exists public.leads_distribuicao (
  id bigserial primary key,
  lead_aba text not null,
  lead_id text not null,
  consultor_id uuid,
  tipo text not null default 'auto' check (tipo in ('auto', 'pegou', 'redistribuido')),
  criado_em timestamptz not null default now(),
  recebido_em timestamptz,
  atendido_em timestamptz,
  sinal text check (sinal in ('clique', 'tabulacao')),
  confirmado boolean,
  confirmado_em timestamptz,
  devolvido_em timestamptz,
  fechado_em timestamptz,
  devolucoes int not null default 0,
  excluidos uuid[] not null default '{}',
  motivo jsonb
);
create unique index if not exists leads_distribuicao_lead_aberta on public.leads_distribuicao (lead_aba, lead_id) where fechado_em is null;
create index if not exists leads_distribuicao_consultor on public.leads_distribuicao (consultor_id, recebido_em desc);
create index if not exists leads_distribuicao_confirmar on public.leads_distribuicao (atendido_em) where atendido_em is not null and confirmado is null;
alter table public.leads_distribuicao enable row level security;

create table if not exists public.leads_presenca (
  profile_id uuid primary key,
  visto_em timestamptz not null default now(),
  pausa_ate timestamptz
);
alter table public.leads_presenca enable row level security;

create table if not exists public.leads_dist_sombra (
  id bigserial primary key,
  lead_aba text not null,
  lead_id text not null,
  em timestamptz not null default now(),
  escolhido uuid,
  motivo jsonb
);
create unique index if not exists leads_dist_sombra_lead on public.leads_dist_sombra (lead_aba, lead_id);
create index if not exists leads_dist_sombra_em on public.leads_dist_sombra (em);
alter table public.leads_dist_sombra enable row level security;
-- sem policies: ninguém lê nem grava direto; só pelas funções abaixo (security definer)
revoke all on public.leads_distribuicao, public.leads_presenca, public.leads_dist_sombra from anon, authenticated;

-- o tick pergunta "quando o robô importou pela última vez" a cada minuto
create index if not exists idx_ligacoes_importado on public.ligacoes_manuais (importado_em);

insert into public.config (chave, valor) select 'leads_distribuicao', '{"modo":"manual"}'
 where not exists (select 1 from public.config where chave = 'leads_distribuicao');
insert into public.config (chave, valor) select 'leads_distribuicao_aviso', '{}'
 where not exists (select 1 from public.config where chave = 'leads_distribuicao_aviso');

-- Padrões + o gravado (o gravado ganha). Chaves: spec §9.
create or replace function public.leads_dist_cfg()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select '{"modo":"manual","peso_conversao":0.5,"piso":0.15,"teto":0.40,"prazo_atender_min":5,"prazo_devolver_min":15,
           "confirmar_min":20,"janela_dias":14,"maturacao_dias":2,"pausa_min":60,"presenca_min":3,"max_devolucoes":2,
           "suav_conv":10,"suav_vel":3,"vel_ultimas":10,"robo_parado_min":30,
           "expediente":{"dias":[1,2,3,4,5],"inicio":"13:00","fim":"21:00"}}'::jsonb
         || coalesce((select c.valor::jsonb from public.config c where c.chave = 'leads_distribuicao'), '{}'::jsonb)
$function$;

-- Expediente em São Paulo (isodow: 1 = segunda … 7 = domingo). fim '24:00' = até o fim do dia.
create or replace function public.leads_dist_no_expediente(p_ts timestamptz default now())
 returns boolean language plpgsql stable security definer set search_path to 'public'
as $function$
declare e jsonb := public.leads_dist_cfg() -> 'expediente'; l timestamp := p_ts at time zone 'America/Sao_Paulo';
begin
  if not exists (select 1 from jsonb_array_elements_text(coalesce(e -> 'dias', '[]'::jsonb)) d where d::int = extract(isodow from l)::int) then
    return false;
  end if;
  return l::time >= (e ->> 'inicio')::time and l::time < (e ->> 'fim')::time;
end $function$;

-- Avisos para a Equipe (motor_erro, robo_parado, parados). p_valor nulo apaga a chave.
create or replace function public.leads_dist_aviso(p_chave text, p_valor jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  select coalesce(c.valor::jsonb, '{}'::jsonb) into v from public.config c where c.chave = 'leads_distribuicao_aviso';
  v := coalesce(v, '{}'::jsonb);
  v := case when p_valor is null then v - p_chave else jsonb_set(v, array[p_chave], p_valor, true) end;
  update public.config set valor = v::text, atualizado_em = now() where chave = 'leads_distribuicao_aviso';
  if not found then insert into public.config (chave, valor) values ('leads_distribuicao_aviso', v::text); end if;
end $function$;

-- Painel aberto avisa a cada 1 min. 'pausa' = fora da vez por pausa_min; 'voltar' = tira a pausa.
create or replace function public.leads_presenca_ping(p_acao text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_pausa timestamptz; v_min int := (public.leads_dist_cfg() ->> 'pausa_min')::int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  if coalesce(p_acao, '') not in ('', 'pausa', 'voltar') then raise exception 'ação inválida: %', p_acao using errcode = '22023'; end if;
  if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    return jsonb_build_object('equipe', false, 'pausa_ate', null);
  end if;
  insert into public.leads_presenca as p (profile_id, visto_em, pausa_ate)
  values (auth.uid(), now(), case when p_acao = 'pausa' then now() + make_interval(mins => v_min) end)
  on conflict (profile_id) do update set visto_em = now(),
    pausa_ate = case when p_acao = 'pausa' then now() + make_interval(mins => v_min)
                     when p_acao = 'voltar' then null else p.pausa_ate end
  returning p.pausa_ate into v_pausa;
  return jsonb_build_object('equipe', true, 'pausa_ate', case when v_pausa > now() then v_pausa end);
end $function$;

-- Tabulação (leads.classificado_em) conta como atendimento da entrega aberta do dono.
create or replace function public.leads_dist_tabulou()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.classificado_em is not null and new.classificado_em is distinct from old.classificado_em and new.dono_id is not null then
    update public.leads_distribuicao set atendido_em = new.classificado_em, sinal = 'tabulacao'
     where lead_aba = new.aba and lead_id = new.id and consultor_id = new.dono_id and fechado_em is null and atendido_em is null;
  end if;
  return new;
end $function$;

-- Clique "ligar" (registrar_contato_lead → leads_contatos) conta como atendimento, se for do dono da entrega.
create or replace function public.leads_dist_clicou()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.canal = 'ligar' then
    update public.leads_distribuicao set atendido_em = new.em, sinal = 'clique'
     where lead_aba = new.lead_aba and lead_id = new.lead_id and consultor_id = new.profile_id and fechado_em is null and atendido_em is null;
  end if;
  return new;
end $function$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'leads_dist_tabulou' and tgrelid = 'public.leads'::regclass) then
    create trigger leads_dist_tabulou after update of classificado_em on public.leads
      for each row execute function public.leads_dist_tabulou();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'leads_dist_clicou' and tgrelid = 'public.leads_contatos'::regclass) then
    create trigger leads_dist_clicou after insert on public.leads_contatos
      for each row execute function public.leads_dist_clicou();
  end if;
end $$;

revoke execute on function public.leads_dist_cfg() from public, anon, authenticated;
revoke execute on function public.leads_dist_no_expediente(timestamptz) from public, anon, authenticated;
revoke execute on function public.leads_dist_aviso(text, jsonb) from public, anon, authenticated;
revoke execute on function public.leads_dist_tabulou() from public, anon, authenticated;
revoke execute on function public.leads_dist_clicou() from public, anon, authenticated;
revoke execute on function public.leads_presenca_ping(text) from public, anon;
grant execute on function public.leads_presenca_ping(text) to authenticated;

commit;
