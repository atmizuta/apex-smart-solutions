-- §95 (16/10/2026): Mesa → Biometria — mais duas fontes de celular para o pedido que não tem número:
--   (a) DIGITADO: a supervisora/admin digita o celular na própria linha (tabela biometria_telefone, por CNPJ;
--       salvo pela RPC mesa_bio_salvar_telefone). Tem prioridade sobre todas as outras fontes;
--   (b) DISCADOR: o número da chamada do discador automático (discador_chamadas) com o mesmo CNPJ — o último
--       atendido; sem atendida, o último discado. Entra depois de planilha, Caderno e base de clientes.
-- As ligações manuais passam a contar também para o número digitado/do discador (além dos números da planilha).
-- O resto é igual à §94 (20261015250000). Mesmo retorno: create or replace.
begin;

create table if not exists public.biometria_telefone (
  cnpj_digits text primary key check (cnpj_digits ~ '^[0-9]{11,14}$'),
  telefone text not null check (telefone ~ '^[0-9]{10,13}$'),
  atualizado_por uuid references public.profiles(id) on delete set null,
  atualizado_em timestamptz not null default now()
);
comment on table public.biometria_telefone is '§95: celular do cliente digitado na Mesa → Biometria (por CNPJ). Só via RPC mesa_bio_salvar_telefone.';
alter table public.biometria_telefone enable row level security;
revoke all on table public.biometria_telefone from public, anon, authenticated;

-- grava (ou apaga, com telefone vazio) o celular digitado; só admin/supervisor
create or replace function public.mesa_bio_salvar_telefone(p_cnpj text, p_telefone text)
returns void language plpgsql security definer set search_path to 'public' as $s$
declare v_doc text := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
        v_tel text := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if length(v_doc) < 11 then raise exception 'CNPJ inválido' using errcode = '22023'; end if;
  if v_tel = '' then delete from public.biometria_telefone where cnpj_digits = v_doc; return; end if;
  if length(v_tel) not between 10 and 13 then raise exception 'telefone inválido' using errcode = '22023'; end if;
  insert into public.biometria_telefone (cnpj_digits, telefone, atualizado_por, atualizado_em)
  values (v_doc, v_tel, auth.uid(), now())
  on conflict (cnpj_digits) do update set telefone = excluded.telefone, atualizado_por = excluded.atualizado_por, atualizado_em = now();
end $s$;
revoke all on function public.mesa_bio_salvar_telefone(text, text) from public, anon;
grant execute on function public.mesa_bio_salvar_telefone(text, text) to authenticated;

create or replace function public.mesa_biometria()
returns table(consultor text, usuario_neo text, numero_pedido text, cliente text, cnpj text, etapa text,
              desde timestamptz, valor numeric, quantidade numeric, produtos text, telefone text, fonte_tel text,
              lig_etapa integer, lig_consultor integer, lig_total integer, ultima_lig timestamptz, lig_por jsonb, equipe_leads boolean)
