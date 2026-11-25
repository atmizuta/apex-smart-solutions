-- §165: agente de IA no WhatsApp fora do expediente. Spec: docs/superpowers/specs/2026-11-24-whatsapp-agente-noturno-design.md.
-- Sem DROP. Check: supabase/tests/wa_agente_check.sql. Cron em 20261124120100_wa_agente_cron.sql. Aplicar só com ok do Rafael.

create table if not exists public.wa_conversas (
  id uuid primary key default gen_random_uuid(),
  telefone text not null,
  nome_perfil text,
  lead_aba text,
  lead_id text,
  estado text not null default 'em_andamento' check (estado in ('em_andamento', 'pronto', 'precisa_humano', 'encerrada')),
  ficha jsonb not null default '{}'::jsonb,
  alertas jsonb not null default '[]'::jsonb,
  motivo_humano text,
  respostas_noite int not null default 0,
  avisou_falha boolean not null default false,
  primeiro_wamid text,
  ultimo_cliente_em timestamptz,
  ultimo_agente_em timestamptz,
  ultimo_consultor_em timestamptz,
  silencio_ate timestamptz,
  trava_ate timestamptz,
  falhou_em timestamptz,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists wa_conversas_telefone on public.wa_conversas (telefone, criada_em desc);
create index if not exists wa_conversas_lead on public.wa_conversas (lead_aba, lead_id);

create table if not exists public.wa_mensagens (
  id bigint generated always as identity primary key,
  wamid text not null unique,
  conversa_id uuid not null references public.wa_conversas (id) on delete cascade,
  autor text not null check (autor in ('cliente', 'agente', 'consultor')),
  formato text not null,
  texto text,
  caminho text,
  mime text,
  nome_arquivo text,
  em timestamptz not null default now(),
  recebida_em timestamptz not null default now()
);
create index if not exists wa_mensagens_conversa on public.wa_mensagens (conversa_id, id);
create index if not exists wa_mensagens_caminho on public.wa_mensagens (caminho) where caminho is not null;
create index if not exists wa_mensagens_recebida on public.wa_mensagens (recebida_em);

-- RLS sem policy: ninguém lê direto; painel e função usam as RPCs abaixo.
alter table public.wa_conversas enable row level security;
alter table public.wa_mensagens enable row level security;
revoke all on public.wa_conversas, public.wa_mensagens from anon, authenticated;

insert into public.config (chave, valor)
select 'wa_agente', '{"modo":"desligado","numeros_ensaio":[],"max_respostas_noite":40}'
 where not exists (select 1 from public.config where chave = 'wa_agente');

insert into storage.buckets (id, name, public, file_size_limit)
values ('wa-documentos', 'wa-documentos', false, 10485760)
on conflict (id) do nothing;

-- Igual a chaveTelefone (telefone.ts): DDD + últimos 8 dígitos; o 55 do país sai.
create or replace function public.wa_chave_tel(p text)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case when length(d) in (10, 11) then left(d, 2) || right(d, 8) end
    from (select case when length(x) >= 12 and left(x, 2) = '55' then substr(x, 3) else x end as d
            from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as x) a) b
$function$;

-- Primeiro minuto em expediente a partir de p_ts (passo de 15 min, depois de 1 min). Até 8 dias; senão null.
create or replace function public.wa_proximo_expediente(p_ts timestamptz default now())
 returns timestamptz language plpgsql stable security definer set search_path to 'public'
as $function$
declare t timestamptz := date_trunc('minute', p_ts); t2 timestamptz;
begin
  for i in 0 .. 8 * 24 * 4 loop
    exit when public.leads_dist_no_expediente(t);
    t := t + interval '15 minutes';
  end loop;
  if not public.leads_dist_no_expediente(t) then return null; end if;
  t2 := greatest(date_trunc('minute', p_ts), t - interval '15 minutes');
  while not public.leads_dist_no_expediente(t2) loop t2 := t2 + interval '1 minute'; end loop;
  return t2;
end $function$;

-- "hoje / amanhã / segunda-feira a partir das 14h" (horário de São Paulo).
create or replace function public.wa_quando_texto(p_alvo timestamptz, p_agora timestamptz default now())
 returns text language sql stable set search_path to 'public'
