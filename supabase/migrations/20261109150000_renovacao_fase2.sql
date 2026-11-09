-- §143.2 (09/11, Rafael): Renovação Fase 2 — proposta e funil ligados à carteira.
-- O estágio de uma proposta ligada (carteira_id) é SEMPRE calculado do status da carteira: quem muda é a carteira,
-- e a carteira empurra o estágio das propostas abertas (com histórico). Nunca há caminho proposta → carteira.
-- (Spec §6 dizia "recusar"; calcular dá a mesma garantia sem fazer o "gerar de novo" do funil falhar em silêncio.)
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/renovacao_fase2_check.sql (desfaz tudo).
begin;

alter table public.propostas add column if not exists carteira_id bigint references public.renovacao_carteira(id) on delete set null;
create index if not exists propostas_carteira_idx on public.propostas (carteira_id) where carteira_id is not null;

-- Desde quando o cliente está no status atual (Kanban: "dias no status"). Antigos: última mudança no histórico ou a importação.
alter table public.renovacao_carteira add column if not exists status_desde timestamptz;
alter table public.renovacao_carteira disable trigger renovacao_carteira_validar;   -- preencher sem regravar atualizado_em/atualizado_por
update public.renovacao_carteira c set status_desde = coalesce(
  (select max(h.criado_em) from public.renovacao_historico h where h.carteira_id = c.id and h.campo = 'status'), c.importado_em)
 where c.status_desde is null;
alter table public.renovacao_carteira enable trigger renovacao_carteira_validar;
alter table public.renovacao_carteira alter column status_desde set default now();
alter table public.renovacao_carteira alter column status_desde set not null;

-- Mesmas regras da Fase 1 + status_desde (só muda quando o status muda; escrita direta é ignorada).
create or replace function public.renovacao_carteira_validar()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_mudou boolean := false; v_falha text;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and v_role not in ('admin', 'supervisor') and (
         new.consultor_id is distinct from old.consultor_id or new.cnpj_digits is distinct from old.cnpj_digits
      or new.dados_claro is distinct from old.dados_claro or new.na_base is distinct from old.na_base
      or new.razao_social is distinct from old.razao_social or new.telefone is distinct from old.telefone
      or new.nome_adm is distinct from old.nome_adm or new.linhas_voz is distinct from old.linhas_voz
      or new.apto is distinct from old.apto or new.cidade is distinct from old.cidade or new.ddd is distinct from old.ddd
      or new.tempo_contrato_voz is distinct from old.tempo_contrato_voz or new.classificacao is distinct from old.classificacao
      or new.desconto_claro is distinct from old.desconto_claro or new.origem is distinct from old.origem
      or new.importado_em is distinct from old.importado_em) then
      raise exception 'consultor só altera o atendimento' using errcode = '42501';
    end if;
    new.a_completar := old.a_completar;
    v_mudou := new.status is distinct from old.status;
    new.status_desde := case when v_mudou then now() else old.status_desde end;
    if v_mudou and new.status >= 2 and new.data_contato is null then
      new.data_contato := (now() at time zone 'America/Sao_Paulo')::date;
    end if;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
  end if;
  new.observacoes := nullif(trim(coalesce(new.observacoes, '')), '');
  v_falha := case
    when new.status = 7 and new.motivo_perda is null then 'Perdido precisa do motivo'
    when new.status = 6 and coalesce(new.linhas_renovadas, 0) < 1 then 'Renovado precisa das linhas renovadas'
  end;
  if v_falha is null then
    new.a_completar := false;
  elsif not (new.a_completar and not v_mudou) then
    raise exception '%', v_falha using errcode = '23514';
  end if;
  return new;
end $function$;

create or replace function public.renovacao_estagio(p_status int)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case p_status when 5 then 'negociacao' when 6 then 'fechado_ganho' when 7 then 'fechado_perdido' else 'proposta_enviada' end
$function$;

-- Proposta ligada: estágio vem da carteira na criação e sempre que alguém tenta mudá-lo.
-- Ligar uma proposta existente (só carteira_id muda) não mexe no estágio.
create or replace function public.propostas_estagio_da_carteira()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_status smallint;
begin
  if new.carteira_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.estagio is not distinct from old.estagio then return new; end if;
  select status into v_status from public.renovacao_carteira where id = new.carteira_id;
  if v_status is null then return new; end if;
  new.estagio := public.renovacao_estagio(v_status);
  if tg_op = 'UPDATE' and new.estagio = old.estagio then new.estagio_entrada_em := old.estagio_entrada_em; end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'propostas_estagio_da_carteira' and tgrelid = 'public.propostas'::regclass) then
    create trigger propostas_estagio_da_carteira before insert or update on public.propostas
      for each row execute function public.propostas_estagio_da_carteira();
  end if;
end $$;

-- Status mudou na carteira → propostas abertas ligadas vão para o estágio correspondente (perdido copia o motivo).
create or replace function public.renovacao_carteira_sync_propostas()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_estagio text := public.renovacao_estagio(new.status);
begin
  if new.status is not distinct from old.status then return null; end if;
  with alvo as (
    select p.id, p.estagio as antes from public.propostas p
     where p.carteira_id = new.id and p.estagio not in ('fechado_ganho', 'fechado_perdido') and p.estagio <> v_estagio
     for update
  ), mudou as (
    update public.propostas p
       set estagio = v_estagio, estagio_entrada_em = now(), atualizado_em = now(),
           motivo_perda = case when new.status = 7 then new.motivo_perda else p.motivo_perda end
      from alvo where p.id = alvo.id
    returning p.id, alvo.antes
  )
  insert into public.propostas_historico (proposta_id, user_id, estagio_anterior, estagio_novo, nota)
  select m.id, auth.uid(), m.antes, v_estagio, 'Renovação: status ' || old.status || ' → ' || new.status from mudou m;
  return null;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renovacao_carteira_sync_propostas' and tgrelid = 'public.renovacao_carteira'::regclass) then
    create trigger renovacao_carteira_sync_propostas after update of status on public.renovacao_carteira
      for each row execute function public.renovacao_carteira_sync_propostas();
  end if;
end $$;

-- Liga propostas antigas ao cliente da carteira pelo CNPJ (sem mudar estágio). Só SQL: rodar uma vez ao aplicar.
create or replace function public.renovacao_ligar_propostas()
 returns int language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  update public.propostas p set carteira_id = c.id
    from public.renovacao_carteira c
   where p.carteira_id is null
     and length(regexp_replace(coalesce(p.cliente_cnpj, ''), '[^0-9]', '', 'g')) between 13 and 14
     and lpad(regexp_replace(p.cliente_cnpj, '[^0-9]', '', 'g'), 14, '0') = c.cnpj_digits;
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.renovacao_carteira_validar() from public, anon, authenticated;
revoke all on function public.propostas_estagio_da_carteira() from public, anon, authenticated;
revoke all on function public.renovacao_carteira_sync_propostas() from public, anon, authenticated;
revoke all on function public.renovacao_ligar_propostas() from public, anon, authenticated;

select public.renovacao_ligar_propostas();

commit;
