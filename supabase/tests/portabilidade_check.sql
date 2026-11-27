-- Conferência do Kanban de Portabilidade (desfaz tudo no final). Rodar depois da migração com execute_sql.
begin;
select set_config('request.jwt.claims', '{"sub":"9cb30d3e-b72a-4bc1-9104-6d580c5503bb","role":"authenticated"}', true);
set local role authenticated;
select 'consultor' quem, jsonb_array_length(public.portabilidade_quadro()) clientes;
select public.portabilidade_registrar(
  (select (j->>'cnpj') from jsonb_array_elements(public.portabilidade_quadro()) j where j->>'etapa' <> 'portado' limit 1),
  103474, null, true, current_date + 2, false, 'teste') r;
rollback;
