-- Aplicada junto da 20260930200000 (30/09/2026): as funções de gatilho só precisam rodar como gatilho;
-- ninguém deve chamá-las por /rest/v1/rpc (achado do verificador de segurança do Supabase).
revoke all on function public.producao_neo_raw_sync_usuario() from public, anon, authenticated;
revoke all on function public.producao_neo_registra_etapa() from public, anon, authenticated;