as $function$
  select case when p_alvo is null then 'no próximo expediente' else
    case (a.alvo::date - a.agora::date) when 0 then 'hoje' when 1 then 'amanhã'
      else (array['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'])[extract(isodow from a.alvo)::int] end
    || ' a partir das ' || extract(hour from a.alvo)::int || 'h'
    || case when extract(minute from a.alvo) > 0 then to_char(a.alvo, 'MI') else '' end end
  from (select p_alvo at time zone 'America/Sao_Paulo' as alvo, p_agora at time zone 'America/Sao_Paulo' as agora) a
$function$;

create or replace function public.wa_no_expediente()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$ select public.leads_dist_no_expediente(now()) $function$;

-- Grava eventos do webhook (cliente e eco). Devolve, fora do expediente, a última mensagem nova do cliente por conversa.
create or replace function public.wa_receber(p_eventos jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare e jsonb; v_conv uuid; v_tel text; v_aba text; v_id text; n int; v_novas jsonb := '{}'::jsonb;
  v_exp boolean := public.leads_dist_no_expediente(now());
begin
  for e in select * from jsonb_array_elements(coalesce(p_eventos, '[]'::jsonb)) loop
    v_conv := null; v_aba := null; v_id := null;
    v_tel := regexp_replace(coalesce(e ->> 'telefone', ''), '\D', '', 'g');
    continue when v_tel = '' or coalesce(e ->> 'wamid', '') = '';
    continue when exists (select 1 from public.wa_mensagens m where m.wamid = e ->> 'wamid');   -- reentrega da Meta
    -- conversa aberta deste telefone; nova quando a última está pronta/encerrada há mais de 24 h
    select cv.id into v_conv from public.wa_conversas cv
     where cv.telefone = v_tel and not (cv.estado in ('pronto', 'encerrada') and cv.atualizada_em < now() - interval '24 hours')
     order by cv.criada_em desc limit 1;
    if v_conv is null then
      select l.aba, l.id into v_aba, v_id from public.leads l
       where public.wa_chave_tel(l.phone_number) = public.wa_chave_tel(v_tel) and l.apagado_em is null
       order by l.criado_em_lead desc nulls last limit 1;
      insert into public.wa_conversas (telefone, nome_perfil, lead_aba, lead_id, primeiro_wamid)
      values (v_tel, e ->> 'nome_perfil', v_aba, v_id, e ->> 'wamid') returning id into v_conv;
    end if;
    insert into public.wa_mensagens (wamid, conversa_id, autor, formato, texto, caminho, mime, nome_arquivo, em)
    values (e ->> 'wamid', v_conv, case when e ->> 'tipo' = 'eco' then 'consultor' else 'cliente' end,
            coalesce(e ->> 'formato', 'outro'), e ->> 'texto', e ->> 'caminho', e ->> 'mime', e ->> 'nome_arquivo',
            coalesce(nullif(e ->> 'em', '')::timestamptz, now()))
    on conflict (wamid) do nothing;
    get diagnostics n = row_count;
    continue when n = 0;
    if e ->> 'tipo' = 'eco' then
      -- consultor respondeu pelo WhatsApp Web; à noite o agente fica quieto até o próximo expediente
      update public.wa_conversas set ultimo_consultor_em = now(), atualizada_em = now(),
             silencio_ate = case when v_exp then silencio_ate else public.wa_proximo_expediente(now()) end
       where id = v_conv;
    else
      update public.wa_conversas set ultimo_cliente_em = now(), atualizada_em = now(),
             nome_perfil = coalesce(e ->> 'nome_perfil', nome_perfil)
       where id = v_conv;
      if not v_exp then v_novas := v_novas || jsonb_build_object(v_conv::text, e ->> 'wamid'); end if;
    end if;
  end loop;
  return coalesce((select jsonb_agg(jsonb_build_object('conversa_id', k, 'wamid', w)) from jsonb_each_text(v_novas) x(k, w)), '[]'::jsonb);
end $function$;

-- Tudo que o agente precisa numa leitura (formato = tipo Contexto de agente.ts).
create or replace function public.wa_contexto(p_conversa uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'no_expediente', public.leads_dist_no_expediente(now()),
    'modo', coalesce(k.cfg ->> 'modo', 'desligado'),
    'numeros_ensaio', coalesce(k.cfg -> 'numeros_ensaio', '[]'::jsonb),
    'max_respostas_noite', coalesce((k.cfg ->> 'max_respostas_noite')::int, 40),
    'agora_texto', (array['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'])[extract(isodow from now() at time zone 'America/Sao_Paulo')::int]
                   || ', ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
    'proximo_expediente', public.wa_quando_texto(public.wa_proximo_expediente(now())),
    'conversa', jsonb_build_object('id', c.id, 'telefone', c.telefone, 'estado', c.estado, 'ficha', c.ficha,
       'respostas_noite', c.respostas_noite, 'silenciosa', coalesce(c.silencio_ate > now(), false), 'avisou_falha', c.avisou_falha),
    'lead', (select jsonb_build_object('nome', l.full_name, 'dono_nome', p.nome) from public.leads l
              left join public.profiles p on p.id = l.dono_id where l.aba = c.lead_aba and l.id = c.lead_id),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('id', m.wamid, 'autor', m.autor, 'formato', m.formato, 'texto', m.texto,
                     'caminho', m.caminho, 'mime', m.mime) order by m.id)
                   from (select * from public.wa_mensagens where conversa_id = c.id order by id desc limit 60) m), '[]'::jsonb))
  from public.wa_conversas c
  cross join (select coalesce((select valor::jsonb from public.config where chave = 'wa_agente'), '{}'::jsonb) as cfg) k
  where c.id = p_conversa
