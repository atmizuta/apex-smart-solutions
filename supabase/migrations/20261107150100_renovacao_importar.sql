-- §143.1 (07/11, Rafael): importação da carteira de renovação (só admin), pelo painel.
-- Junta por CNPJ: novo entra (com o atendimento da planilha, se vier); existente só tem os dados da Claro atualizados
-- e volta para a base; atendimento, consultor e origem nunca são sobrescritos. Quem sumiu do arquivo: renovacao_marcar_fora.
-- Sem DROP. Aplicar com execute_sql (begin/commit) depois da 150000. Conferência: supabase/tests/renovacao_check.sql.
begin;

create or replace function public.renovacao_importar(p_linhas jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_novos int; v_atual int;
begin
  if coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'só administrador importa a base' using errcode = '42501';
  end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then
    raise exception 'lista inválida' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_linhas) e where coalesce(e->>'cnpj_digits', '') !~ '^[0-9]{14}$') then
    raise exception 'CNPJ inválido na lista' using errcode = '22023';
  end if;
  -- CNPJ repetido no mesmo lote: vale a primeira ocorrência (ordinality deixa o distinct on determinístico)
  with entrada as (
    select distinct on (x.cnpj_digits) x.*
      from (select r.*, e.n
              from jsonb_array_elements(p_linhas) with ordinality as e(j, n)
             cross join lateral jsonb_to_record(e.j) as r(
               cnpj_digits text, razao_social text, telefone text, nome_adm text, linhas_voz int, apto text, cidade text, ddd text,
               tempo_contrato_voz int, classificacao text, desconto_claro text, origem text, dados_claro jsonb, consultor_id uuid,
               status smallint, data_contato date, prox_retorno date, canal text, linhas_renovadas int, bl_vendida int,
               sol_digitais numeric, motivo_perda text, observacoes text)) x
     order by x.cnpj_digits, x.n
  ), upd as (
    update public.renovacao_carteira c set
      razao_social = e.razao_social, telefone = e.telefone, nome_adm = e.nome_adm, linhas_voz = e.linhas_voz,
      apto = e.apto, cidade = e.cidade, ddd = e.ddd, tempo_contrato_voz = e.tempo_contrato_voz,
      classificacao = e.classificacao, desconto_claro = e.desconto_claro,
      dados_claro = coalesce(e.dados_claro, '{}'::jsonb), na_base = true, importado_em = now()
      from entrada e
     where c.cnpj_digits = e.cnpj_digits
    returning 1
  ), ins as (
    insert into public.renovacao_carteira (cnpj_digits, razao_social, telefone, nome_adm, linhas_voz, apto, cidade, ddd,
      tempo_contrato_voz, classificacao, desconto_claro, dados_claro, origem, consultor_id, status, data_contato, prox_retorno,
      canal, linhas_renovadas, bl_vendida, sol_digitais, motivo_perda, observacoes, a_completar)
    select e.cnpj_digits, e.razao_social, e.telefone, e.nome_adm, e.linhas_voz, e.apto, e.cidade, e.ddd,
           e.tempo_contrato_voz, e.classificacao, e.desconto_claro, coalesce(e.dados_claro, '{}'::jsonb), e.origem, e.consultor_id,
           coalesce(e.status, 1), e.data_contato, e.prox_retorno, nullif(e.canal, ''), e.linhas_renovadas, e.bl_vendida,
           e.sol_digitais, nullif(e.motivo_perda, ''), e.observacoes,
           (coalesce(e.status, 1) = 7 and nullif(e.motivo_perda, '') is null)
             or (coalesce(e.status, 1) = 6 and coalesce(e.linhas_renovadas, 0) < 1)
      from entrada e
     where not exists (select 1 from public.renovacao_carteira c where c.cnpj_digits = e.cnpj_digits)
    returning 1
  )
  select (select count(*) from ins), (select count(*) from upd) into v_novos, v_atual;
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atual);
end $function$;
revoke all on function public.renovacao_importar(jsonb) from public, anon;
grant execute on function public.renovacao_importar(jsonb) to authenticated;

create or replace function public.renovacao_marcar_fora(p_cnpjs text[])
 returns int language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  if coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'só administrador importa a base' using errcode = '42501';
  end if;
  if coalesce(array_length(p_cnpjs, 1), 0) = 0 then
    raise exception 'lista vazia: ninguém foi marcado fora da base' using errcode = '22023';
  end if;
  update public.renovacao_carteira set na_base = false where na_base and not (cnpj_digits = any(p_cnpjs));
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.renovacao_marcar_fora(text[]) from public, anon;
grant execute on function public.renovacao_marcar_fora(text[]) to authenticated;

commit;
