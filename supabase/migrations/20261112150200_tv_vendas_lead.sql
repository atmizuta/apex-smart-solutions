-- §149 TV Vendas — parte 3: lead classificado como PEDIDO CONCLUIDO (VENDA) vira venda na TV.
-- Gatilho em leads: entrou em 'convertido' por uma classificação → cria; saiu de 'convertido' ou foi apagado → cancela;
-- continua 'convertido' → acompanha receita e CNPJ (§147). A receita que vale é a do lead (§140); os itens (plano ×
-- linhas) chegam depois pela venda_itens_lead (o Classificar chama logo depois da leads_classificar, que não muda).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/tv_vendas_lead_check.sql.
begin;

create or replace function public.vendas_marcadas_do_lead()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_cons uuid := coalesce(new.dono_id, new.classificado_por);
        v_dig text := regexp_replace(coalesce(new.cnpj, ''), '[^0-9]', '', 'g');
        v_cnpj text;
begin
  v_cnpj := case when public.leads_cnpj_valido(v_dig) then v_dig end;
  if new.apagado_em is not null and old.apagado_em is null then
    update public.vendas_marcadas set cancelada_em = now(), cancelada_por = auth.uid(), motivo_cancel = 'lead apagado'
     where lead_aba = new.aba and lead_id = new.id and cancelada_em is null;
    return null;
  end if;
  if new.categoria = 'convertido' and old.categoria is distinct from 'convertido' then
    if new.classificado_em is distinct from old.classificado_em and v_cons is not null and new.apagado_em is null then
      insert into public.vendas_marcadas (consultor_id, operacao, origem, cnpj, receita, lead_aba, lead_id, marcada_por)
      select v_cons, coalesce(p.operacao, 'apex'), 'lead', v_cnpj, greatest(coalesce(new.receita, 0), 0), new.aba, new.id, new.classificado_por
        from public.profiles p where p.id = v_cons
      on conflict (lead_aba, lead_id) where cancelada_em is null and lead_id is not null do nothing;
    end if;
  elsif old.categoria = 'convertido' and new.categoria is distinct from 'convertido' then
    update public.vendas_marcadas set cancelada_em = now(), cancelada_por = new.classificado_por, motivo_cancel = 'lead mudou de status'
     where lead_aba = new.aba and lead_id = new.id and cancelada_em is null;
  elsif new.categoria = 'convertido' then
    update public.vendas_marcadas
       set receita = greatest(coalesce(new.receita, 0), 0), cnpj = coalesce(v_cnpj, cnpj)
     where lead_aba = new.aba and lead_id = new.id and cancelada_em is null
       and (receita is distinct from greatest(coalesce(new.receita, 0), 0) or cnpj is distinct from coalesce(v_cnpj, cnpj));
  end if;
  return null;
end $function$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'vendas_marcadas_lead' and tgrelid = 'public.leads'::regclass) then
    create trigger vendas_marcadas_lead
      after update of categoria, receita, cnpj, classificado_em, apagado_em on public.leads
      for each row execute function public.vendas_marcadas_do_lead();
  end if;
end $$;

create or replace function public.venda_itens_lead(p_aba text, p_id text, p_itens jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_dono uuid; v_n record;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select l.dono_id into v_dono from public.leads l where l.aba = p_aba and l.id = p_id;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') and v_dono is distinct from auth.uid() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select * into v_n from public.vendas_itens_normalizar(p_itens);
  update public.vendas_marcadas set itens = v_n.itens, linhas = v_n.linhas
   where lead_aba = p_aba and lead_id = p_id and cancelada_em is null;
end $function$;

revoke all on function public.vendas_marcadas_do_lead() from public, anon, authenticated;
revoke all on function public.venda_itens_lead(text, text, jsonb) from public, anon;
grant execute on function public.venda_itens_lead(text, text, jsonb) to authenticated;

commit;
