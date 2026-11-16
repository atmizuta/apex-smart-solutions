-- §154 (16/11/2026, pedido do Rafael): "Bloquear todos" (§132) trava só o Pegar (leads_pegar); a entrega automática
-- (§146) continua. Antes o bloqueio também parava o motor no modo Automático (decisão 1-A da §146.2).
-- Troca só as duas linhas do bloqueio na definição que está no banco; falha se o trecho não for achado.
begin;
do $mig$
declare d text;
  a1 text := $x$if v_modo = 'automatico' and public.leads_pegar_bloqueado() then return jsonb_build_object('ok', false, 'motivo', 'bloqueado'); end if;$x$;
  a2 text := $x$if v_exp and (v_modo = 'sombra' or not public.leads_pegar_bloqueado()) then$x$;
begin
  d := pg_get_functiondef('public.leads_distribuir(text,text)'::regprocedure);
  if position(a1 in d) = 0 then raise exception '§154: trecho do bloqueio não encontrado em leads_distribuir'; end if;
  execute replace(d, a1, '-- §154: "Bloquear todos" trava só o Pegar; o motor segue entregando.');
  d := pg_get_functiondef('public.leads_dist_tick()'::regprocedure);
  if position(a2 in d) = 0 then raise exception '§154: trecho do bloqueio não encontrado em leads_dist_tick'; end if;
  execute replace(d, a2, 'if v_exp then   -- §154: o bloqueio do Pegar não para o motor');
end $mig$;
commit;
