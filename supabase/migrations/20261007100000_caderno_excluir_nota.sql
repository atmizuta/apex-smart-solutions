-- 07/10/2026 — Excluir anotação do Caderno (de verdade). REGRAS_NEGOCIO.md §74. Aditiva e idempotente.
-- A migration 20261006100000 (§72) tinha revogado delete de caderno_notas/agenda_retornos (ninguém
-- apagava; retorno só se cancela). Aqui devolve o delete só para caderno_notas, só o dono (consultor_id
-- = auth.uid()) — admin/supervisor continuam sem poder apagar a nota de outro. agenda_retornos segue
-- sem delete (continua só "se cancela"): um BEFORE DELETE em caderno_notas cancela os retornos PENDENTES
-- daquela nota antes de a linha sumir; a FK (nota_id … on delete set null, já existente) zera o nota_id
-- dos retornos (pendentes cancelados agora, ou já "feito") logo depois.

grant delete on public.caderno_notas to authenticated;

drop policy if exists caderno_notas_delete on public.caderno_notas;
create policy caderno_notas_delete on public.caderno_notas for delete to authenticated
  using (consultor_id = auth.uid());

create or replace function public.caderno_nota_exclui_retornos() returns trigger
language plpgsql set search_path = public as $$
begin
  update public.agenda_retornos set status = 'cancelado' where nota_id = old.id and status = 'pendente';
  return old;
end $$;
drop trigger if exists caderno_notas_exclui_retornos on public.caderno_notas;
create trigger caderno_notas_exclui_retornos before delete on public.caderno_notas
  for each row execute function public.caderno_nota_exclui_retornos();