$function$;

create or replace function public.wa_travar(p_conversa uuid)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
begin
  update public.wa_conversas set trava_ate = now() + interval '5 minutes'
   where id = p_conversa and (trava_ate is null or trava_ate < now());
  return found;
end $function$;

create or replace function public.wa_liberar(p_conversa uuid) returns void language sql security definer set search_path to 'public'
as $function$ update public.wa_conversas set trava_ate = null where id = p_conversa $function$;
create or replace function public.wa_adiar(p_conversa uuid) returns void language sql security definer set search_path to 'public'
as $function$ update public.wa_conversas set falhou_em = now() where id = p_conversa $function$;
create or replace function public.wa_avisou_falha(p_conversa uuid) returns void language sql security definer set search_path to 'public'
as $function$ update public.wa_conversas set avisou_falha = true where id = p_conversa $function$;

create or replace function public.wa_ultima_do_cliente(p_conversa uuid)
 returns text language sql stable security definer set search_path to 'public'
as $function$ select wamid from public.wa_mensagens where conversa_id = p_conversa and autor = 'cliente' order by id desc limit 1 $function$;

-- Salva ficha/alertas/estado. O lead só nasce com interesse real (nome + CNPJ ou nome + serviço): protege a nota do §146.
create or replace function public.wa_salvar(p_conversa uuid, p_ficha jsonb, p_alertas jsonb, p_estado text, p_motivo text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare c public.wa_conversas%rowtype; v_aba text; v_id text;
begin
  update public.wa_conversas set
         ficha = coalesce(p_ficha, ficha),
         alertas = coalesce(p_alertas, alertas),
         estado = coalesce(p_estado, estado),
         motivo_humano = case when p_estado = 'precisa_humano' then p_motivo else motivo_humano end,
         silencio_ate = case when p_estado = 'precisa_humano' then public.wa_proximo_expediente(now()) else silencio_ate end,
         atualizada_em = now()
   where id = p_conversa returning * into c;
  if not found then raise exception 'conversa não encontrada' using errcode = 'P0002'; end if;
  if c.lead_id is null and coalesce(c.ficha ->> 'nome', '') <> ''
     and (coalesce(c.ficha ->> 'cnpj', '') <> '' or jsonb_array_length(coalesce(c.ficha -> 'servicos', '[]'::jsonb)) > 0) then
    select l.aba, l.id into v_aba, v_id from public.leads l
     where public.wa_chave_tel(l.phone_number) = public.wa_chave_tel(c.telefone) and l.apagado_em is null
     order by l.criado_em_lead desc nulls last limit 1;
    if v_id is null then
      v_id := 'wa:' || c.primeiro_wamid;
      perform public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', v_id, 'criado_em_lead', now(),
               'full_name', c.ficha ->> 'nome', 'cnpj', c.ficha ->> 'cnpj', 'phone_number', c.telefone)), false, 'whatsapp');
      select l.aba into v_aba from public.leads l where l.id = v_id;
    end if;
    update public.wa_conversas set lead_aba = v_aba, lead_id = v_id where id = p_conversa;
  end if;
  return jsonb_build_object('lead_aba', coalesce(v_aba, c.lead_aba), 'lead_id', coalesce(v_id, c.lead_id));