language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with neo_pessoa as (
    -- nome do NEO (maiúsculo) → perfil e nome curto
    select distinct on (upper(btrim(n.usuario))) upper(btrim(n.usuario)) as neo, p.id as profile_id, p.nome, p.operacao
      from public.producao_pedidos_neo n
      join public.consultor_neo c on c.neo_usuario_id = n.usuario_id
      join public.profiles p on p.id = c.profile_id
     where coalesce(btrim(n.usuario), '') <> ''
  ), login_neo as (
    select lower(t.k) as login, upper(btrim(t.v)) as neo
      from public.config cf, jsonb_each_text(coalesce((cf.valor::jsonb) -> 'telefonia', '{}'::jsonb)) as t(k, v)
     where cf.chave = 'boletim'
    union
    select lower(e.usuario_telefonia), np.neo
      from public.leads_equipe e join neo_pessoa np on np.profile_id = e.profile_id
     where coalesce(e.usuario_telefonia, '') <> ''
  ), login_nome as (
    select ln.login, max(ln.neo) as neo,
           max(coalesce(e.nome_planilha, initcap(np.nome), initcap(lower(split_part(ln.neo, ' ', 1))))) as quem
      from login_neo ln
      left join neo_pessoa np on np.neo = ln.neo
      left join public.leads_equipe e on e.profile_id = np.profile_id and e.monitorar
     group by ln.login
  ), ped as (
    select n.numero_pedido, n.usuario_id, n.etapa, upper(btrim(max(n.usuario))) as usuario, max(n.cliente) as cliente, max(n.cnpj) as cnpj,
           max(n.atualizacao) as atualizacao, sum(n.valor) as valor, sum(n.quantidade) as quantidade,
           string_agg(distinct n.produto, ' · ') as produtos
      from public.producao_pedidos_neo n
     where n.numero_pedido is not null
       and n.etapa in ('BIOMETRIA (NEOCRM)', 'AGUARDANDO ASSINATURA (NEOCRM)')
     group by n.numero_pedido, n.usuario_id, n.etapa
  ), base as (
    select coalesce(e.nome_planilha, initcap(p.nome), initcap(lower(x.usuario))) as nome_cons, e.nome_planilha, (e.id is not null) as da_equipe,
           x.usuario, x.numero_pedido, x.cliente, x.cnpj, x.etapa,
           public.producao_na_etapa_desde(x.numero_pedido, x.etapa, x.atualizacao) as desde, x.valor, x.quantidade, x.produtos,
           regexp_replace(coalesce(x.cnpj, ''), '[^0-9]', '', 'g') as doc,
           trim(regexp_replace(public.norm_nome(regexp_replace(coalesce(x.cliente, ''), '[0-9./-]', '', 'g')), '\s+', ' ', 'g')) as nome_cli
      from ped x
      left join public.consultor_neo cn on cn.neo_usuario_id = x.usuario_id
      left join public.profiles p on p.id = cn.profile_id
      left join public.leads_equipe e on e.monitorar and e.profile_id = cn.profile_id
     where coalesce(p.operacao, 'apex') = 'apex'
  ), achado as (
    -- leads da planilha que são deste cliente: 1 = CNPJ igual; 2 = mesmo consultor e nome; 3 = mesmo consultor e CNPJ quase igual
    select b.numero_pedido, b.etapa, l.phone_number, l.criado_em_lead, m.passo
      from base b
      join public.leads l on nullif(trim(l.phone_number), '') is not null
      cross join lateral (select regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g') as ldoc) ld
      cross join lateral (select case
          when length(b.doc) >= 11 and ld.ldoc = b.doc then 1
          when b.nome_planilha is not null and public.norm_nome(l.consultor) = public.norm_nome(b.nome_planilha) and length(b.nome_cli) >= 5
               and trim(regexp_replace(public.norm_nome(l.full_name), '\s+', ' ', 'g')) = b.nome_cli then 2
          when b.nome_planilha is not null and public.norm_nome(l.consultor) = public.norm_nome(b.nome_planilha) and length(b.doc) = 14 and length(ld.ldoc) = 14
               and (select count(*) from generate_series(1, 14) i where substr(ld.ldoc, i, 1) <> substr(b.doc, i, 1)) <= 2 then 3
        end as passo) m
     where m.passo is not null
  ), melhor as (
    select distinct on (a.numero_pedido, a.etapa) a.numero_pedido, a.etapa, a.phone_number as tel, a.passo
      from achado a order by a.numero_pedido, a.etapa, a.passo, a.criado_em_lead desc
  ), chaves as (
    select a.numero_pedido, a.etapa, array_agg(distinct public.chave_tel(a.phone_number)) filter (where public.chave_tel(a.phone_number) is not null) as ks
      from achado a where a.passo = (select min(a2.passo) from achado a2 where a2.numero_pedido = a.numero_pedido and a2.etapa = a.etapa)
     group by a.numero_pedido, a.etapa
  ), com_tel as (
    select b.*, coalesce(bt.telefone, mb.tel, tc.tel, tb.tel, ds.tel) as tel,
           case when bt.telefone is not null then 'digitado'
                else case mb.passo when 1 then 'lead' when 2 then 'lead_nome' when 3 then 'lead_cnpj_parecido' end end as fonte_lead,
           tc.tel as tel_caderno, tb.tel as tel_clientes, ds.tel as tel_discador, ch.ks
      from base b
      left join public.biometria_telefone bt on bt.cnpj_digits = b.doc
      left join melhor mb on mb.numero_pedido = b.numero_pedido and mb.etapa = b.etapa
      left join chaves ch on ch.numero_pedido = b.numero_pedido and ch.etapa = b.etapa
      left join lateral (select c.telefone as tel from public.caderno_notas c
                          where mb.tel is null and length(b.doc) >= 11 and regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') = b.doc
                            and nullif(trim(c.telefone), '') is not null
                          order by c.atualizado_em desc limit 1) tc on true
      left join lateral (select coalesce(nullif(trim(k.telefone_contato), ''), nullif(trim(k.tel1), ''), nullif(trim(k.tel2), '')) as tel
                           from public.clientes k
                          where mb.tel is null and tc.tel is null and length(b.doc) >= 11 and regexp_replace(coalesce(k.cnpj, ''), '[^0-9]', '', 'g') = b.doc
                            and coalesce(nullif(trim(k.telefone_contato), ''), nullif(trim(k.tel1), ''), nullif(trim(k.tel2), '')) is not null
                          limit 1) tb on true
      left join lateral (select d.telefone as tel from public.discador_chamadas d
                          where mb.tel is null and tc.tel is null and tb.tel is null and length(b.doc) = 14
                            and d.cnpj = b.doc and nullif(trim(d.telefone), '') is not null
                          order by (d.atendida_em is not null) desc, d.gerada_em desc limit 1) ds on true
  ), lig as (
    -- cada ligação manual para algum número do cliente, com quem ligou e se foi o próprio consultor do pedido
    select t.numero_pedido, t.etapa, m.gerada_em, m.usuario as login,
           coalesce(lnm.quem, m.usuario) as quem, (lnm.neo is not null and lnm.neo = t.usuario) as proprio,
           (t.desde is null or m.gerada_em >= t.desde) as na_etapa
      from com_tel t
      join public.ligacoes_manuais m on t.tel is not null and m.chave_tel is not null
                                    and m.chave_tel = any(coalesce(t.ks, '{}'::text[]) || public.chave_tel(t.tel))
      left join login_nome lnm on lnm.login = lower(m.usuario)
  ), resumo as (
    select l.numero_pedido, l.etapa,
           count(*) filter (where l.na_etapa) as etapa_n,
           count(*) filter (where l.na_etapa and l.proprio) as cons_n,
           count(*) as total_n, max(l.gerada_em) as ultima
      from lig l group by l.numero_pedido, l.etapa
  ), por as (
    select q.numero_pedido, q.etapa,
           jsonb_agg(jsonb_build_object('quem', q.quem, 'login', q.login, 'proprio', q.proprio, 'n', q.n, 'ultima', q.ultima)
                     order by q.proprio desc, q.n desc, q.quem) as lista
      from (select l.numero_pedido, l.etapa, l.quem, l.login, l.proprio, count(*) as n, max(l.gerada_em) as ultima
              from lig l where l.na_etapa group by l.numero_pedido, l.etapa, l.quem, l.login, l.proprio) q
     group by q.numero_pedido, q.etapa
  )
  select t.nome_cons, t.usuario, t.numero_pedido, t.cliente, t.cnpj, t.etapa, t.desde, t.valor, t.quantidade, t.produtos,
         t.tel, coalesce(t.fonte_lead, case when t.tel_caderno is not null then 'caderno' when t.tel_clientes is not null then 'clientes'
                                          when t.tel_discador is not null then 'discador' end),
         coalesce(r.etapa_n, 0)::int, coalesce(r.cons_n, 0)::int, coalesce(r.total_n, 0)::int, r.ultima,
         coalesce(po.lista, '[]'::jsonb), t.da_equipe
    from com_tel t
    left join resumo r on r.numero_pedido = t.numero_pedido and r.etapa = t.etapa
    left join por po on po.numero_pedido = t.numero_pedido and po.etapa = t.etapa
   order by t.nome_cons, t.desde;
end $f$;

revoke all on function public.mesa_biometria() from public, anon;
grant execute on function public.mesa_biometria() to authenticated;

commit;
