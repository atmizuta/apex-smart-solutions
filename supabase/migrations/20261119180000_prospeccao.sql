-- §161 (19/11/2026, pedido do Rafael): subaba "Prospecção" em Meus leads, só Caio e Lúria (+ admin). Temporária.
-- Spec: docs/superpowers/specs/2026-11-19-prospeccao-caio-luria-design.md (seção 4). Sem remover objetos (o conector recusa). Só estrutura:
begin;
-- os dados (CNPJ, razão, telefone) entram por SQL de carga fora do repo (repo público).

create table if not exists public.prospec_acesso (
  profile_id uuid primary key references public.profiles(id) on delete cascade
);

create table if not exists public.prospec_clientes (
  id bigserial primary key,
  cnpj text not null unique check (cnpj ~ '^[0-9]{14}$'),
  aba_origem text not null check (aba_origem in ('CAIO', 'LURIA')),
  razao_social text, cidade text, uf text, segmento text, porte text, obs_planilha text,
  dados jsonb not null default '{}'::jsonb,
  telefone_planilha text,
  telefone_nv text,
  whatsapp boolean,
  socio_nome text,
  nv_status text not null default 'nao_precisa' check (nv_status in ('nao_precisa', 'pendente', 'ok', 'sem_socios', 'sem_telefone', 'erro')),
  nv_consulta_id bigint references public.socios_consultas(id) on delete set null,
  etapa text not null default 'livre' check (etapa in ('livre', 'contato', 'retornar', 'venda', 'sem_interesse', 'sem_contato')),
  retorno_em timestamptz,
  obs text,
  dono_id uuid references public.profiles(id),
  dono_em timestamptz,
  atualizado_por uuid,
  atualizado_em timestamptz not null default now(),
  constraint prospec_livre_sem_dono check ((etapa = 'livre') = (dono_id is null)),
  constraint prospec_retornar_com_data check (etapa <> 'retornar' or retorno_em is not null)
);

alter table public.prospec_acesso enable row level security;
alter table public.prospec_clientes enable row level security;
revoke all on public.prospec_acesso, public.prospec_clientes from anon, authenticated;
revoke all on sequence public.prospec_clientes_id_seq from anon, authenticated;

-- Caio (leads_equipe.id 1) e Lúria (leads_equipe.id 3): por subselect, sem uuid no repo.
insert into public.prospec_acesso (profile_id)
  select e.profile_id from public.leads_equipe e where e.id in (1, 3) and e.profile_id is not null
  on conflict do nothing;

create or replace function public.prospec_pode() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.get_my_role(), '') = 'admin'
      or exists (select 1 from public.prospec_acesso a where a.profile_id = auth.uid());
$$;

-- Número principal: sócio de maior participação (empate: ordem do array) que tenha telefone;
-- dele, 1º celular com WhatsApp → 1º celular → 1º fixo. Só dígitos, sem 55. Sem telefone: null.
create or replace function public.prospec_escolher_numero(p_resultado jsonb) returns jsonb
language sql immutable set search_path = public as $$
  with s as (
    select e.val as socio, e.ord,
           case when jsonb_typeof(e.val->'participacao') = 'number' then (e.val->>'participacao')::numeric else 0 end as part
      from jsonb_array_elements(coalesce(p_resultado->'socios', '[]'::jsonb)) with ordinality e(val, ord)
  ), t as (
    select s.socio, s.ord, s.part, tel.val as tel, tel.ord as tord,
           regexp_replace(regexp_replace(coalesce(tel.val->>'numero', ''), '\D', '', 'g'), '^55(?=\d{10,11}$)', '') as num
      from s cross join lateral jsonb_array_elements(coalesce(s.socio->'telefones', '[]'::jsonb)) with ordinality tel(val, ord)
  ), validos as (
    select * from t where length(num) in (10, 11)
  ), dono as (
    select ord from validos order by part desc, ord limit 1
  )
  select jsonb_build_object('numero', v.num,
                            'whatsapp', v.tel->>'tipo' = 'celular' and coalesce((v.tel->>'whatsapp')::boolean, false),
                            'socio_nome', v.socio->>'nome')
    from validos v join dono d on d.ord = v.ord
   order by case when v.tel->>'tipo' = 'celular' and coalesce((v.tel->>'whatsapp')::boolean, false) then 0
                 when v.tel->>'tipo' = 'celular' then 1 else 2 end, v.tord
   limit 1;
$$;