end $function$;

-- Registra a mensagem enviada pelo agente. Se o eco da Meta chegou antes, a linha vira do agente.
create or replace function public.wa_registrar_envio(p_conversa uuid, p_wamid text, p_texto text, p_formato text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.wa_mensagens (wamid, conversa_id, autor, formato, texto, em)
  values (p_wamid, p_conversa, 'agente', coalesce(p_formato, 'texto'), p_texto, now())
  on conflict (wamid) do update set autor = 'agente', formato = excluded.formato, texto = excluded.texto;
  update public.wa_conversas set ultimo_agente_em = now(), respostas_noite = respostas_noite + 1, atualizada_em = now(),
         falhou_em = case when coalesce(p_formato, 'texto') = 'texto' then null else falhou_em end
   where id = p_conversa;
end $function$;

-- Aviso na faixa da Equipe (mesma chave de config do §146).
create or replace function public.wa_aviso(p_chave text, p_valor jsonb)
 returns void language sql security definer set search_path to 'public'
as $function$ select public.leads_dist_aviso(p_chave, p_valor) $function$;

-- Tick de 1 min: zera os contadores no expediente, avisa se a conexão caiu (48 h sem nada) e lista quem está sem resposta.
create or replace function public.wa_tick()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_exp boolean := public.leads_dist_no_expediente(now());
  cfg jsonb := coalesce((select valor::jsonb from public.config where chave = 'wa_agente'), '{}'::jsonb);
  v_modo text := coalesce(cfg ->> 'modo', 'desligado'); v_pend jsonb := '[]'::jsonb; v_sem boolean;
  v_av jsonb := coalesce((select valor::jsonb from public.config where chave = 'leads_distribuicao_aviso'), '{}'::jsonb);
begin
  if v_exp then
    update public.wa_conversas set respostas_noite = 0, avisou_falha = false where respostas_noite > 0 or avisou_falha;
  end if;
  -- coexistência cai se o app do celular ficar ~14 dias sem abrir: 48 h sem mensagem nenhuma (cliente ou consultor) é sinal
  v_sem := v_modo <> 'desligado' and exists (select 1 from public.wa_mensagens)
           and not exists (select 1 from public.wa_mensagens where recebida_em > now() - interval '48 hours' and autor <> 'agente');
  if v_sem and not (v_av ? 'wa_sem_mensagens') then perform public.leads_dist_aviso('wa_sem_mensagens', jsonb_build_object('em', now()));
  elsif not v_sem and (v_av ? 'wa_sem_mensagens') then perform public.leads_dist_aviso('wa_sem_mensagens', null);
  end if;
  if not v_exp and v_modo <> 'desligado' then
    select coalesce(jsonb_agg(x.id), '[]'::jsonb) into v_pend from (
      select c.id from public.wa_conversas c
       where c.ultimo_cliente_em > now() - interval '3 days'
         and (c.silencio_ate is null or c.silencio_ate < now())
         and (c.trava_ate is null or c.trava_ate < now())
         and (c.falhou_em is null or c.falhou_em < now() - interval '10 minutes')
         and (v_modo = 'ligado' or public.wa_chave_tel(c.telefone) in
               (select public.wa_chave_tel(n) from jsonb_array_elements_text(coalesce(cfg -> 'numeros_ensaio', '[]'::jsonb)) n))
         and (select m.autor from public.wa_mensagens m where m.conversa_id = c.id and m.formato <> 'aviso' order by m.id desc limit 1) = 'cliente'
         and (select max(m.recebida_em) from public.wa_mensagens m where m.conversa_id = c.id) < now() - interval '20 seconds'
       order by c.ultimo_cliente_em limit 5) x;
  end if;
  return jsonb_build_object('no_expediente', v_exp, 'modo', v_modo, 'pendentes', v_pend);
end $function$;

create or replace function public.wa_cron_confere(p_token text)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(p_token <> '' and (select decrypted_secret from vault.decrypted_secrets where name = 'wa_agente_cron_secret') = p_token, false)
$function$;

-- Guarda de 90 dias (LGPD): a função apaga os arquivos do bucket pela lista e depois as linhas.
create or replace function public.wa_limpar_lista()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(caminho), '[]'::jsonb) from public.wa_mensagens where caminho is not null and recebida_em < now() - interval '90 days'
$function$;
create or replace function public.wa_limpar()
 returns int language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  delete from public.wa_mensagens where recebida_em < now() - interval '90 days';
  get diagnostics n = row_count;
  delete from public.wa_conversas c where c.atualizada_em < now() - interval '90 days'
     and not exists (select 1 from public.wa_mensagens m where m.conversa_id = c.id);
  return n;
