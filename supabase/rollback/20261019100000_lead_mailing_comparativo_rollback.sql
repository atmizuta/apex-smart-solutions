-- Rollback da §99 (Lead × Mailing). O painel sem a função mostra "não foi possível carregar" no bloco e segue normal.
drop function if exists public.lead_mailing_comparativo(date, date);
