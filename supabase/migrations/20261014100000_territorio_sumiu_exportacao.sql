-- §82 (REGRAS_NEGOCIO.md) — Etapa TERRITÓRIO deduzida pela exportação (14/10/2026).
-- Nenhuma das duas APIs da NeoSales (produção e exportação) devolve pedido na etapa TERRITORIO: quando o pedido
-- sai de ANTIFRAUDE para TERRITORIO ele some das duas, e o painel o mostrava "parado em ANTIFRAUDE" para sempre.
-- A exportação devolve o painel 15455 inteiro a cada execução, então "estava em ANTIFRAUDE e sumiu da exportação"
-- = foi para TERRITORIO. Quem chama é a sync-exportacao, depois de gravar uma exportação completa.
-- Se o pedido voltar a aparecer na API (saiu de TERRITORIO), a sync-producao grava a etapa real por cima.

alter table public.exportacao_sync_log add column if not exists territorio int;

create or replace function public.producao_marca_territorio(p_agora timestamptz)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  -- Trava: exportação incompleta faria muitos pedidos "sumirem" de uma vez. Acima de 40 não marca nada e devolve
  -- o número negativo (vai para exportacao_sync_log.territorio para alguém olhar).
  select count(*) into n
    from public.producao_atividades a
    join public.producao_pedidos_neo p on p.numero_pedido = a.numero_pedido and p.etapa = 'ANTIFRAUDE (NEOCRM)'
   where a.etapa = 'ANTIFRAUDE (NEOCRM)'
     and a.sincronizado_em < p_agora - interval '90 minutes';
  if n > 40 then
    return -n;
  end if;

  -- Ausente em pelo menos 2 execuções horárias seguidas (visto pela última vez há mais de 90 min).
  with sumidos as (
    select a.numero_pedido, a.sincronizado_em as visto
      from public.producao_atividades a
     where a.etapa = 'ANTIFRAUDE (NEOCRM)'
       and a.sincronizado_em < p_agora - interval '90 minutes'
  )
  update public.producao_pedidos_neo p
     set etapa = 'TERRITORIO (NEOCRM)'
    from sumidos s
   where p.numero_pedido = s.numero_pedido
     and p.etapa = 'ANTIFRAUDE (NEOCRM)';
  get diagnostics n = row_count;

  -- O gatilho trg_producao_neo_etapa acabou de registrar a troca com em = now(); a entrada real na etapa é
  -- a última vez que o pedido apareceu na exportação.
  update public.producao_etapa_historico h
     set em = a.sincronizado_em
    from public.producao_atividades a
   where h.numero_pedido = a.numero_pedido
     and h.etapa_nova = 'TERRITORIO (NEOCRM)'
     and h.etapa_anterior = 'ANTIFRAUDE (NEOCRM)'
     and h.em = now();

  -- A cópia em producao_atividades acompanha, para o pedido não ser reprocessado nem aparecer em ANTIFRAUDE.
  update public.producao_atividades a
     set etapa = 'TERRITORIO (NEOCRM)'
   where a.etapa = 'ANTIFRAUDE (NEOCRM)'
     and a.sincronizado_em < p_agora - interval '90 minutes';

  return n;
end $$;

revoke all on function public.producao_marca_territorio(timestamptz) from public, anon, authenticated;