create or replace function public.prospec_listar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.prospec_pode() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'cnpj', p.cnpj, 'aba_origem', p.aba_origem, 'razao_social', p.razao_social,
      'cidade', p.cidade, 'uf', p.uf, 'segmento', p.segmento, 'porte', p.porte, 'obs_planilha', p.obs_planilha, 'dados', p.dados,
      'telefone', coalesce(p.telefone_planilha, p.telefone_nv),
      'tel_fonte', case when p.telefone_planilha is not null then 'planilha' when p.telefone_nv is not null then 'nova_vida' end,
      'whatsapp', p.whatsapp, 'socio_nome', p.socio_nome, 'nv_status', p.nv_status,
      'etapa', p.etapa, 'retorno_em', p.retorno_em, 'obs', p.obs,
      'dono_id', p.dono_id, 'dono_nome', pr.nome, 'dono_em', p.dono_em, 'atualizado_em', p.atualizado_em) order by p.id)
      from public.prospec_clientes p left join public.profiles pr on pr.id = p.dono_id), '[]'::jsonb);
end $$;

create or replace function public.prospec_pegar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dono text;
begin
  if not public.prospec_pode() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.prospec_clientes
     set dono_id = auth.uid(), dono_em = now(), etapa = 'contato', atualizado_por = auth.uid(), atualizado_em = now()
   where id = p_id and dono_id is null;
  if found then return jsonb_build_object('ok', true); end if;
  select pr.nome into v_dono from public.prospec_clientes p left join public.profiles pr on pr.id = p.dono_id where p.id = p_id;
  if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', false, 'motivo', 'ja_tem_dono', 'dono', v_dono);
end $$;

create or replace function public.prospec_mover(p_id bigint, p_etapa text, p_retorno_em timestamptz, p_obs text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dono uuid;
begin
  if not public.prospec_pode() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_etapa is null or p_etapa not in ('livre', 'contato', 'retornar', 'venda', 'sem_interesse', 'sem_contato') then
    raise exception 'etapa inválida' using errcode = '22023';
  end if;
  if p_etapa = 'retornar' and p_retorno_em is null then raise exception 'escolha a data e a hora do retorno' using errcode = '22023'; end if;
  select dono_id into v_dono from public.prospec_clientes where id = p_id for update;
  if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  if v_dono is null then raise exception 'pegue o cliente antes de mudar a etapa' using errcode = '22023'; end if;
  if v_dono <> auth.uid() and coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'este cliente é de outro consultor' using errcode = '42501';
  end if;
  update public.prospec_clientes set
    etapa = p_etapa,
    dono_id = case when p_etapa = 'livre' then null else dono_id end,
    dono_em = case when p_etapa = 'livre' then null else dono_em end,
    retorno_em = case when p_etapa = 'retornar' then p_retorno_em end,
    obs = case when p_obs is null then obs else nullif(btrim(p_obs), '') end,
    atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Grava o número escolhido nas linhas 'pendente' cuja consulta terminou. Idempotente (só toca 'pendente').
create or replace function public.prospec_aplicar_nv() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is not null and coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  with c as (
    select p.id, s.status, public.prospec_escolher_numero(s.resultado) as e
      from public.prospec_clientes p join public.socios_consultas s on s.id = p.nv_consulta_id
     where p.nv_status = 'pendente' and s.status in ('pronto', 'sem_socios', 'erro')
  ), u as (
    update public.prospec_clientes p set
      nv_status = case c.status when 'pronto' then case when c.e is null then 'sem_telefone' else 'ok' end
                                when 'sem_socios' then 'sem_socios' else 'erro' end,
      telefone_nv = c.e->>'numero',
      whatsapp = case when c.e is null then null else (c.e->>'whatsapp')::boolean end,
      socio_nome = c.e->>'socio_nome',
      atualizado_em = now()
    from c where p.id = c.id
    returning 1
  )
  select count(*) into v_n from u;
  return jsonb_build_object('aplicados', v_n,
    'resumo', (select jsonb_object_agg(nv_status, n) from (select nv_status, count(*) n from public.prospec_clientes group by 1) x));
end $$;

revoke all on function public.prospec_pode(), public.prospec_listar(), public.prospec_pegar(bigint),
  public.prospec_mover(bigint, text, timestamptz, text) from public, anon;
grant execute on function public.prospec_pode(), public.prospec_listar(), public.prospec_pegar(bigint),
  public.prospec_mover(bigint, text, timestamptz, text) to authenticated;
revoke all on function public.prospec_escolher_numero(jsonb), public.prospec_aplicar_nv() from public, anon, authenticated;
commit;
