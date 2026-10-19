-- 19/10/2026 — Lead × Mailing: de onde vieram as vendas e as vendas perdidas (REGRAS_NEGOCIO.md §99).
-- Usada pelo Boletim da Manhã (página de leads e perdas) e pela Mesa do Supervisor (mesma tabela).
-- Só leitura; admin/supervisor. O painel soma por janela (ontem / 7 dias) e tira quem está fora (bmFora).
--   venda   = pedido do NEO cadastrado no período (dia em SP), sem as etapas iniciais do funil
--             (AGUARDANDO INTERACAO / PROPOSTA) — mesma linha da Visão Diária; valor = soma dos itens dessas linhas.
--   perda   = linha de vendas_perdidas(p_de, p_ate) (data da perda = entrada em VENDA PERDIDA, §70).
--   origem  = 'lead' se o CNPJ está na planilha de leads (qualquer aba, inclusive REPIQUE);
--             senão 'mailing' se o CNPJ teve chamada do discador atendida (ANSWERED com agente) entre o dia do
--             cadastro − janela_venda_dias (config.discador, padrão 30) e o fim do dia do cadastro (regra do §87);
--             senão o pedido não entra (só Lead × Mailing, decisão do Rafael). CNPJ nos dois = lead.
--   leads     = leads que chegaram no dia (todas as abas, inclusive REPIQUE).
--   atendidas = chamadas do discador da operação Apex atendidas por consultor no dia.
-- Retorno: jsonb { pedidos: [{tipo, dia, numero_pedido, usuario, valor, origem}], leads: {dia: n}, atendidas: {dia: n} }.
-- Sem cliente e sem CNPJ na saída.
begin;

create or replace function public.lead_mailing_comparativo(p_de date, p_ate date)
returns jsonb
language plpgsql stable security definer set search_path = public as $f$
declare
  v_ini timestamptz := (p_de::timestamp at time zone 'America/Sao_Paulo');
  v_fim timestamptz := ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_dias int := coalesce((select (c.valor::jsonb ->> 'janela_venda_dias')::int from public.config c where c.chave = 'discador'), 30);
  v_out jsonb;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de >= 31 then
    raise exception 'período inválido' using errcode = '22023';
  end if;

  with vendas as (
    select n.numero_pedido as np, min((n.cadastro at time zone 'America/Sao_Paulo')::date) as dia,
           max(n.usuario) as usu, coalesce(sum(n.valor), 0) as val,
           min(case when length(regexp_replace(n.cnpj, '[^0-9]', '', 'g')) between 11 and 14
                    then lpad(regexp_replace(n.cnpj, '[^0-9]', '', 'g'), 14, '0') end) as cnpj
      from public.producao_pedidos_neo n
     where n.cadastro >= v_ini and n.cadastro < v_fim
       and n.numero_pedido is not null
       and n.etapa not in ('AGUARDANDO INTERACAO (NEOCRM)', 'PROPOSTA (NEOCRM)')
     group by n.numero_pedido
  ), perdas as (
    select v.numero_pedido as np, (v.perdido_em at time zone 'America/Sao_Paulo')::date as dia, v.usuario as usu,
           coalesce(v.valor, 0) as val,
           coalesce((v.cadastro at time zone 'America/Sao_Paulo')::date, (v.perdido_em at time zone 'America/Sao_Paulo')::date) as dia_cad,
           (select min(case when length(regexp_replace(n.cnpj, '[^0-9]', '', 'g')) between 11 and 14
                            then lpad(regexp_replace(n.cnpj, '[^0-9]', '', 'g'), 14, '0') end)
              from public.producao_pedidos_neo n where n.numero_pedido = v.numero_pedido) as cnpj
      from public.vendas_perdidas(p_de, p_ate) v
     where v.perdido_em >= v_ini and v.perdido_em < v_fim
  ), todos as (
    select 'venda'::text as tipo, np, dia, usu, val, dia as dia_cad, cnpj from vendas
    union all
    select 'perda', np, dia, usu, val, dia_cad, cnpj from perdas
  ), lead_cnpj as (
    select distinct lpad(regexp_replace(l.cnpj, '[^0-9]', '', 'g'), 14, '0') as cnpj
      from public.leads l
     where length(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g')) between 11 and 14
  ), classif as (
    select t.*,
           case when t.cnpj is null then null
                when exists (select 1 from lead_cnpj lc where lc.cnpj = t.cnpj) then 'lead'
                when exists (select 1 from public.discador_chamadas d
                              where d.cnpj = t.cnpj and d.status = 'ANSWERED' and d.agente_id is not null
                                and d.gerada_em >= ((t.dia_cad - v_dias)::timestamp at time zone 'America/Sao_Paulo')
                                and d.gerada_em <  ((t.dia_cad + 1)::timestamp at time zone 'America/Sao_Paulo')) then 'mailing'
           end as origem
      from todos t
  )
  select jsonb_build_object(
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('tipo', c.tipo, 'dia', c.dia, 'numero_pedido', c.np,
                                                             'usuario', c.usu, 'valor', round(c.val, 2), 'origem', c.origem)
                                          order by c.dia, c.np)
                           from classif c where c.origem is not null), '[]'::jsonb),
    'leads', coalesce((select jsonb_object_agg(x.dia, x.n) from (
                select (l.criado_em_lead at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
                  from public.leads l where l.criado_em_lead >= v_ini and l.criado_em_lead < v_fim group by 1) x), '{}'::jsonb),
    'atendidas', coalesce((select jsonb_object_agg(x.dia, x.n) from (
                select (d.gerada_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
                  from public.discador_chamadas d
                 where d.gerada_em >= v_ini and d.gerada_em < v_fim and d.operacao = 'apex'
                   and d.status = 'ANSWERED' and d.agente_id is not null group by 1) x), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $f$;

revoke all on function public.lead_mailing_comparativo(date, date) from public, anon;
grant execute on function public.lead_mailing_comparativo(date, date) to authenticated;

commit;
