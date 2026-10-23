-- =====================================================
-- PERFIL GP — gestores de produto, só consulta (2026-10-23)
-- Correr uma vez no SQL Editor do Supabase (projeto mtg1-picking).
--
-- Cria o utilizador GP (PIN 0000) para a app do parque. Na app vê a Pesquisa,
-- o Stock e o Histórico; aqui a base de dados recusa qualquer gravação feita
-- com a sessão dele (movimentos, stock, inventário, mensagens), mesmo que
-- alguém o tente por fora da app. O login do parque dá-lhe o perfil
-- "operator", que já permite ler o stock e o histórico.
-- =====================================================

insert into app_users (username, password_hash)
values ('GP', extensions.crypt('0000', extensions.gen_salt('bf')))
on conflict (username) do update set password_hash = excluded.password_hash;

create or replace function public.recusar_perfil_consulta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') = 'gp@warehouse.local' then
    raise exception 'so_consulta';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace trigger recusar_perfil_consulta before insert or update or delete on stock_items
  for each row execute function public.recusar_perfil_consulta();
create or replace trigger recusar_perfil_consulta before insert or update or delete on movements
  for each row execute function public.recusar_perfil_consulta();
create or replace trigger recusar_perfil_consulta before insert or update or delete on admin_notifications
  for each row execute function public.recusar_perfil_consulta();
create or replace trigger recusar_perfil_consulta before insert or update or delete on inventory_audit
  for each row execute function public.recusar_perfil_consulta();
create or replace trigger recusar_perfil_consulta before insert or update or delete on model_sap_lookup
  for each row execute function public.recusar_perfil_consulta();
