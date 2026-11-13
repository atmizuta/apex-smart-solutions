-- §149.3 (13/11): META BATIDA! uma vez por dia em CADA tela. Antes era uma vez no total: uma aba da TV aberta na mesa
-- do gestor podia "gastar" a comemoração e a TV da sala ficava sem ela. A tela manda um id (guardado no navegador);
-- tv_meta_tela registra quem já comemorou. A versão sem parâmetro continua (painel antigo aberto).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/tv_meta_por_tela_check.sql.
begin;

create table if not exists public.tv_meta_tela (
  dia            date not null,
  tela           text not null check (tela ~ '^[a-z0-9-]{8,80}$'),
  comemorada_em  timestamptz not null default now(),
  primary key (dia, tela)
);
alter table public.tv_meta_tela enable row level security;
revoke all on table public.tv_meta_tela from public, anon, authenticated;

create or replace function public.tv_meta_comemorar(p_tela text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_hoje date := public.tv_hoje(); v_meta int := public.tv_meta_atual(); v_vendas int; v_ok text; v_pessoas jsonb;
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_tela is null or p_tela !~ '^[a-z0-9-]{8,80}$' then raise exception 'tela inválida' using errcode = '22023'; end if;
  if v_meta is null then return jsonb_build_object('comemorar', false); end if;
  select count(*) into v_vendas from public.vendas_marcadas v where v.operacao = 'apex' and v.cancelada_em is null and v.dia = v_hoje;
  if v_vendas < v_meta then return jsonb_build_object('comemorar', false, 'vendas', v_vendas, 'meta', v_meta); end if;
  insert into public.tv_meta_tela (dia, tela) values (v_hoje, p_tela) on conflict (dia, tela) do nothing returning tela into v_ok;
  -- registro do dia (primeira tela que comemorou), como antes
  insert into public.tv_meta_dia (dia, meta) values (v_hoje, v_meta) on conflict (dia) do nothing;
  update public.tv_meta_dia set comemorada_em = now() where dia = v_hoje and comemorada_em is null;
  if v_ok is null then return jsonb_build_object('comemorar', false, 'vendas', v_vendas, 'meta', v_meta); end if;
  select coalesce(jsonb_agg(jsonb_build_object('nome', x.nome, 'vendas', x.n) order by x.n desc, x.nome), '[]'::jsonb) into v_pessoas
    from (select p.nome, count(*)::int as n from public.vendas_marcadas v join public.profiles p on p.id = v.consultor_id
           where v.operacao = 'apex' and v.cancelada_em is null and v.dia = v_hoje group by p.nome) x;
  return jsonb_build_object('comemorar', true, 'vendas', v_vendas, 'meta', v_meta, 'pessoas', v_pessoas);
end $function$;

revoke all on function public.tv_meta_comemorar(text) from public, anon;
grant execute on function public.tv_meta_comemorar(text) to authenticated;

commit;
