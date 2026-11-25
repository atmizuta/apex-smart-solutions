-- §165 (25/11, Anderson): CRM de acompanhamento dentro da aba Renovação — funil 0–9, campos de acompanhamento,
-- prioridade P1–P5 e carteira consolidada de 25/11 (Bruno e Fabiana).
-- Status antigo → novo: 1→0, 2→1, 3→2, 4→4, 5→5, 6→6, 7→8 (3 "Qualificado" e 7 "Ganho (ativado)" e 9 "Desqualificado" nascem vazios).
-- Sem DROP de tabela/coluna. Aplicar com execute_sql (begin/commit) junto com a publicação do painel.
-- Conferência: supabase/tests/renovacao_crm_check.sql (desfaz tudo).
begin;

alter table public.renovacao_carteira
  add column if not exists oportunidade text,
  add column if not exists movimentacao text,
  add column if not exists fatura numeric(12,2),
  add column if not exists fixa_viavel boolean not null default false,
  add column if not exists tem_fixa boolean not null default false,
  add column if not exists prioridade text,
  add column if not exists hist_origem text,
  add column if not exists consultor_anterior text,
  add column if not exists tentativas int check (tentativas is null or tentativas >= 0),
  add column if not exists primeiro_contato date,
  add column if not exists prox_acao text,
  add column if not exists falou_decisor text check (falou_decisor is null or falou_decisor in ('Sim', 'Não')),
  add column if not exists produto_ofertado text,
  add column if not exists linhas_propostas int check (linhas_propostas is null or linhas_propostas >= 0),
  add column if not exists valor_proposta numeric(12,2) check (valor_proposta is null or valor_proposta >= 0),
  add column if not exists concorrente text,
  add column if not exists numero_pedido text,
  add column if not exists data_fechamento date;

-- Prioridade (REGRAS §165): P1 apto+fixa viável+fatura≥300; P2 apto+(fixa viável OU fatura≥300); P3 demais aptos;
-- P4 não apto com fixa viável e sem fixa hoje; P5 sem oportunidade. Apto = APTO, 1 MÊS ou 2 MESES PARA APTO.
create or replace function public.renovacao_prioridade(p_apto text, p_fixa_viavel boolean, p_fatura numeric, p_tem_fixa boolean)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case
    when p_apto in ('APTO', '1 MÊS PARA APTO', '2 MESES PARA APTO') then
      case when p_fixa_viavel and coalesce(p_fatura, 0) >= 300 then 'P1'
           when p_fixa_viavel or coalesce(p_fatura, 0) >= 300 then 'P2'
           else 'P3' end
    when p_fixa_viavel and not p_tem_fixa then 'P4'
    else 'P5' end
$function$;

-- Conversão dos status. Triggers de usuário desligados: não grava histórico, não mexe em proposta nem em atualizado_em.
alter table public.renovacao_carteira disable trigger user;
alter table public.renovacao_carteira drop constraint if exists renovacao_carteira_status_check;
update public.renovacao_carteira set status = case status when 1 then 0 when 2 then 1 when 3 then 2 when 7 then 8 else status end
 where status in (1, 2, 3, 7);
update public.renovacao_historico set
  de   = case de   when '1' then '0' when '2' then '1' when '3' then '2' when '7' then '8' else de end,
  para = case para when '1' then '0' when '2' then '1' when '3' then '2' when '7' then '8' else para end
 where campo = 'status';
alter table public.renovacao_carteira add constraint renovacao_carteira_status_check check (status between 0 and 9);
alter table public.renovacao_carteira alter column status set default 0;
update public.renovacao_carteira set prioridade = public.renovacao_prioridade(apto, fixa_viavel, fatura, tem_fixa) where prioridade is null;
alter table public.renovacao_carteira enable trigger user;

create index if not exists renovacao_carteira_prioridade_idx on public.renovacao_carteira (prioridade) where na_base;

-- Propostas ligadas: 5 negociação; 6 e 7 ganho; 8 e 9 perdido; demais (inclui 4) proposta enviada.
create or replace function public.renovacao_estagio(p_status int)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case when p_status = 5 then 'negociacao' when p_status in (6, 7) then 'fechado_ganho'
              when p_status in (8, 9) then 'fechado_perdido' else 'proposta_enviada' end
