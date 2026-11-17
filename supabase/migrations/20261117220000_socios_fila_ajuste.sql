-- §157.1 (17/11/2026, ok do Rafael): ajuste da fila da consulta de sócios (revisão final da §157).
-- 1) consulta presa ('consultando' há mais de 10 min = robô morreu) volta para a fila; na 3ª tentativa vira erro;
-- 2) "Tentar de novo" numa consulta presa não gasta limite (consequência do item 1 nas duas RPCs de pedido);
-- 3) o gatilho de entrega usa a mesma trava por CNPJ das RPCs (fecha a corrida conclusão × pedido novo);
-- 4) socios_robo_pegar com trava própria (duas rodadas nunca pegam o mesmo pedido).
-- As RPCs socios_pedir (§156) e socios_pedir_cnpj (§157) têm só o trecho do abandono trocado; falha se não achar.
begin;

alter table public.socios_consultas add column if not exists tentativas int not null default 0;

create or replace function public.socios_liberar_presos(p_cnpj text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.socios_consultas
     set status = case when tentativas >= 3 then 'erro' else 'pendente' end,
         erro = case when tentativas >= 3 then 'A Nova Vida não respondeu para este CNPJ.' else erro end,
         concluido_em = case when tentativas >= 3 then now() else null end,
         iniciado_em = null
   where status = 'consultando' and iniciado_em < now() - interval '10 minutes'
     and (p_cnpj is null or cnpj_digits = p_cnpj);
end $$;

do $mig$
declare d text;
  a text := $x$  update public.socios_consultas set status = 'erro', erro = 'A consulta não terminou.', concluido_em = now()
   where cnpj_digits = v_cnpj and status = 'consultando' and iniciado_em < now() - interval '10 minutes';$x$;
  b text := '  perform public.socios_liberar_presos(v_cnpj);   -- §157.1: presa volta para a fila (3ª vez vira erro)';
begin
  d := pg_get_functiondef('public.socios_pedir(bigint)'::regprocedure);
  if position(a in d) = 0 then raise exception '§157.1: trecho do abandono não encontrado em socios_pedir'; end if;
  execute replace(d, a, b);
  d := pg_get_functiondef('public.socios_pedir_cnpj(text,boolean)'::regprocedure);
  if position(a in d) = 0 then raise exception '§157.1: trecho do abandono não encontrado em socios_pedir_cnpj'; end if;
  execute replace(d, a, b);
end $mig$;

create or replace function public.socios_robo_pegar(p_max int) returns table(id bigint, cnpj text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_cnpjs text[];
begin
  perform pg_advisory_xact_lock(hashtext('socios:pegar'));       -- §157.1: uma rodada pega por vez
  perform public.socios_liberar_presos(null);                     -- §157.1: presas voltam para a fila
  select array_agg(x.cnpj_digits) into v_cnpjs from (
    select q.cnpj_digits, min(q.pedido_em) as m from public.socios_consultas q
     where q.status = 'pendente'
       and not exists (select 1 from public.socios_consultas c where c.cnpj_digits = q.cnpj_digits and c.status = 'consultando')
     group by q.cnpj_digits order by m limit greatest(1, least(coalesce(p_max, 10), 20))) x;
  if v_cnpjs is null then return; end if;
  update public.socios_consultas s set status = 'consultando', iniciado_em = now(), tentativas = s.tentativas + 1
   where s.status = 'pendente' and s.cnpj_digits = any(v_cnpjs);
  return query select distinct on (s.cnpj_digits) s.id, s.cnpj_digits from public.socios_consultas s
    where s.cnpj_digits = any(v_cnpjs) and s.status = 'consultando' order by s.cnpj_digits, s.pedido_em;
end $$;

create or replace function public.socios_propagar_resultado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform pg_advisory_xact_lock(hashtext('socios:' || new.cnpj_digits));   -- §157.1: mesma trava das RPCs
  update public.socios_consultas o
     set status = new.status, resultado = new.resultado, erro = new.erro, concluido_em = new.concluido_em
   where o.cnpj_digits = new.cnpj_digits and o.id <> new.id and o.status in ('pendente','consultando');
  return null;
end $$;

revoke all on function public.socios_liberar_presos(text) from public, anon, authenticated;

commit;
