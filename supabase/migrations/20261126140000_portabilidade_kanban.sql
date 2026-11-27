-- Kanban de Portabilidade: controle do SMS da Anatel (confirmação do "SIM" pelo cliente que vem de outra operadora).
-- Um card por cliente (CNPJ) + consultor, com as linhas (pedidos VOZ - Portabilidade) e os números. Colunas manuais de controle:
-- Aguardando SMS, SMS reenviado, Cliente sem resposta, Confirmou (aguardando portar); "Portado" é automático (todas as linhas concluídas).
-- Acesso só por RPC (SECURITY DEFINER): consultor vê só os clientes dos seus usuários Neo (consultor_neo); admin/supervisor veem todos.
-- Os telefones vêm de producao_neo_raw (admin-only), por isso a leitura passa pela RPC. Sem DROP.
begin;

create table if not exists public.portabilidade_controle (
  cnpj text not null,
  usuario_id bigint not null,
  etapa text not null default 'aguardando_sms'
    check (etapa in ('aguardando_sms', 'sms_reenviado', 'sem_resposta', 'confirmou')),
  reenvios integer not null default 0 check (reenvios between 0 and 99),
  proximo_retorno date,
  observacao text check (observacao is null or length(observacao) <= 1000),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  primary key (cnpj, usuario_id)
);

create table if not exists public.portabilidade_historico (
  id bigint generated always as identity primary key,
  cnpj text not null,
  usuario_id bigint not null,
  user_id uuid not null default auth.uid(),
  tipo text not null check (tipo in ('etapa', 'reenvio', 'retorno', 'observacao')),
  de text,
  para text,
  texto text check (texto is null or length(texto) <= 1000),
  criado_em timestamptz not null default now()
);
create index if not exists portabilidade_historico_cli_idx on public.portabilidade_historico (cnpj, usuario_id, criado_em desc);

alter table public.portabilidade_controle enable row level security;
alter table public.portabilidade_historico enable row level security;
-- sem policies: nenhum acesso direto; tudo pelas funções abaixo.

create or replace function public.portab_gestor()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'supervisor')) $$;

create or replace function public.portab_pode(p_usuario bigint)
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select auth.uid() is not null and (public.portab_gestor()
        or exists (select 1 from public.consultor_neo c where c.profile_id = auth.uid() and c.neo_usuario_id = p_usuario)) $$;

-- Quadro: todas as portabilidades cadastradas no mês (p_mes = 1º dia; padrão = mês atual de São Paulo).
create or replace function public.portabilidade_quadro(p_mes date default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_ini date := coalesce(date_trunc('month', p_mes)::date, date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date);
        v_res jsonb;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  with l as (
    select p.item_id, p.numero_pedido, p.cnpj, p.cliente, p.usuario_id, p.usuario, p.etapa, p.cadastro, p.data_portabilidade,
           nullif(btrim(coalesce(r.raw->>'ddd', '') || ' ' || coalesce(r.raw->>'numeroTelefoneItem', '')), '') as tel_bruto,
           r.raw->>'numeroTelefoneItem' as tel_item, r.raw->>'ddd' as ddd,
           case when p.etapa ilike 'CONCLUIDO%' then 'portada'
                when p.etapa ilike 'VENDA PERDIDA%' or p.etapa ilike 'DEVOLVIDO%' then 'encerrada'
                else 'aberta' end as situacao
      from public.producao_pedidos_neo p
      left join public.producao_neo_raw r on r.item_id = p.item_id
     where p.grupo = 'VOZ - Portabilidade' and p.cadastro >= v_ini and p.cadastro < (v_ini + interval '1 month')
       and p.cnpj is not null and p.usuario_id is not null and public.portab_pode(p.usuario_id::bigint)
  ), g as (
    select l.cnpj, l.usuario_id::bigint usuario_id, max(l.cliente) cliente, max(l.usuario) usuario,
           count(*) total, count(*) filter (where situacao = 'aberta') abertas,
           count(*) filter (where situacao = 'portada') portadas, count(*) filter (where situacao = 'encerrada') encerradas,
           min(l.cadastro) primeiro_cadastro,
           jsonb_agg(jsonb_build_object('item_id', l.item_id, 'pedido', l.numero_pedido, 'etapa', l.etapa, 'situacao', l.situacao,
                     'ddd', l.ddd, 'telefone', l.tel_item, 'cadastro', l.cadastro, 'data_portabilidade', l.data_portabilidade)
                     order by l.cadastro, l.item_id) linhas
      from l group by l.cnpj, l.usuario_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'cnpj', g.cnpj, 'usuario_id', g.usuario_id, 'cliente', g.cliente, 'usuario', g.usuario,
      'total', g.total, 'abertas', g.abertas, 'portadas', g.portadas, 'encerradas', g.encerradas,
      'primeiro_cadastro', g.primeiro_cadastro, 'linhas', g.linhas,
      'etapa', case when g.abertas = 0 and g.portadas > 0 then 'portado'
                    when g.abertas = 0 then 'encerrado'
                    else coalesce(c.etapa, 'aguardando_sms') end,
      'reenvios', coalesce(c.reenvios, 0), 'proximo_retorno', c.proximo_retorno, 'observacao', c.observacao,
      'atualizado_em', c.atualizado_em
    ) order by g.primeiro_cadastro), '[]'::jsonb)
    into v_res
    from g left join public.portabilidade_controle c on c.cnpj = g.cnpj and c.usuario_id = g.usuario_id;
  return v_res;
