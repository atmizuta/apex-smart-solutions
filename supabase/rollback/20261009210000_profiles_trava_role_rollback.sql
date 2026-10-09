-- Desfaz 20261009210000_profiles_trava_role.sql (§78). Volta o furo: qualquer usuário consegue mudar o próprio cargo.
drop trigger if exists trg_profiles_trava_role on public.profiles;
drop function if exists public.profiles_trava_role();