end $function$;

-- Painel: selo do cartão (dono, gestor ou lead livre para a equipe).
create or replace function public.wa_selos()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('aba', c.lead_aba, 'lead_id', c.lead_id, 'estado', c.estado)), '[]'::jsonb)
    from (select distinct on (lead_aba, lead_id) * from public.wa_conversas
           where lead_id is not null and atualizada_em > now() - interval '3 days'
           order by lead_aba, lead_id, criada_em desc) c
    join public.leads l on l.aba = c.lead_aba and l.id = c.lead_id
   where c.estado in ('em_andamento', 'pronto', 'precisa_humano') and l.apagado_em is null
     and (coalesce(public.get_my_role(), '') in ('admin', 'supervisor') or l.dono_id = auth.uid()
          or (l.dono_id is null and exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid())))
$function$;

-- Painel: bloco "Ficha do WhatsApp". Só dono do lead ou gestor (tem CPF e documentos).
create or replace function public.wa_ficha(p_aba text, p_id text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare l public.leads%rowtype; c public.wa_conversas%rowtype;
begin
  select * into l from public.leads where aba = p_aba and id = p_id;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') and l.dono_id is distinct from auth.uid() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select * into c from public.wa_conversas where lead_aba = p_aba and lead_id = p_id order by criada_em desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('estado', c.estado, 'ficha', c.ficha - 'documentos', 'alertas', c.alertas, 'motivo', c.motivo_humano,
    'atualizada_em', c.atualizada_em,
    'documentos', coalesce((select jsonb_agg(jsonb_build_object('tipo', d ->> 'tipo', 'caminho', m.caminho, 'mime', m.mime) order by m.id)
                              from jsonb_array_elements(coalesce(c.ficha -> 'documentos', '[]'::jsonb)) d
                              join public.wa_mensagens m on m.wamid = d ->> 'mensagem_id' and m.conversa_id = c.id
                             where m.caminho is not null), '[]'::jsonb));
end $function$;

-- Regra do bucket: link temporário do documento só para o dono do lead ou gestor.
create or replace function public.wa_pode_ver_documento(p_caminho text)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from public.wa_mensagens m
                   join public.wa_conversas c on c.id = m.conversa_id
                   join public.leads l on l.aba = c.lead_aba and l.id = c.lead_id
                  where m.caminho = p_caminho
                    and (coalesce(public.get_my_role(), '') in ('admin', 'supervisor') or l.dono_id = auth.uid()))
$function$;

do $do$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'wa_documentos_ler') then
    create policy wa_documentos_ler on storage.objects for select to authenticated
      using (bucket_id = 'wa-documentos' and public.wa_pode_ver_documento(name));
  end if;
end $do$;

