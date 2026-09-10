-- Execute depois de criar o primeiro usuário em Authentication > Users.
-- O usuário precisa existir no Auth antes de ganhar o perfil da aplicação.

insert into public."User" (
  id,
  name,
  email,
  role,
  "mustChangePassword",
  active
)
select
  id,
  'Administrador BlueCat',
  lower(email),
  'PLATFORM_ADMIN'::public."UserRole",
  false,
  true
from auth.users
where lower(email) = lower('admin@bluecat.com.br')
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  "mustChangePassword" = false,
  active = true;

-- Confirme que exatamente o perfil esperado foi criado.
select id, name, email, role, active
from public."User"
where lower(email) = lower('admin@bluecat.com.br');
