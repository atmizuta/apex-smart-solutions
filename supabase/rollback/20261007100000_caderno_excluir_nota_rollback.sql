-- Desfaz 20261007100000_caderno_excluir_nota.sql (§74): volta a não deixar ninguém apagar caderno_notas
-- (como era na §72) — não apaga dado nenhum, só tira a permissão/gatilho de excluir.
drop trigger if exists caderno_notas_exclui_retornos on public.caderno_notas;
drop function if exists public.caderno_nota_exclui_retornos();
drop policy if exists caderno_notas_delete on public.caderno_notas;
revoke delete on public.caderno_notas from authenticated;