-- leads_entrada2: igual à de produção (lida em 25/11, = 20261109120300) + origem 'whatsapp'. Só a lista de origens muda.
create or replace function public.leads_entrada2(p_leads jsonb, p_espelho boolean, p_origem text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r jsonb; v_ins int := 0; v_vis int := 0; n int; v_aba text; v_ts timestamptz;
begin
  if coalesce(p_origem, '') not in ('planilha', 'meta', 'whatsapp') then
    raise exception 'origem inválida: %', p_origem using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_leads, '[]'::jsonb)) loop
    continue when coalesce(r ->> 'id', '') = '';
    if exists (select 1 from public.leads l where l.id = r ->> 'id') then
      -- §137: a Meta também viu um lead que já entrou (pela planilha ou por rodada anterior)
      if p_origem = 'meta' then
        update public.leads set meta_visto_em = now() where id = r ->> 'id' and meta_visto_em is null;
        get diagnostics n = row_count;
        v_vis := v_vis + n;
      end if;
      continue;
    end if;
    v_ts := nullif(r ->> 'criado_em_lead', '')::timestamptz;
    v_aba := public.leads_mes_aba(v_ts);
    -- planilha (cron de 10 s) e webhook da agência podem trazer o mesmo lead ao mesmo tempo
    insert into public.leads (aba, id, criado_em_lead, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
                              form_id, form_name, is_organic, platform, tipo_empresa, qtd_linhas, cnpj, email, full_name,
                              city, state, phone_number, lead_status, categoria, converteu, receita, atualizado_em, primeira_sync_em,
                              origem_entrada, meta_visto_em)
    values (v_aba, r ->> 'id', v_ts, r ->> 'ad_id', r ->> 'ad_name', r ->> 'adset_id', r ->> 'adset_name',
            r ->> 'campaign_id', r ->> 'campaign_name', r ->> 'form_id', r ->> 'form_name',
            coalesce((r ->> 'is_organic')::boolean, false), r ->> 'platform', r ->> 'tipo_empresa', r ->> 'qtd_linhas',
            r ->> 'cnpj', r ->> 'email', r ->> 'full_name', r ->> 'city', r ->> 'state', r ->> 'phone_number',
            r ->> 'lead_status', 'sem_contato', false, 0, now(), now(),
            p_origem, case when p_origem = 'meta' then now() end)
    on conflict (aba, id) do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      if p_espelho then perform public.leads_espelho_enfileirar(v_aba, r ->> 'id'); end if;
      v_ins := v_ins + 1;
      -- §146: distribuição automática (manual = sai na hora). Erro vira aviso; o lead fica nos Livres.
      begin
        perform public.leads_distribuir(v_aba, r ->> 'id');
      exception when others then
        -- o erro desfaz a linha da fila criada pelo motor: recria para o tick tentar de novo. Nada aqui pode derrubar a entrada.
        begin
          if coalesce(public.leads_dist_cfg() ->> 'modo', 'manual') <> 'manual' then
            insert into public.leads_distribuicao (lead_aba, lead_id) values (v_aba, r ->> 'id')
            on conflict (lead_aba, lead_id) where fechado_em is null do nothing;
          end if;
        exception when others then null;
        end;
        begin
          perform public.leads_dist_aviso('motor_erro', jsonb_build_object('em', now(), 'erro', sqlerrm));
        exception when others then null;
        end;
      end;
    end if;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', 0, 'vistos', v_vis);
end $function$;

revoke execute on function public.wa_chave_tel(text), public.wa_proximo_expediente(timestamptz), public.wa_quando_texto(timestamptz, timestamptz),
  public.wa_no_expediente(), public.wa_receber(jsonb), public.wa_contexto(uuid), public.wa_travar(uuid), public.wa_liberar(uuid),
  public.wa_adiar(uuid), public.wa_avisou_falha(uuid), public.wa_ultima_do_cliente(uuid), public.wa_salvar(uuid, jsonb, jsonb, text, text),
  public.wa_registrar_envio(uuid, text, text, text), public.wa_aviso(text, jsonb), public.wa_tick(), public.wa_cron_confere(text),
  public.wa_limpar_lista(), public.wa_limpar() from public, anon, authenticated;
grant execute on function public.wa_no_expediente(), public.wa_receber(jsonb), public.wa_contexto(uuid), public.wa_travar(uuid),
  public.wa_liberar(uuid), public.wa_adiar(uuid), public.wa_avisou_falha(uuid), public.wa_ultima_do_cliente(uuid),
  public.wa_salvar(uuid, jsonb, jsonb, text, text), public.wa_registrar_envio(uuid, text, text, text), public.wa_aviso(text, jsonb),
  public.wa_tick(), public.wa_cron_confere(text), public.wa_limpar_lista(), public.wa_limpar() to service_role;
revoke execute on function public.wa_selos(), public.wa_ficha(text, text), public.wa_pode_ver_documento(text) from public, anon;
grant execute on function public.wa_selos(), public.wa_ficha(text, text), public.wa_pode_ver_documento(text) to authenticated;
