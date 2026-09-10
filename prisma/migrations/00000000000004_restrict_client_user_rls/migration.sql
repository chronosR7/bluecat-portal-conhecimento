-- Restringe leitura/alteração de usuários clientes ao próprio perfil.
-- Clientes podem consultar e alterar apenas o próprio perfil para trocar a senha.
-- A gestão de usuários permanece exclusiva do PLATFORM_ADMIN na API e no banco.

DROP POLICY IF EXISTS user_client_select ON public."User";

CREATE POLICY user_client_select
ON public."User"
FOR SELECT TO bluecat_api
USING (
  public.app_current_user_is_valid()
  AND id = public.app_current_user_id()
);

DROP POLICY IF EXISTS user_client_update ON public."User";

CREATE POLICY user_client_update
ON public."User"
FOR UPDATE TO bluecat_api
USING (
  public.app_current_user_is_valid()
  AND id = public.app_current_user_id()
)
WITH CHECK (
  public.app_current_user_is_valid()
  AND id = public.app_current_user_id()
  AND "companyId" = public.app_current_user_company_id()
  AND role::text IN ('CLIENT_ADMIN', 'CLIENT_EDITOR', 'CLIENT_VIEWER')
);