$function$;

-- Regras do atendimento. Perdido (8) exige motivo; Ganho (6/7) exige linhas; ao sair do 0 grava 1º/último contato;
-- ao fechar (6–9) grava a data de fechamento. Consultor só mexe no atendimento (campos novos de Claro/carteira são do admin).
create or replace function public.renovacao_carteira_validar()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_mudou boolean := false; v_falha text;
        v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and v_role not in ('admin', 'supervisor') and (
         new.consultor_id is distinct from old.consultor_id or new.cnpj_digits is distinct from old.cnpj_digits
      or new.dados_claro is distinct from old.dados_claro or new.na_base is distinct from old.na_base
      or new.razao_social is distinct from old.razao_social or new.telefone is distinct from old.telefone
      or new.nome_adm is distinct from old.nome_adm or new.linhas_voz is distinct from old.linhas_voz
      or new.apto is distinct from old.apto or new.cidade is distinct from old.cidade or new.ddd is distinct from old.ddd
      or new.tempo_contrato_voz is distinct from old.tempo_contrato_voz or new.classificacao is distinct from old.classificacao
      or new.desconto_claro is distinct from old.desconto_claro or new.origem is distinct from old.origem
      or new.importado_em is distinct from old.importado_em
      or new.oportunidade is distinct from old.oportunidade or new.movimentacao is distinct from old.movimentacao
      or new.fatura is distinct from old.fatura or new.fixa_viavel is distinct from old.fixa_viavel
      or new.tem_fixa is distinct from old.tem_fixa or new.hist_origem is distinct from old.hist_origem
      or new.consultor_anterior is distinct from old.consultor_anterior) then
      raise exception 'consultor só altera o atendimento' using errcode = '42501';
    end if;
    new.a_completar := old.a_completar;
    v_mudou := new.status is distinct from old.status;
    new.status_desde := case when v_mudou then now() else old.status_desde end;
    if v_mudou and new.status >= 1 and new.data_contato is null then new.data_contato := v_hoje; end if;
    if v_mudou and new.status >= 6 and new.data_fechamento is null then new.data_fechamento := v_hoje; end if;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
  end if;
  if new.data_contato is not null and new.primeiro_contato is null then new.primeiro_contato := new.data_contato; end if;
  new.prioridade := public.renovacao_prioridade(new.apto, new.fixa_viavel, new.fatura, new.tem_fixa);
  new.observacoes := nullif(trim(coalesce(new.observacoes, '')), '');
  v_falha := case
    when new.status = 8 and new.motivo_perda is null then 'Perdido precisa do motivo'
    when new.status in (6, 7) and coalesce(new.linhas_renovadas, 0) < 1 then 'Ganho precisa das linhas fechadas'
  end;
  if v_falha is null then
    new.a_completar := false;
  elsif not (new.a_completar and not v_mudou) then
    raise exception '%', v_falha using errcode = '23514';
  end if;
  return new;
end $function$;

-- Resumo por consultor (view existente; colunas antigas mantêm o nome, com a nova numeração; novas no fim).
-- Ativos = 0–5. contatados = etapas 1–8. cobertura = contatados / carteira. Sem contato há mais de 7 dias = em andamento (1–5) com último contato ≤ hoje−8.
create or replace view public.renovacao_resumo with (security_invoker = true) as
select c.consultor_id, p.nome as consultor_nome,
       count(*)::int                                                    as carteira,
       count(*) filter (where c.status between 1 and 8)::int            as contatados,
       count(*) filter (where c.status between 2 and 7
                           or (c.status = 8 and c.falou_decisor = 'Sim'))::int as efetivo_mais,
       count(*) filter (where c.status between 4 and 7
                           or (c.status = 8 and coalesce(c.valor_proposta, 0) > 0))::int as propostas_mais,
       count(*) filter (where c.status in (6, 7))::int                  as renovados,
       count(*) filter (where c.status = 8)::int                        as perdidos,
       coalesce(sum(c.linhas_renovadas) filter (where c.status in (6, 7)), 0)::int as linhas_renovadas,
       coalesce(sum(c.bl_vendida), 0)::int                              as bl_vendida,
       coalesce(sum(c.sol_digitais), 0)::numeric(12,2)                  as sol_digitais,
       count(*) filter (where c.prox_retorno < (now() at time zone 'America/Sao_Paulo')::date and c.status between 0 and 5)::int as retornos_atrasados,
       count(*) filter (where c.a_completar)::int                       as a_completar,
       count(*) filter (where c.status = 9)::int                        as desqualificados,
       count(*) filter (where c.status = 6)::int                        as ganho_pedido,
       count(*) filter (where c.status = 7)::int                        as ganho_ativado,
       coalesce(sum(c.valor_proposta) filter (where c.status in (6, 7)), 0)::numeric(12,2) as valor_ganho,
       count(*) filter (where c.status between 1 and 5
                           and c.data_contato <= (now() at time zone 'America/Sao_Paulo')::date - 8)::int as sem_contato_7d,
       count(*) filter (where c.prioridade in ('P1', 'P2'))::int        as prioritarios,
       count(*) filter (where c.prioridade in ('P1', 'P2') and c.status = 0)::int as prioritarios_sem_toque
  from public.renovacao_carteira c
  left join public.profiles p on p.id = c.consultor_id
 where c.na_base
 group by c.consultor_id, p.nome;
