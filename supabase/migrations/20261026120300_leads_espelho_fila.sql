-- §112 Fila do espelho: funções usadas só pela Edge Function planilha-espelho (service_role).
begin;
-- Reserva até p_limite itens vencidos (skip locked: duas rodadas nunca pegam o mesmo item — Review Focus 2).
create or replace function public.leads_espelho_pegar(p_limite int)
returns table(lead_aba text, lead_id text, pedido_em timestamptz, tentativas int)
language sql security definer set search_path = public as $$
  update public.leads_espelho e set proxima_em = now() + interval '2 minutes'
   where (e.lead_aba, e.lead_id) in (
     select f.lead_aba, f.lead_id from public.leads_espelho f
      where f.feito_em is null and f.proxima_em <= now()
      order by f.pedido_em limit p_limite for update skip locked)
  returning e.lead_aba, e.lead_id, e.pedido_em, e.tentativas;
$$;

-- Marca feito só se ninguém pediu de novo durante a rodada (pedido_em igual — Review Focus 3).
-- p_itens: [{lead_aba, lead_id, pedido_em, guia}]
create or replace function public.leads_espelho_feito(p_itens jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.leads_espelho e set feito_em = now(), ultimo_erro = null
    from jsonb_array_elements(p_itens) x
   where e.lead_aba = x ->> 'lead_aba' and e.lead_id = x ->> 'lead_id' and e.pedido_em = (x ->> 'pedido_em')::timestamptz;
  get diagnostics n = row_count;
  update public.leads l set aba_planilha = x ->> 'guia'
    from jsonb_array_elements(p_itens) x
   where l.aba = x ->> 'lead_aba' and l.id = x ->> 'lead_id' and coalesce(x ->> 'guia', '') <> ''
     and l.aba_planilha is distinct from x ->> 'guia';
  return n;
end $$;

-- Falha: espera 1, 2, 5, 10 e depois 30 min.
create or replace function public.leads_espelho_falha(p_itens jsonb, p_erro text) returns void
language sql security definer set search_path = public as $$
  update public.leads_espelho e set tentativas = e.tentativas + 1, ultimo_erro = left(p_erro, 300),
         proxima_em = now() + make_interval(mins => (array[1, 2, 5, 10, 30])[least(e.tentativas + 1, 5)])
    from jsonb_array_elements(p_itens) x
   where e.lead_aba = x ->> 'lead_aba' and e.lead_id = x ->> 'lead_id' and e.feito_em is null;
$$;

-- Guia do mês ainda não existe: tenta de novo em 5 min sem contar tentativa.
create or replace function public.leads_espelho_adiar(p_itens jsonb, p_motivo text) returns void
language sql security definer set search_path = public as $$
  update public.leads_espelho e set proxima_em = now() + interval '5 minutes', ultimo_erro = left(p_motivo, 300)
    from jsonb_array_elements(p_itens) x
   where e.lead_aba = x ->> 'lead_aba' and e.lead_id = x ->> 'lead_id' and e.feito_em is null;
$$;

create or replace function public.leads_espelho_atraso() returns numeric
language sql stable security definer set search_path = public as $$
  select round(extract(epoch from now() - min(pedido_em)) / 60) from public.leads_espelho where feito_em is null;
$$;

revoke all on function public.leads_espelho_pegar(int) from public, anon, authenticated;
revoke all on function public.leads_espelho_feito(jsonb) from public, anon, authenticated;
revoke all on function public.leads_espelho_falha(jsonb, text) from public, anon, authenticated;
revoke all on function public.leads_espelho_adiar(jsonb, text) from public, anon, authenticated;
revoke all on function public.leads_espelho_atraso() from public, anon, authenticated;
commit;
