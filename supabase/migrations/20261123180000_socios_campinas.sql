-- §163 (23/11/2026, pedido do Rafael): a aba "Consultar sócios" (§157) passa a valer também para a operação Campinas.
-- Só muda quem pode pedir consulta avulsa (socios_pode_avulsa, usada por socios_pedir_cnpj).
-- Limite de 20/dia, resultado guardado 30 dias e "cada um vê só as próprias consultas" seguem iguais (§157).
-- Admin e supervisor (de qualquer operação) já podiam; antes, consultor só da Apex.
create or replace function public.socios_pode_avulsa()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.profiles p where p.id = auth.uid()
                  and (p.role in ('admin','supervisor') or (p.role = 'consultor' and p.operacao in ('apex','campinas'))));
$function$;
