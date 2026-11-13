-- §143 (ajuste de 13/11, Rafael): o consultor vê as propostas ligadas a clientes da carteira DELE, mesmo quando foram
-- geradas por admin ou supervisor (antes só via as próprias, pela propostas_select). Só leitura: editar continua com o dono.
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/renovacao_propostas_visiveis_check.sql.
begin;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'propostas' and policyname = 'propostas_select_carteira') then
    create policy propostas_select_carteira on public.propostas for select to authenticated
      using (carteira_id is not null
             and exists (select 1 from public.renovacao_carteira c where c.id = carteira_id and c.consultor_id = auth.uid()));
  end if;
end $$;

commit;
