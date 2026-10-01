-- 01/10/2026 — "Meus leads para tratar" (Pedidos Parados) para todo consultor que tem lead. REGRAS_NEGOCIO.md seção 60.
-- Antes (seção 59) só aparecia para quem estava em leads_equipe com profile_id = login (e ninguém conseguia ser
-- ligado: o editor da equipe dava erro de id). Agora o consultor é reconhecido por:
--   1) leads_equipe.profile_id = auth.uid()  (tem prioridade); ou
--   2) primeiro nome do perfil = nome na coluna CONSULTOR da planilha (norm_nome), SÓ se esse primeiro nome for
--      único entre os perfis e nenhuma OUTRA pessoa da equipe tiver esse nome ligado a outro login.
--      Ex.: dois perfis "Gabriel" -> nenhum casa por nome; o Gabriel dos leads vem pela equipe.
-- A aba REPIQUE fica de fora (pedido do usuário). Aditiva: só troca a função e cria duas novas.

-- Nomes da planilha (norm_nome) que pertencem ao login atual.
create or replace function public.meus_leads_nomes()
returns setof text
language sql stable security definer set search_path = public as $$
  select public.norm_nome(e.nome_planilha)
    from public.leads_equipe e
   where e.profile_id = auth.uid()
  union
  select x.primeiro
    from (select public.norm_nome(split_part(btrim(p.nome), ' ', 1)) as primeiro
            from public.profiles p where p.id = auth.uid()) x
   where x.primeiro <> ''
     and (select count(*) from public.profiles p2
           where public.norm_nome(split_part(btrim(p2.nome), ' ', 1)) = x.primeiro) = 1
     and not exists (select 1 from public.leads_equipe e2
                      where public.norm_nome(e2.nome_planilha) = x.primeiro
                        and e2.profile_id is not null and e2.profile_id <> auth.uid());
$$;

-- O consultor logado tem pelo menos um lead (qualquer categoria) fora do Repique? Decide se a seção aparece.
create or replace function public.meus_leads_vinculado()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
     where public.norm_nome(l.consultor) in (select public.meus_leads_nomes())
       and coalesce(l.aba, '') <> 'REPIQUE');
$$;

-- Leads em aberto do consultor logado, com tentativas. Mesma assinatura da seção 59; não expõe ligações de ninguém.
create or replace function public.meus_leads_para_tratar()
returns table (aba text, lead_id text, nome text, telefone text, status text, categoria text,
               criado_em_lead timestamptz, tentativas int, atendidas int, ultima_ligacao timestamptz)
language sql stable security definer set search_path = public as $$
  select l.aba, l.id, l.full_name, l.phone_number, l.status, l.categoria, l.criado_em_lead,
         coalesce(c.t, 0)::int, coalesce(c.a, 0)::int, c.u
    from public.leads l
    left join lateral (
      select count(*) as t, count(*) filter (where m.atendida) as a, max(m.gerada_em) as u
        from public.ligacoes_manuais m
       where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number)
    ) c on true
   where public.norm_nome(l.consultor) in (select public.meus_leads_nomes())
     and coalesce(l.aba, '') <> 'REPIQUE'
     and l.categoria in ('andamento', 'sem_contato')
   order by l.criado_em_lead;
$$;

revoke all on function public.meus_leads_nomes(), public.meus_leads_vinculado(), public.meus_leads_para_tratar() from public, anon;
grant execute on function public.meus_leads_vinculado(), public.meus_leads_para_tratar() to authenticated;
-- meus_leads_nomes() é interna: só as duas funções acima (security definer) a chamam. O Supabase dá EXECUTE a
-- authenticated por padrão em função nova, então revoga também.
revoke execute on function public.meus_leads_nomes() from authenticated;
