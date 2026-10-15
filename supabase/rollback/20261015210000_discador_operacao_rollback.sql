-- Desfaz 20261015210000_discador_operacao.sql (§89). DEPOIS de rodar este arquivo, rode de novo
-- supabase/migrations/20261014110100_discador_metricas.sql para recriar as funções sem operação (§87).
drop function if exists public.discador_mailing(date, date, text, text);
drop function if exists public.discador_consultor_dias(int, date, date, text);
drop function if exists public.discador_consultores(date, date, text);
drop function if exists public.discador_mapa_calor(date, date, text);
drop function if exists public.discador_por_hora(date, date, text);
drop function if exists public.discador_resumo(date, date, text);
drop function if exists public.discador_vendas_atribuidas(date, date, text);
drop function if exists public.discador_periodo(date, date, text);
drop function if exists public.discador_operacao_efetiva(text);
drop trigger if exists trg_discador_chamadas_operacao on public.discador_chamadas;
drop function if exists public.discador_chamadas_operacao();
drop index if exists public.idx_discador_operacao;
alter table public.discador_chamadas drop column if exists operacao;
drop function if exists public.discador_operacao_da_campanha(text);
update public.config set valor = (valor::jsonb - 'campanhas')::text, atualizado_em = now() where chave = 'discador';
