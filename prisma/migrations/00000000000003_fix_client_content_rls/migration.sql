-- Corrige o escopo das policies de leitura do cliente.
-- As versões anteriores comparavam p.categoryId com a própria coluna p.categoryId,
-- em vez de relacioná-la com a linha corrente de Category/Article.

DROP POLICY IF EXISTS category_client_select ON public."Category";

CREATE POLICY category_client_select
ON public."Category"
FOR SELECT TO bluecat_api
USING (
  active = true
  AND EXISTS (
    SELECT 1
    FROM public."CompanyCategoryPermission" AS permission
    WHERE permission."categoryId" = public."Category".id
      AND permission."companyId" = public.app_current_user_company_id()
      AND permission."canView" = true
  )
);

DROP POLICY IF EXISTS article_client_select ON public."Article";

CREATE POLICY article_client_select
ON public."Article"
FOR SELECT TO bluecat_api
USING (
  status = 'PUBLISHED'::public."ArticleStatus"
  AND EXISTS (
    SELECT 1
    FROM public."CompanyCategoryPermission" AS permission
    WHERE permission."categoryId" = public."Article"."categoryId"
      AND permission."companyId" = public.app_current_user_company_id()
      AND permission."canView" = true
  )
);
