-- Desfaz 20261008100000_boletim_manha.sql (§76). Apaga os boletins guardados.
select cron.unschedule('boletim-retencao') where exists (select 1 from cron.job where jobname = 'boletim-retencao');

drop function if exists public.boletim_pedidos();
drop function if exists public.boletim_resolver_acoes(jsonb);
drop function if exists public.boletim_marcar_acao(bigint, text, text);
drop function if exists public.boletim_gravar(date, date, date, jsonb, jsonb);
drop function if exists public.boletim_obter(date, date);
drop table if exists public.boletim_acoes;
drop table if exists public.boletim_retratos;
drop function if exists public.boletim_dia_util(date);

delete from public.config where chave = 'boletim';
update public.config
   set valor = '{"seg_sex":["08:00","18:00"],"sabado":["08:00","12:00"],"verde_min":5,"amarelo_min":15,"janela_dias":7}', atualizado_em = now()
 where chave = 'velocidade_lead';

-- producao_meus_pedidos e mesa_pendencias voltam a ter a expressão escrita dentro delas
create or replace function public.producao_meus_pedidos(p_consultor uuid default null::uuid)
 returns table(numero_pedido text, grupo text, usuario text, etapa text, cadastro timestamp with time zone, atualizacao timestamp with time zone, valor numeric, quantidade numeric, produto text, cliente text, cnpj text, tag text, data_portabilidade timestamp with time zone, data_instalacao timestamp with time zone, na_etapa_desde timestamp with time zone)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_neo bigint := public.producao_dono_neo(p_consultor);
begin
  if v_neo is null then return; end if;
  return query
    select n.numero_pedido, n.grupo, n.usuario, n.etapa, n.cadastro, n.atualizacao, n.valor, n.quantidade,
           n.produto, n.cliente, n.cnpj, n.tag, n.data_portabilidade, n.data_instalacao,
           coalesce((select max(h.em) from public.producao_etapa_historico h
                      where h.numero_pedido = n.numero_pedido and h.etapa_nova = n.etapa), n.atualizacao)
      from public.producao_pedidos_neo n
     where n.usuario_id = v_neo
       and ( n.etapa not in ('VENDA PERDIDA (NEOCRM)','CONCLUIDO (NEOCRM)','DEVOLVIDO (NEOCRM)')
             or coalesce(n.atualizacao, n.cadastro) >= now() - interval '120 days' )
     order by n.numero_pedido, n.item_id;
end $function$;

create or replace function public.mesa_pendencias(p_ref date)
 returns table(profile_id uuid, nome text, tipo text, ref text, titulo text, desde timestamp with time zone, extra jsonb)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_ref_ts timestamptz := (p_ref::timestamp at time zone 'America/Sao_Paulo');
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  select p.id, p.nome, 'consultor'::text, null::text, null::text, null::timestamptz, null::jsonb
    from public.profiles p where p.role = 'consultor'
  union all
  select f.consultor_id, p.nome, 'retorno_atrasado'::text, f.lead_id, coalesce(ld.full_name, '(lead sem nome)'),
         (f.data_prevista::timestamp at time zone 'America/Sao_Paulo'), jsonb_build_object('tipo', f.tipo)
    from public.leads_followups f
    join public.profiles p on p.id = f.consultor_id
    left join lateral (select x.full_name from public.leads x where x.id = f.lead_id order by x.criado_em_lead desc limit 1) ld on true
   where not f.feito and f.data_prevista < p_ref
  union all
  select e.profile_id, p.nome, 'lead_esfriando'::text, l.aba || '|' || l.id, coalesce(l.full_name, '(lead sem nome)'),
         t.ultimo, jsonb_build_object('aba', l.aba, 'status', l.status)
    from public.leads l
    join public.leads_equipe e on e.profile_id is not null and public.norm_nome(e.nome_planilha) = public.norm_nome(l.consultor)
    join public.profiles p on p.id = e.profile_id
    cross join lateral (select greatest(l.criado_em_lead,
             (select max(c.em) from public.leads_contatos c where c.lead_aba = l.aba and c.lead_id = l.id),
             (select max(m.gerada_em) from public.ligacoes_manuais m
               where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number))) as ultimo) t
   where coalesce(l.aba, '') <> 'REPIQUE' and l.categoria in ('andamento', 'sem_contato')
     and t.ultimo < v_ref_ts - interval '5 days'
  union all
  select pr.consultor_id, p.nome, 'proposta_parada'::text, pr.id::text, coalesce(pr.cliente_nome, '(sem nome)'),
         pr.estagio_entrada_em, jsonb_build_object('estagio', pr.estagio, 'valor', pr.valor_proposto)
    from public.propostas pr join public.profiles p on p.id = pr.consultor_id
   where pr.estagio in ('proposta_enviada', 'negociacao') and pr.estagio_entrada_em < v_ref_ts - interval '7 days'
  union all
  select cn.profile_id, p.nome, 'pedido_risco'::text, x.numero_pedido, coalesce(x.cliente, '(sem cliente)'),
         coalesce((select max(h.em) from public.producao_etapa_historico h
                    where h.numero_pedido = x.numero_pedido and h.etapa_nova = x.etapa), x.atualizacao),
         jsonb_build_object('etapa', x.etapa, 'valor', x.valor)
    from (select n.numero_pedido, n.usuario_id, n.etapa, max(n.cliente) as cliente, max(n.atualizacao) as atualizacao, sum(n.valor) as valor
            from public.producao_pedidos_neo n
           where n.numero_pedido is not null
             and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'CONCLUIDO (NEOCRM)', 'DEVOLVIDO (NEOCRM)')
           group by n.numero_pedido, n.usuario_id, n.etapa) x
    join public.consultor_neo cn on cn.neo_usuario_id = x.usuario_id
    join public.profiles p on p.id = cn.profile_id;
end $function$;

drop function if exists public.producao_na_etapa_desde(text, text, timestamptz);
