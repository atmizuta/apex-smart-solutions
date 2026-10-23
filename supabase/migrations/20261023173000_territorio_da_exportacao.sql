-- §109 (REGRAS_NEGOCIO.md) — Etapa TERRITORIO lida da exportação (23/10/2026).
-- A NeoSales passou a mandar a etapa TERRITORIO no Relatório de Exportação (painel 15455) a partir da execução de
-- 23/10 16:41. A API de produção continua sem ela, e o dashboard lê a etapa de producao_pedidos_neo (só a
-- sync-producao escreve ali). Esta função copia TERRITORIO da exportação para os itens do pedido em
-- producao_pedidos_neo. Substitui a dedução "sumiu de ANTIFRAUDE = TERRITORIO" da §82, que deixa de ser chamada.
-- Quem chama é a sync-exportacao, depois de gravar uma exportação completa, com o mesmo p_agora gravado em
-- producao_atividades.sincronizado_em.

create or replace function public.producao_territorio_da_exportacao(p_agora timestamptz)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  -- Item vai para TERRITORIO quando o pedido apareceu nesta exportação em TERRITORIO (com ou sem acento), a
  -- atualização do NEO na exportação é mais nova que a do item, e o item não está numa etapa final.
  with alvo as (
    select p.item_id
      from public.producao_pedidos_neo p
      join public.producao_atividades a on a.numero_pedido = p.numero_pedido
     where a.sincronizado_em = p_agora
       and translate(upper(a.etapa), 'Ó', 'O') like '%TERRITORIO%'
       and a.atualizado_em_neo > coalesce(p.atualizacao, '-infinity'::timestamptz)
       and p.etapa is distinct from 'TERRITORIO (NEOCRM)'
       and coalesce(p.etapa, '') not in ('VENDA PERDIDA (NEOCRM)', 'CONCLUIDO (NEOCRM)', 'DEVOLVIDO (NEOCRM)', 'ARQUIVADO (NEOCRM)')
  ), mudou as (
    update public.producao_pedidos_neo p
       set etapa = 'TERRITORIO (NEOCRM)'
      from alvo
     where p.item_id = alvo.item_id
    returning p.item_id
  )
  select count(*) into n from mudou;

  -- O gatilho trg_producao_neo_etapa registrou a troca com em = now(); a entrada real na etapa é a última
  -- atualização do pedido no NEO, para os dias parados contarem dali.
  update public.producao_etapa_historico h
     set em = a.atualizado_em_neo
    from public.producao_pedidos_neo p
    join public.producao_atividades a on a.numero_pedido = p.numero_pedido
   where h.item_id = p.item_id
     and h.etapa_nova = 'TERRITORIO (NEOCRM)'
     and h.em = now()
     and a.sincronizado_em = p_agora
     and a.atualizado_em_neo is not null;

  return n;
end $$;

revoke all on function public.producao_territorio_da_exportacao(timestamptz) from public, anon, authenticated;
