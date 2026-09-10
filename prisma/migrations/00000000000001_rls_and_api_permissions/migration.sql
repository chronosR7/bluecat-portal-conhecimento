-- Configura papéis, funções de contexto e policies de RLS do banco.
-- The migration role owns the tables; the application role only receives
-- the privileges required to execute the API. Row-level policies below are
-- the database-level defense against cross-company access.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bluecat_api;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE
  public."Company",
  public."User",
  public."Category",
  public."Article",
  public."CompanyCategoryPermission"
TO bluecat_api;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bluecat_api;

ALTER DEFAULT PRIVILEGES FOR ROLE bluecat_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bluecat_api;

ALTER DEFAULT PRIVILEGES FOR ROLE bluecat_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bluecat_api;

-- The API sets app.user_id only inside a transaction. These functions are
-- SECURITY DEFINER so their lookup is not blocked by the policies on User.
CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.app_current_user_is_valid()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."User" AS u
    LEFT JOIN public."Company" AS c ON c.id = u."companyId"
    WHERE u.id = public.app_current_user_id()
      AND u.active = true
      AND (u."companyId" IS NULL OR c.active = true)
  )
$$;

CREATE OR REPLACE FUNCTION public.app_current_user_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u."companyId"
  FROM public."User" AS u
  LEFT JOIN public."Company" AS c ON c.id = u."companyId"
  WHERE u.id = public.app_current_user_id()
    AND u.active = true
    AND (u."companyId" IS NULL OR c.active = true)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.app_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.role::text
  FROM public."User" AS u
  WHERE u.id = public.app_current_user_id()
    AND u.active = true
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.app_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.app_current_user_is_valid()
    AND public.app_current_user_role() = 'PLATFORM_ADMIN'
$$;

-- Login happens before a JWT exists. The API can call this narrow function,
-- instead of receiving unrestricted SELECT access to the User table.
CREATE OR REPLACE FUNCTION public.app_auth_lookup_user(p_email text)
RETURNS TABLE (
  id uuid,
  "companyId" uuid,
  name text,
  email text,
  "passwordHash" text,
  role public."UserRole",
  "mustChangePassword" boolean,
  active boolean,
  "companyActive" boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    u.id,
    u."companyId",
    u.name,
    u.email,
    u."passwordHash",
    u.role,
    u."mustChangePassword",
    u.active,
    c.active
  FROM public."User" AS u
  LEFT JOIN public."Company" AS c ON c.id = u."companyId"
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.app_current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_current_user_is_valid() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_current_user_company_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_is_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_auth_lookup_user(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.app_current_user_id() TO bluecat_api;
GRANT EXECUTE ON FUNCTION public.app_current_user_is_valid() TO bluecat_api;
GRANT EXECUTE ON FUNCTION public.app_current_user_company_id() TO bluecat_api;
GRANT EXECUTE ON FUNCTION public.app_current_user_role() TO bluecat_api;
GRANT EXECUTE ON FUNCTION public.app_is_platform_admin() TO bluecat_api;
GRANT EXECUTE ON FUNCTION public.app_auth_lookup_user(text) TO bluecat_api;

ALTER TABLE public."Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Article" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyCategoryPermission" ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_platform_all
ON public."Company"
FOR ALL TO bluecat_api
USING (public.app_is_platform_admin())
WITH CHECK (public.app_is_platform_admin());

CREATE POLICY company_client_select
ON public."Company"
FOR SELECT TO bluecat_api
USING (
  active = true
  AND id = public.app_current_user_company_id()
);

CREATE POLICY user_platform_all
ON public."User"
FOR ALL TO bluecat_api
USING (public.app_is_platform_admin())
WITH CHECK (public.app_is_platform_admin());

CREATE POLICY user_client_select
ON public."User"
FOR SELECT TO bluecat_api
USING (
  public.app_current_user_is_valid()
  AND (
    id = public.app_current_user_id()
    OR (
      "companyId" = public.app_current_user_company_id()
      AND public.app_current_user_role() = 'CLIENT_ADMIN'
    )
  )
);

CREATE POLICY user_client_update
ON public."User"
FOR UPDATE TO bluecat_api
USING (
  public.app_current_user_is_valid()
  AND (
    id = public.app_current_user_id()
    OR (
      "companyId" = public.app_current_user_company_id()
      AND public.app_current_user_role() = 'CLIENT_ADMIN'
    )
  )
)
WITH CHECK (
  public.app_current_user_is_valid()
  AND "companyId" = public.app_current_user_company_id()
  AND role::text IN ('CLIENT_ADMIN', 'CLIENT_EDITOR', 'CLIENT_VIEWER')
);

CREATE POLICY category_platform_all
ON public."Category"
FOR ALL TO bluecat_api
USING (public.app_is_platform_admin())
WITH CHECK (public.app_is_platform_admin());

CREATE POLICY category_client_select
ON public."Category"
FOR SELECT TO bluecat_api
USING (
  active = true
  AND EXISTS (
    SELECT 1
    FROM public."CompanyCategoryPermission" AS p
    WHERE p."categoryId" = id
      AND p."companyId" = public.app_current_user_company_id()
      AND p."canView" = true
  )
);

CREATE POLICY article_platform_all
ON public."Article"
FOR ALL TO bluecat_api
USING (public.app_is_platform_admin())
WITH CHECK (public.app_is_platform_admin());

CREATE POLICY article_client_select
ON public."Article"
FOR SELECT TO bluecat_api
USING (
  status = 'PUBLISHED'::public."ArticleStatus"
  AND EXISTS (
    SELECT 1
    FROM public."CompanyCategoryPermission" AS p
    WHERE p."categoryId" = "categoryId"
      AND p."companyId" = public.app_current_user_company_id()
      AND p."canView" = true
  )
);

CREATE POLICY permission_platform_all
ON public."CompanyCategoryPermission"
FOR ALL TO bluecat_api
USING (public.app_is_platform_admin())
WITH CHECK (public.app_is_platform_admin());

CREATE POLICY permission_client_select
ON public."CompanyCategoryPermission"
FOR SELECT TO bluecat_api
USING (
  "companyId" = public.app_current_user_company_id()
);