grant select on public.renovacao_resumo to authenticated;

-- Importação (só admin). Junta por CNPJ.
--  • Novo: entra completo (consultor, atendimento da planilha se vier).
--  • Existente: dados da Claro, consultor, movimentação, origem, prioridade sempre atualizam. O atendimento do PAINEL PREVALECE:
--    a planilha só preenche se o cliente ainda está em 0, sem contato e sem tentativas. Observações: só se estiver vazia.
--  • "SAIU da base" entra com na_base = false (mantém o histórico, sai da carteira ativa).
create or replace function public.renovacao_importar(p_linhas jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_novos int; v_atual int; v_saiu int;
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
  with entrada as (
    select distinct on (x.cnpj_digits) x.*,
           (coalesce(x.movimentacao, '') like 'SAIU%') as saiu,
           (coalesce(x.status, 0) in (0, 1, 2, 3, 4, 5, 9)
            or (x.status = 8 and nullif(x.motivo_perda, '') is not null)
            or (x.status in (6, 7) and coalesce(x.linhas_renovadas, 0) >= 1)) as status_ok
      from (select r.*, e.n
              from jsonb_array_elements(p_linhas) with ordinality as e(j, n)
             cross join lateral jsonb_to_record(e.j) as r(
               cnpj_digits text, razao_social text, telefone text, nome_adm text, linhas_voz int, apto text, cidade text, ddd text,
               tempo_contrato_voz int, classificacao text, desconto_claro text, origem text, dados_claro jsonb, consultor_id uuid,
               status smallint, data_contato date, prox_retorno date, canal text, linhas_renovadas int, bl_vendida int,
               sol_digitais numeric, motivo_perda text, observacoes text,
               oportunidade text, movimentacao text, fatura numeric, fixa_viavel boolean, tem_fixa boolean, hist_origem text,
               consultor_anterior text, tentativas int, primeiro_contato date, prox_acao text, falou_decisor text,
               produto_ofertado text, linhas_propostas int, valor_proposta numeric, concorrente text, numero_pedido text,
               data_fechamento date)) x
     order by x.cnpj_digits, x.n
  ), upd as (
    update public.renovacao_carteira c set
      razao_social = e.razao_social, telefone = e.telefone, nome_adm = e.nome_adm, linhas_voz = e.linhas_voz,
      apto = e.apto, cidade = e.cidade, ddd = e.ddd, tempo_contrato_voz = e.tempo_contrato_voz,
      classificacao = e.classificacao, desconto_claro = e.desconto_claro,
      dados_claro = coalesce(e.dados_claro, '{}'::jsonb), na_base = not e.saiu, importado_em = now(),
      consultor_id = coalesce(e.consultor_id, c.consultor_id),
      oportunidade = coalesce(e.oportunidade, c.oportunidade), movimentacao = coalesce(e.movimentacao, c.movimentacao),
      fatura = coalesce(e.fatura, c.fatura),
      fixa_viavel = coalesce(e.fixa_viavel, c.fixa_viavel), tem_fixa = coalesce(e.tem_fixa, c.tem_fixa),
      hist_origem = coalesce(e.hist_origem, c.hist_origem), consultor_anterior = coalesce(e.consultor_anterior, c.consultor_anterior),
      observacoes = coalesce(c.observacoes, e.observacoes),
      status = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then coalesce(e.status, 0) else c.status end,
      data_contato = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then e.data_contato else c.data_contato end,
      primeiro_contato = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then e.primeiro_contato else c.primeiro_contato end,
      tentativas = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then e.tentativas else c.tentativas end,
      prox_acao = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then e.prox_acao else c.prox_acao end,
      prox_retorno = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then e.prox_retorno else c.prox_retorno end,
      falou_decisor = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then nullif(e.falou_decisor, '') else c.falou_decisor end,
      produto_ofertado = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then nullif(e.produto_ofertado, '') else c.produto_ofertado end,
      linhas_propostas = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then e.linhas_propostas else c.linhas_propostas end,
      valor_proposta = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then e.valor_proposta else c.valor_proposta end,
      concorrente = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then nullif(e.concorrente, '') else c.concorrente end,
      motivo_perda = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then nullif(e.motivo_perda, '') else c.motivo_perda end,
      numero_pedido = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then nullif(e.numero_pedido, '') else c.numero_pedido end,
      data_fechamento = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then e.data_fechamento else c.data_fechamento end,
      linhas_renovadas = case when c.status = 0 and c.data_contato is null and c.tentativas is null and e.status_ok then e.linhas_renovadas else c.linhas_renovadas end
      from entrada e
     where c.cnpj_digits = e.cnpj_digits
    returning 1
  ), ins as (
    insert into public.renovacao_carteira (cnpj_digits, razao_social, telefone, nome_adm, linhas_voz, apto, cidade, ddd,
      tempo_contrato_voz, classificacao, desconto_claro, dados_claro, origem, consultor_id, status, data_contato, prox_retorno,
      canal, linhas_renovadas, bl_vendida, sol_digitais, motivo_perda, observacoes, a_completar, na_base,
      oportunidade, movimentacao, fatura, fixa_viavel, tem_fixa, hist_origem, consultor_anterior, tentativas, primeiro_contato,
      prox_acao, falou_decisor, produto_ofertado, linhas_propostas, valor_proposta, concorrente, numero_pedido, data_fechamento)
    select e.cnpj_digits, e.razao_social, e.telefone, e.nome_adm, e.linhas_voz, e.apto, e.cidade, e.ddd,
           e.tempo_contrato_voz, e.classificacao, e.desconto_claro, coalesce(e.dados_claro, '{}'::jsonb), e.origem, e.consultor_id,
           coalesce(e.status, 0), e.data_contato, e.prox_retorno, nullif(e.canal, ''), e.linhas_renovadas, e.bl_vendida,
           e.sol_digitais, nullif(e.motivo_perda, ''), e.observacoes,
           (coalesce(e.status, 0) = 8 and nullif(e.motivo_perda, '') is null)
             or (coalesce(e.status, 0) in (6, 7) and coalesce(e.linhas_renovadas, 0) < 1),
           not e.saiu,
           e.oportunidade, e.movimentacao, e.fatura, coalesce(e.fixa_viavel, false), coalesce(e.tem_fixa, false), e.hist_origem,
           e.consultor_anterior, e.tentativas, e.primeiro_contato, e.prox_acao, nullif(e.falou_decisor, ''),
           nullif(e.produto_ofertado, ''), e.linhas_propostas, e.valor_proposta, nullif(e.concorrente, ''),
           nullif(e.numero_pedido, ''), e.data_fechamento
      from entrada e
     where not exists (select 1 from public.renovacao_carteira c where c.cnpj_digits = e.cnpj_digits)
    returning 1
  )
  select (select count(*) from ins), (select count(*) from upd), (select count(*) from entrada where saiu) into v_novos, v_atual, v_saiu;
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atual, 'sairam', v_saiu);
end $function$;
revoke all on function public.renovacao_importar(jsonb) from public, anon;
grant execute on function public.renovacao_importar(jsonb) to authenticated;

revoke all on function public.renovacao_carteira_validar() from public, anon, authenticated;
revoke all on function public.renovacao_prioridade(text, boolean, numeric, boolean) from public, anon;

commit;