end $$;

-- Mover de coluna / registrar reenvio / retorno / observação (um único ponto de escrita).
create or replace function public.portabilidade_registrar(
  p_cnpj text, p_usuario bigint, p_etapa text default null, p_reenviou boolean default false,
  p_retorno date default null, p_limpar_retorno boolean default false, p_observacao text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_old public.portabilidade_controle%rowtype; v_new public.portabilidade_controle%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if not public.portab_pode(p_usuario) then raise exception 'sem acesso a este cliente'; end if;
  if p_etapa is not null and p_etapa not in ('aguardando_sms', 'sms_reenviado', 'sem_resposta', 'confirmou') then
    raise exception 'etapa inválida'; end if;
  if not exists (select 1 from public.producao_pedidos_neo p where p.cnpj = p_cnpj and p.usuario_id = p_usuario and p.grupo = 'VOZ - Portabilidade') then
    raise exception 'cliente sem portabilidade'; end if;

  select * into v_old from public.portabilidade_controle where cnpj = p_cnpj and usuario_id = p_usuario;
  if not found then v_old.etapa := 'aguardando_sms'; v_old.reenvios := 0; end if;

  v_new.etapa := coalesce(p_etapa, v_old.etapa);
  v_new.reenvios := v_old.reenvios + case when p_reenviou then 1 else 0 end;
  if p_reenviou and p_etapa is null and v_old.etapa = 'aguardando_sms' then v_new.etapa := 'sms_reenviado'; end if;
  v_new.proximo_retorno := case when p_limpar_retorno then null else coalesce(p_retorno, v_old.proximo_retorno) end;
  v_new.observacao := coalesce(nullif(btrim(p_observacao), ''), v_old.observacao);

  insert into public.portabilidade_controle as c (cnpj, usuario_id, etapa, reenvios, proximo_retorno, observacao, atualizado_em, atualizado_por)
  values (p_cnpj, p_usuario, v_new.etapa, v_new.reenvios, v_new.proximo_retorno, v_new.observacao, now(), auth.uid())
  on conflict (cnpj, usuario_id) do update
    set etapa = excluded.etapa, reenvios = excluded.reenvios, proximo_retorno = excluded.proximo_retorno,
        observacao = excluded.observacao, atualizado_em = now(), atualizado_por = auth.uid();

  if v_new.etapa is distinct from v_old.etapa then
    insert into public.portabilidade_historico (cnpj, usuario_id, tipo, de, para) values (p_cnpj, p_usuario, 'etapa', v_old.etapa, v_new.etapa);
  end if;
  if p_reenviou then
    insert into public.portabilidade_historico (cnpj, usuario_id, tipo, texto) values (p_cnpj, p_usuario, 'reenvio', 'SMS reenviado (' || v_new.reenvios || 'º)');
  end if;
  if v_new.proximo_retorno is distinct from v_old.proximo_retorno then
    insert into public.portabilidade_historico (cnpj, usuario_id, tipo, texto)
    values (p_cnpj, p_usuario, 'retorno', coalesce(to_char(v_new.proximo_retorno, 'DD/MM/YYYY'), 'removido'));
  end if;
  if v_new.observacao is distinct from v_old.observacao then
    insert into public.portabilidade_historico (cnpj, usuario_id, tipo, texto) values (p_cnpj, p_usuario, 'observacao', v_new.observacao);
  end if;

  return jsonb_build_object('etapa', v_new.etapa, 'reenvios', v_new.reenvios, 'proximo_retorno', v_new.proximo_retorno, 'observacao', v_new.observacao);
end $$;

create or replace function public.portabilidade_historico_cliente(p_cnpj text, p_usuario bigint)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public.portab_pode(p_usuario) then raise exception 'sem acesso a este cliente'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tipo', h.tipo, 'de', h.de, 'para', h.para, 'texto', h.texto,
                    'criado_em', h.criado_em, 'quem', coalesce(pr.nome, '—')) order by h.criado_em desc)
                    from public.portabilidade_historico h left join public.profiles pr on pr.id = h.user_id
                   where h.cnpj = p_cnpj and h.usuario_id = p_usuario), '[]'::jsonb);
end $$;

revoke all on function public.portab_gestor(), public.portab_pode(bigint), public.portabilidade_quadro(date),
  public.portabilidade_registrar(text, bigint, text, boolean, date, boolean, text), public.portabilidade_historico_cliente(text, bigint) from public, anon;
grant execute on function public.portabilidade_quadro(date), public.portabilidade_registrar(text, bigint, text, boolean, date, boolean, text),
  public.portabilidade_historico_cliente(text, bigint) to authenticated;
-- portab_gestor/portab_pode ficam só para uso interno das funções (SECURITY DEFINER); authenticated precisa executá-las dentro delas:
grant execute on function public.portab_gestor(), public.portab_pode(bigint) to authenticated;

commit;
