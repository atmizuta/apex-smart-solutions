-- §112 (revisão final): uma rodada da planilha-espelho por vez. Com o cron a cada 10 s, duas rodadas juntas podiam
-- pegar o mesmo item da fila (enfileirar zera a reserva) e acrescentar linha duplicada ou gravar valor velho.
-- travar() devolve um token (o carimbo) ou null se outra rodada está trabalhando; a trava vence sozinha em p_segundos.
-- destravar(token) só solta a trava se ela ainda for desta rodada.
begin;
insert into public.config (chave, valor) values ('leads_espelho_rodada', '') on conflict (chave) do nothing;

create or replace function public.leads_espelho_travar(p_segundos int default 60) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := clock_timestamp()::text; n int;
begin
  update public.config set valor = v_token
   where chave = 'leads_espelho_rodada'
     and (coalesce(valor, '') = '' or valor::timestamptz < clock_timestamp() - make_interval(secs => p_segundos));
  get diagnostics n = row_count;
  return case when n > 0 then v_token end;
end $$;

create or replace function public.leads_espelho_destravar(p_token text) returns void
language sql security definer set search_path = public as $$
  update public.config set valor = '' where chave = 'leads_espelho_rodada' and valor = p_token;
$$;

revoke all on function public.leads_espelho_travar(int) from public, anon, authenticated;
revoke all on function public.leads_espelho_destravar(text) from public, anon, authenticated;
commit;
