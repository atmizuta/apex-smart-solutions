-- §118 Meus leads: Hoje / Quadro / Equipe — parte 1: contato do lead, ficha detalhada e pesquisa.
-- Spec: docs/superpowers/specs/2026-10-27-meus-leads-hoje-equipe-design.md
begin;
alter table public.agenda_retornos add column if not exists lead_aba text, add column if not exists lead_id text;
create index if not exists agenda_retornos_lead_idx on public.agenda_retornos (lead_aba, lead_id) where status = 'pendente';
insert into public.config (chave, valor) values ('leads_alertas', '{"sem_contato_min":15,"parado_dias":3,"esfriando_dias":2}')
on conflict (chave) do nothing;

-- Contato do lead desde 1 h antes de chegar: ligação manual (ProContact, pelo telefone), discador (pelo CNPJ) e cliques
-- de Ligar/WhatsApp no painel. Uso interno (alertas, equipe, hoje, ficha).
create or replace function public.leads_contato_info(p_aba text, p_id text, p_tel text, p_cnpj text, p_criado timestamptz)
returns table(ligacoes int, atendidas int, cliques int, primeiro timestamptz, ultimo timestamptz)
language sql stable security definer set search_path = public as $$
  with m as (
    select count(*)::int n, (count(*) filter (where atendida))::int a, min(gerada_em) p, max(gerada_em) u
      from public.ligacoes_manuais
     where public.chave_tel(p_tel) is not null and chave_tel = public.chave_tel(p_tel)
       and gerada_em >= coalesce(p_criado, now()) - interval '1 hour'
  ), d as (
    select count(*)::int n, (count(*) filter (where status = 'ANSWERED'))::int a, min(gerada_em) p, max(gerada_em) u
      from public.discador_chamadas
     where length(regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g')) = 14
       and cnpj = regexp_replace(p_cnpj, '[^0-9]', '', 'g')
       and gerada_em >= coalesce(p_criado, now()) - interval '1 hour'
  ), c as (
    select count(*)::int n, min(em) p, max(em) u from public.leads_contatos where lead_aba = p_aba and lead_id = p_id
  )
  select m.n + d.n, m.a + d.a, c.n, least(m.p, d.p, c.p), greatest(m.u, d.u, c.u) from m, d, c;
$$;
revoke all on function public.leads_contato_info(text, text, text, text, timestamptz) from public, anon, authenticated;

-- Ficha detalhada: detalhes do anúncio, resumo de contato e linha do tempo (mesma permissão da leads_ficha).
create or replace function public.leads_ficha_detalhes(p_aba text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor');
        l public.leads%rowtype; v_livre boolean; i record; v_anuncio jsonb; v_ev jsonb;
begin
  select * into l from public.leads where aba = p_aba and id = p_id;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  v_livre := l.dono_id is null and l.categoria = 'sem_contato';
  if not v_gestor then
    if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
    if not v_livre and l.dono_id is distinct from auth.uid() then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
  end if;
  v_anuncio := jsonb_build_object('campanha', l.campaign_name, 'conjunto', l.adset_name, 'anuncio', l.ad_name,
                                  'formulario', l.form_name, 'plataforma', l.platform, 'organico', l.is_organic);
  if v_livre and not v_gestor then
    return jsonb_build_object('anuncio', v_anuncio, 'resumo', null, 'eventos',
      jsonb_build_array(jsonb_build_object('em', l.criado_em_lead, 'tipo', 'chegou', 'titulo', 'Lead chegou', 'detalhe', l.campaign_name, 'quem', null)));
  end if;
  select * into i from public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.em desc), '[]'::jsonb) into v_ev from (
    select l.criado_em_lead as em, 'chegou'::text as tipo, 'Lead chegou'::text as titulo, l.campaign_name as detalhe, null::text as quem
    union all
    select h.em, h.acao,
           case h.acao when 'pegar' then 'Pegou o lead' when 'classificar' then 'Classificou: ' || coalesce(h.depois ->> 'status', '')
                       when 'redistribuir' then 'Passou para ' || coalesce(h.depois ->> 'consultor', '') else 'Devolveu aos Livres' end,
           case when h.acao = 'classificar' then nullif(h.depois ->> 'obs', '') end, p.nome
      from public.leads_historico h left join public.profiles p on p.id = h.por
     where h.lead_aba = l.aba and h.lead_id = l.id
    union all
    select c.em, 'clique', case c.canal when 'whatsapp' then 'Abriu o WhatsApp' when 'ligar' then 'Clicou em Ligar' else 'Contato registrado' end, null, p.nome
      from public.leads_contatos c left join public.profiles p on p.id = c.profile_id
     where c.lead_aba = l.aba and c.lead_id = l.id
    union all
    select m.gerada_em, 'ligacao', case when m.atendida then 'Ligação atendida' else 'Ligação não atendida' end,
           nullif(concat_ws(' · ', case when coalesce(m.seg_falados, 0) > 0 then (m.seg_falados / 60) || ' min ' || (m.seg_falados % 60) || ' s' end, nullif(m.tabulacao, '')), ''),
           m.usuario
      from public.ligacoes_manuais m
     where public.chave_tel(l.phone_number) is not null and m.chave_tel = public.chave_tel(l.phone_number)
       and m.gerada_em >= l.criado_em_lead - interval '1 hour'
    union all
    select d.gerada_em, 'discador', case when d.status = 'ANSWERED' then 'Discador: atendida' else 'Discador: ' || lower(coalesce(d.status, '')) end,
           case when coalesce(d.seg_falados, 0) > 0 then (d.seg_falados / 60) || ' min ' || (d.seg_falados % 60) || ' s' end, null
      from public.discador_chamadas d
     where length(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g')) = 14
       and d.cnpj = regexp_replace(l.cnpj, '[^0-9]', '', 'g') and d.gerada_em >= l.criado_em_lead - interval '1 hour'
    union all
    select a.criado_em, 'retorno', case a.status when 'pendente' then 'Retorno agendado' when 'feito' then 'Retorno feito' else 'Retorno cancelado' end,
           to_char(a.quando at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), null
      from public.agenda_retornos a where a.lead_aba = l.aba and a.lead_id = l.id
  ) e where e.em is not null;
  return jsonb_build_object('anuncio', v_anuncio,
    'resumo', jsonb_build_object('ligacoes', i.ligacoes, 'atendidas', i.atendidas, 'cliques', i.cliques, 'ultimo', i.ultimo),
    'eventos', v_ev);
end $$;

-- Pesquisa: dígitos (8+) procuram CNPJ e telefone; texto procura no nome. Consultor: os dele e os Livres (Livre sem número).
create or replace function public.leads_buscar(p_texto text)
returns table(aba text, lead_id text, nome text, cidade text, uf text, status text, categoria text, dono_nome text,
              livre boolean, cnpj text, telefone text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor');
        v_dig text := regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g');
        v_txt text := public.norm_nome(p_texto);
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_texto, ''))) < 3 then return; end if;
  return query
  select l.aba, l.id, l.full_name, l.city, l.state, l.status, l.categoria, p.nome,
         (l.dono_id is null and l.categoria = 'sem_contato'),
         case when l.dono_id is null and l.categoria = 'sem_contato' and not v_gestor then null else l.cnpj end,
         case when l.dono_id is null and l.categoria = 'sem_contato' and not v_gestor then null else l.phone_number end
    from public.leads l left join public.profiles p on p.id = l.dono_id
   where coalesce(l.aba, '') <> 'REPIQUE'
     and (v_gestor or l.dono_id = auth.uid() or (l.dono_id is null and l.categoria = 'sem_contato'))
     and case when length(v_dig) >= 8
              then regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g') like '%' || v_dig || '%'
                or regexp_replace(coalesce(l.phone_number, ''), '[^0-9]', '', 'g') like '%' || v_dig || '%'
              else public.norm_nome(l.full_name) like '%' || v_txt || '%' end
   order by l.criado_em_lead desc nulls last
   limit 20;
end $$;
revoke execute on function public.leads_ficha_detalhes(text, text) from public, anon;
revoke execute on function public.leads_buscar(text) from public, anon;
grant execute on function public.leads_ficha_detalhes(text, text) to authenticated;
grant execute on function public.leads_buscar(text) to authenticated;
commit;
