-- Aba Digital: cada lead passa a saber de qual ABA da planilha veio (30/09/2026).
-- Antes, AGOSTO, SETEMBRO e REPIQUE iam para a mesma tabela sem identificação e a chave era só o `id`
-- (o mesmo id em duas abas era sobrescrito pela última). Agora a chave é (aba, id) e a tela tem um seletor
-- de aba. Ver REGRAS_NEGOCIO.md seção 54 e edge_function_sync_leads.ts.
--
-- ORDEM DE APLICAÇÃO (feita em 30/09/2026):
--   1) o bloco "coluna" abaixo;
--   2) o preenchimento de leads.aba (e do consultor de SETEMBRO) a partir da planilha — script pontual, não
--      fica no repositório porque depende da planilha daquele dia; a próxima sincronização refaz tudo;
--   3) os blocos "chave", "categoria" e "reconciliação" (este arquivo inteiro é idempotente e para com erro
--      claro se ainda houver lead sem aba);
--   4) publicar a Edge Function sync-leads nova (usa onConflict "aba,id") e só depois o painel novo.

-- ------------------------------------------------------------------ coluna
alter table public.leads add column if not exists aba text;

-- ------------------------------------------------------------------ chave (aba, id)
do $$
begin
  if exists (select 1 from public.leads where aba is null) then
    raise exception 'Ainda há leads sem aba: preencha leads.aba antes de trocar a chave.';
  end if;
end $$;
alter table public.leads alter column aba set not null;
alter table public.leads drop constraint if exists leads_pkey;
alter table public.leads add constraint leads_pkey primary key (aba, id);
create index if not exists idx_leads_aba on public.leads (aba);

-- ------------------------------------------------------------------ categoria: novos status = venda perdida
-- (decisão do usuário, 30/09/2026; mesma lista e mesma normalização — sem acento, sem diferença de caixa e
-- com espaços repetidos colapsados — da Edge Function). PEDIDO EM ANÁLISE continua em andamento.
update public.leads
   set categoria = 'perdido'
 where categoria = 'andamento'
   and upper(regexp_replace(translate(coalesce(status, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'), '\s+', ' ', 'g'))
       in ('TELEFONE ERRADO OU SEM WHATSAPP', 'LEAD FORA DO PERFIL', 'CLIENTE SO QUERIA APARELHO',
           'CLIENTE SO QUERIA FIBRA', 'CNPJ REPROVADO', 'SUSPEITA DE FRAUDE', 'CLIENTE NAO QUER NO CNPJ');

-- ------------------------------------------------------------------ reconciliação com o NeoCRM por aba
-- Ganha o parâmetro p_aba (opcional): o card "Conversão confirmada no NeoCRM" dos consultores passa a
-- respeitar a aba escolhida. Sem p_aba o comportamento é o de antes (todas as abas), então o painel antigo
-- continua funcionando durante a troca.
drop function if exists public.reconciliacao_neocrm(date, date);
create or replace function public.reconciliacao_neocrm(p_de date, p_ate date, p_aba text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  with leads_conv as (
    select cnpj
    from leads
    where converteu = true
      and (p_aba is null or aba = p_aba)
      and (
        (p_de is null and p_ate is null)
        or (
          criado_em_lead is not null
          and (p_de is null or (criado_em_lead at time zone 'America/Sao_Paulo')::date >= p_de)
          and (p_ate is null or (criado_em_lead at time zone 'America/Sao_Paulo')::date <= p_ate)
        )
      )
  ),
  leads_norm as (
    select regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') as cnpj_digits
    from leads_conv
  ),
  pedidos_norm as (
    select
      regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') as cnpj_digits,
      numero_pedido, etapa, cadastro, atualizacao,
      row_number() over (
        partition by regexp_replace(coalesce(cnpj, ''), '\D', '', 'g')
        order by atualizacao desc nulls last
      ) as rn
    from producao_pedidos
    where cnpj is not null and cnpj <> ''
  ),
  pedidos_latest as (
    select cnpj_digits, numero_pedido, etapa, cadastro
    from pedidos_norm
    where rn = 1
  ),
  cruzado as (
    select
      pl.numero_pedido,
      pl.etapa,
      pl.cadastro,
      case
        when pl.etapa is null then 'sem_pedido'
        when pl.etapa = 'CONCLUIDO (NEOCRM)' then 'ganho'
        when pl.etapa = 'ENTREGA (NEOCRM)' then 'ganho'
        when pl.etapa = 'FATURAMENTO (NEOCRM)' then 'ganho'
        when pl.etapa = 'PORTABILIDADE EM ANDAMENTO (NEOCRM)' then 'ganho'
        when pl.etapa = 'VALIDAÇÃO ESIM (NEOCRM)' then 'ganho'
        when pl.etapa = 'VENDA PERDIDA (NEOCRM)' then 'perdido'
        when pl.etapa = 'DEVOLVIDO (NEOCRM)' then 'devolvido'
        else 'andamento'
      end as categoria
    from leads_norm ln
    left join pedidos_latest pl
      on pl.cnpj_digits = ln.cnpj_digits and ln.cnpj_digits <> ''
  )
  select jsonb_build_object(
    'total', (select count(*) from cruzado),
    'ganho', (select count(*) from cruzado where categoria = 'ganho'),
    'perdido', (select count(*) from cruzado where categoria = 'perdido'),
    'andamento', (select count(*) from cruzado where categoria in ('andamento', 'devolvido')),
    'semPedido', (select count(*) from cruzado where categoria = 'sem_pedido'),
    'pedidosGanho', coalesce((
      select jsonb_agg(jsonb_build_object('numero_pedido', numero_pedido, 'etapa', etapa, 'cadastro', cadastro))
      from cruzado where categoria = 'ganho'
    ), '[]'::jsonb),
    'pedidosPerdido', coalesce((
      select jsonb_agg(jsonb_build_object('numero_pedido', numero_pedido, 'etapa', etapa, 'cadastro', cadastro))
      from cruzado where categoria = 'perdido'
    ), '[]'::jsonb),
    'pedidosAndamento', coalesce((
      select jsonb_agg(jsonb_build_object('numero_pedido', numero_pedido, 'etapa', etapa, 'cadastro', cadastro))
      from cruzado where categoria in ('andamento', 'devolvido')
    ), '[]'::jsonb)
  ) into resultado;

  return resultado;
end;
$;
revoke all on function public.reconciliacao_neocrm(date, date, text) from public, anon;
grant execute on function public.reconciliacao_neocrm(date, date, text) to authenticated;
