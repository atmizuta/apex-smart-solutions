-- Trava de cargo (09/10/2026) — REGRAS_NEGOCIO.md seção 78.
-- Furo: a policy profiles_update deixa cada usuário editar a própria linha (para trocar nome/usuário) e o grant de
-- UPDATE cobre a coluna role — um consultor conseguia virar admin chamando a API direto. Agora só admin muda cargo.
-- auth.uid() nulo = service_role / SQL do dono (Edge Functions, migrations). Telas atuais não mudam: só o admin troca
-- cargo pela aba Usuários. Aditiva, sem DROP. Desfazer: supabase/rollback/20261009210000_profiles_trava_role_rollback.sql
create or replace function public.profiles_trava_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'só administrador muda o cargo' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_profiles_trava_role before update of role on public.profiles
  for each row execute function public.profiles_trava_role();
