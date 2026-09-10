-- Schema de produção do portal BlueCat para Supabase.
--
-- Esta versão usa Supabase Auth como identidade. O id do perfil público é o
-- mesmo id de auth.users; assim, auth.uid() pode ser usado diretamente nas
-- policies de RLS e o frontend estático nunca precisa conhecer uma senha.

create type public."UserRole" as enum (
  'PLATFORM_ADMIN',
  'CLIENT_ADMIN',
  'CLIENT_EDITOR',
  'CLIENT_VIEWER'
);

create type public."ArticleStatus" as enum (
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED'
);

create type public."AccessRequestStatus" as enum (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

create table public."Company" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text unique,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- Perfil da aplicação. A autenticação e a senha ficam no schema auth do Supabase.
create table public."User" (
  id uuid primary key references auth.users(id) on delete cascade,
  "companyId" uuid references public."Company"(id) on delete restrict,
  name text not null,
  email text not null unique,
  role public."UserRole" not null default 'CLIENT_VIEWER',
  "mustChangePassword" boolean not null default true,
  active boolean not null default true,
  "passwordChangedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table public."AccessRequest" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  "companyName" text not null,
  "companyDocument" text,
  message text,
  status public."AccessRequestStatus" not null default 'PENDING',
  "reviewedAt" timestamptz,
  "reviewedById" uuid references public."User"(id) on delete set null,
  "rejectionReason" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table public."Category" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  "parentId" uuid references public."Category"(id) on delete restrict,
  "sortOrder" integer not null default 0,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table public."Article" (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  summary text,
  content text not null,
  "videoUrl" text,
  status public."ArticleStatus" not null default 'DRAFT',
  "categoryId" uuid not null references public."Category"(id) on delete restrict,
  "authorId" uuid not null references public."User"(id) on delete restrict,
  "publishedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table public."CompanyCategoryPermission" (
  id uuid primary key default gen_random_uuid(),
  "companyId" uuid not null references public."Company"(id) on delete cascade,
  "categoryId" uuid not null references public."Category"(id) on delete cascade,
  "canView" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("companyId", "categoryId")
);

create index "Company_active_idx" on public."Company" (active);
create index "User_companyId_idx" on public."User" ("companyId");
create index "User_role_idx" on public."User" (role);
create index "Category_parentId_idx" on public."Category" ("parentId");
create index "Article_categoryId_idx" on public."Article" ("categoryId");
create index "Article_status_idx" on public."Article" (status);
create index "AccessRequest_status_createdAt_idx" on public."AccessRequest" (status, "createdAt");
create index "AccessRequest_email_idx" on public."AccessRequest" (lower(email));
create unique index "AccessRequest_pending_email_key"
  on public."AccessRequest" (lower(email))
  where status = 'PENDING';

-- Atualiza timestamps quando a operação acontece diretamente pelo Supabase.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

create trigger set_company_updated_at before update on public."Company"
for each row execute function public.set_updated_at();
create trigger set_user_updated_at before update on public."User"
for each row execute function public.set_updated_at();
create trigger set_access_request_updated_at before update on public."AccessRequest"
for each row execute function public.set_updated_at();
create trigger set_category_updated_at before update on public."Category"
for each row execute function public.set_updated_at();
create trigger set_article_updated_at before update on public."Article"
for each row execute function public.set_updated_at();
create trigger set_permission_updated_at before update on public."CompanyCategoryPermission"
for each row execute function public.set_updated_at();

-- Funções SECURITY DEFINER evitam recursão nas policies ao consultar o perfil.
create or replace function public.app_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public."User" u
    join public."Company" c on c.id = u."companyId"
    where u.id = auth.uid() and u.role = 'PLATFORM_ADMIN' and u.active
  )
  or exists (
    select 1 from public."User" u
    where u.id = auth.uid() and u.role = 'PLATFORM_ADMIN' and u.active and u."companyId" is null
  );
$$;

create or replace function public.app_current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u."companyId"
  from public."User" u
  left join public."Company" c on c.id = u."companyId"
  where u.id = auth.uid() and u.active and (u."companyId" is null or c.active)
  limit 1;
$$;

create or replace function public.app_can_view_category(category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_is_platform_admin()
  or exists (
    select 1
    from public."CompanyCategoryPermission" p
    where p."companyId" = public.app_current_company_id()
      and p."categoryId" = category_id
      and p."canView"
  );
$$;

-- RLS é a última barreira: mesmo que alguém chame o PostgREST diretamente,
-- o banco limita empresa, perfil e status do conteúdo.
alter table public."Company" enable row level security;
alter table public."User" enable row level security;
alter table public."AccessRequest" enable row level security;
alter table public."Category" enable row level security;
alter table public."Article" enable row level security;
alter table public."CompanyCategoryPermission" enable row level security;

create policy company_platform_all on public."Company"
for all to authenticated
using (public.app_is_platform_admin())
with check (public.app_is_platform_admin());

create policy company_client_read on public."Company"
for select to authenticated
using (id = public.app_current_company_id() and active);

create policy user_platform_all on public."User"
for all to authenticated
using (public.app_is_platform_admin())
with check (public.app_is_platform_admin());

create policy user_own_read on public."User"
for select to authenticated
using (id = auth.uid() and active);

create policy access_request_platform_read on public."AccessRequest"
for select to authenticated
using (public.app_is_platform_admin());

create policy access_request_platform_update on public."AccessRequest"
for update to authenticated
using (public.app_is_platform_admin())
with check (public.app_is_platform_admin());

create policy category_platform_all on public."Category"
for all to authenticated
using (public.app_is_platform_admin())
with check (public.app_is_platform_admin());

create policy category_client_read on public."Category"
for select to authenticated
using (active and public.app_can_view_category(id));

create policy article_platform_all on public."Article"
for all to authenticated
using (public.app_is_platform_admin())
with check (public.app_is_platform_admin());

create policy article_client_read on public."Article"
for select to authenticated
using (status = 'PUBLISHED' and public.app_can_view_category("categoryId"));

create policy permission_platform_all on public."CompanyCategoryPermission"
for all to authenticated
using (public.app_is_platform_admin())
with check (public.app_is_platform_admin());

create policy permission_client_read on public."CompanyCategoryPermission"
for select to authenticated
using ("companyId" = public.app_current_company_id());

-- O frontend só precisa da chave publicável; service_role fica restrita às
-- Edge Functions e nunca é colocada no GitHub Pages.
revoke all on public."Company", public."User", public."AccessRequest",
  public."Category", public."Article", public."CompanyCategoryPermission"
from anon;

grant select on public."Company", public."User", public."Category", public."Article",
  public."CompanyCategoryPermission" to authenticated;
grant select, update on public."AccessRequest" to authenticated;
grant insert, update, delete on public."Company", public."User", public."Category",
  public."Article", public."CompanyCategoryPermission" to authenticated;

revoke execute on function public.app_is_platform_admin() from public;
revoke execute on function public.app_current_company_id() from public;
revoke execute on function public.app_can_view_category(uuid) from public;
grant execute on function public.app_is_platform_admin() to authenticated;
grant execute on function public.app_current_company_id() to authenticated;
grant execute on function public.app_can_view_category(uuid) to authenticated;
