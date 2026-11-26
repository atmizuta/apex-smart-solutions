-- Conferência da §165 (prioridade v2). Roda tudo e DESFAZ (rollback). Esperado: nenhum erro.
begin;
do $$
begin
  assert public.renovacao_prioridade('APTO', true, false, 4) = 'P1', 'P1';
  assert public.renovacao_prioridade('APTO', true, false, 30) = 'P1', 'P1 grande';
  assert public.renovacao_prioridade('APTO', true, false, 3) = 'P2', 'P2';
  assert public.renovacao_prioridade('APTO', true, true, 8) = 'P3', 'já tem fixa não é fixa nova';
  assert public.renovacao_prioridade('APTO', false, false, 10) = 'P3', 'P3 (10 linhas entra em 4+)';
  assert public.renovacao_prioridade('APTO', false, false, 2) = 'P4', 'P4';
  assert public.renovacao_prioridade('APTO', null, null, null) = 'P4', 'nulos';
  assert public.renovacao_prioridade('1 MÊS PARA APTO', true, false, 20) = 'P5', 'P5 1 mês';
  assert public.renovacao_prioridade('2 MESES PARA APTO', false, true, 1) = 'P5', 'P5 2 meses';
  assert public.renovacao_prioridade('NÃO APTO', true, false, 5) = 'P6', 'P6';
  assert public.renovacao_prioridade('NÃO APTO', true, true, 5) is null, 'não apto com fixa hoje: sem prioridade';
  assert public.renovacao_prioridade('NÃO APTO', false, false, 5) is null, 'sem prioridade';
end $$;
rollback;
