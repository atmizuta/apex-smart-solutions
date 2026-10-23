-- Seção 110 (23/10/2026, pedido do Rafael): a Base de Mailing mostra a contagem COMPLETA, não a estimativa por amostra.
-- Contar a base inteira levou 126 s em 23/10 (3 GB lidos do disco; o count distinct em texto gravou 1,6 GB de temporário)
-- e passa dos 120 s da conexão. A mailing-api põe o pedido nesta fila; o pg_cron chama mailing.contar_proxima() a cada
-- 10 s, e ela conta UM pedido por vez (duas leituras de 3 GB juntas pesariam no CRM). O painel acompanha até o fim.
-- Rollback: supabase/rollback/20261023200000_mailing_contagem_exata_rollback.sql
create table mailing.contagem (
  id bigint generated always as identity primary key,
  chave text not null,            -- md5 do filtro canônico (mesmo filtro = mesma contagem)
  filtros jsonb not null,
  where_sql text not null,        -- montado pela mailing-api só com texto fixo; os valores ficam em params ($1 no job)
  params jsonb not null,
  user_id uuid not null,
  username text,
  estado text not null default 'fila' check (estado in ('fila', 'pronta', 'erro', 'cancelada')),
  criado_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),   -- o painel renova enquanto acompanha; aba fechada sai da fila
  iniciado_em timestamptz,
  terminado_em timestamptz,
  linhas bigint,
  empresas bigint,
  telefones bigint,
  por_operadora jsonb,
  erro text
);
create index contagem_chave on mailing.contagem (chave, id desc);
create index contagem_fila on mailing.contagem (id) where estado = 'fila';
alter table mailing.contagem enable row level security;
revoke all on mailing.contagem from public, anon, authenticated;
revoke all on all sequences in schema mailing from public, anon, authenticated;

-- Conta o pedido mais antigo da fila. Tudo numa transação: enquanto conta, segura pg_advisory_xact_lock(110, id), que é
-- como a mailing-api sabe que está "contando" (e acha o pid para o Parar). Parar e o limite de 20 min do job chegam
-- como query_canceled e viram "cancelada"; outro erro vira "erro" com o código.
-- Telefone e CNPJ contados como número (bigint) e work_mem de 64 MB: em texto, o count distinct gravou 1,6 GB de temporário
-- e levou 126 s; assim, 38 s e ~650 MB (filtro padrão, 23/10).
create or replace function mailing.contar_proxima() returns text
language plpgsql
as $$
declare
  c mailing.contagem%rowtype;
  r record;
  ocupado bigint;
begin
  if not pg_try_advisory_xact_lock(110, 0) then return 'ocupado'; end if;
  update mailing.contagem set estado = 'cancelada', terminado_em = now(), erro = 'abandonada'
   where estado = 'fila' and (visto_em < now() - interval '1 minute' or criado_em < now() - interval '30 minutes');
  select * into c from mailing.contagem where estado = 'fila' order by id limit 1 for update skip locked;
  if not found then return 'vazia'; end if;
  -- o temporário da contagem (~650 MB medidos em 23/10) vai para o mesmo disco: perto de 95% o banco entra em
  -- somente-leitura e trava o CRM. 6,8 GB + 0,65 GB fica abaixo de 95% de um disco de 8 GB.
  ocupado := pg_database_size(current_database()) + coalesce((select sum(size) from pg_ls_waldir()), 0);
  if ocupado > 6963::bigint * 1024 * 1024 then
    update mailing.contagem set estado = 'erro', terminado_em = now(), erro = 'disco' where id = c.id;
    return 'disco';
  end if;
  perform pg_advisory_xact_lock(110, c.id::int);
  perform set_config('work_mem', '64MB', true);
  begin
    execute 'select count(*) as linhas, count(distinct l.cnpj::bigint) as empresas, count(distinct l.fone::bigint) as telefones,
        count(*) filter (where l.operadora = ''VIVO'') as vivo, count(*) filter (where l.operadora = ''CLARO'') as claro,
        count(*) filter (where l.operadora = ''TIM'') as tim, count(*) filter (where l.operadora = ''OUTRAS'') as outras,
        count(*) filter (where l.operadora is null) as sem
      from mailing.linha l where ' || c.where_sql
      into r using c.params;
  exception
    when query_canceled then
      update mailing.contagem set estado = 'cancelada', terminado_em = clock_timestamp(),
        erro = case when clock_timestamp() - now() > interval '19 minutes' then 'tempo' else 'parada' end
       where id = c.id;
      return 'cancelada';
    when others then
      update mailing.contagem set estado = 'erro', terminado_em = clock_timestamp(), erro = sqlstate where id = c.id;
      return 'erro';
  end;
  update mailing.contagem set estado = 'pronta', iniciado_em = now(), terminado_em = clock_timestamp(),
    linhas = r.linhas, empresas = r.empresas, telefones = r.telefones,
    por_operadora = (select coalesce(jsonb_agg(jsonb_build_object('operadora', o.op, 'linhas', o.n) order by o.n desc), '[]'::jsonb)
                       from (values ('VIVO', r.vivo), ('CLARO', r.claro), ('TIM', r.tim), ('OUTRAS', r.outras), ('SEM', r.sem)) o(op, n)
                      where o.n > 0)
   where id = c.id;
  return 'pronta';
end;
$$;
revoke all on function mailing.contar_proxima() from public, anon, authenticated;

-- A cada 10 s; o "set" vale só para a sessão do job (o padrão do banco corta em 120 s).
select cron.schedule('mailing-contagem', '10 seconds',
  $$set statement_timeout = '20min'; select mailing.contar_proxima();$$);
-- Limpeza diária (04:10 SP): o job de 10 s grava ~8.600 linhas por dia em cron.job_run_details.
select cron.schedule('mailing-contagem-limpeza', '10 7 * * *', $$
  delete from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'mailing-contagem')
     and end_time < now() - interval '1 day';
  delete from mailing.contagem where criado_em < now() - interval '30 days';
$$);
