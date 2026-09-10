# Publicação com Supabase + GitHub Pages

Esta é a arquitetura de produção sem servidor próprio:

```text
GitHub Pages -> public/ (HTML, CSS e JavaScript)
Supabase     -> Auth, PostgreSQL, RLS e Edge Function api
```

O NestJS/Prisma continua disponível para desenvolvimento local e referência,
mas não é executado pelo GitHub Pages. A versão publicada usa a migration em
`supabase/migrations` e a função `supabase/functions/api`.

## 1. Criar o projeto Supabase

Crie um projeto no Supabase e abra o SQL Editor. Execute o conteúdo de
`supabase/migrations/20260909000000_portal.sql`.

Não coloque a `service_role` em nenhum arquivo público. Ela será usada somente
como segredo automático da Edge Function.

## 2. Criar o administrador

Em Authentication > Users, crie um usuário com o e-mail real da BlueCat e uma
senha forte. Marque o e-mail como confirmado. Depois, ajuste o e-mail usado no
arquivo `supabase/bootstrap-admin.sql`, execute-o no SQL Editor e confirme o
perfil `PLATFORM_ADMIN` no resultado.

O usuário do Auth e o perfil em `public."User"` são a mesma conta: ambos usam o
mesmo UUID.

## 3. Publicar a Edge Function

Instale e autentique o Supabase CLI, associe o diretório ao projeto e publique:

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy api
```

No painel do Supabase, em Edge Functions > Secrets, configure:

```text
BLUECAT_SITE_URL=https://SEU_USUARIO.github.io
```

Use somente a origem, sem o nome do repositório. O navegador envia essa origem
no CORS; o caminho `/SEU_REPOSITORIO` não faz parte do header `Origin`.

As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY` e
`SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo ambiente da função. O código
valida o usuário antes de usar `service_role` para criar contas.

## 4. Configurar o frontend

Edite `public/config.js` com a URL do projeto e a chave publicável do Supabase:

```js
window.BLUECAT_CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "SUA_CHAVE_PUBLICAVEL",
};
```

A chave publicável pode estar no frontend. Nunca coloque ali a chave
`service_role`.

## 5. Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie este projeto.
2. Deixe o branch principal como `main`.
3. Em Settings > Pages, selecione GitHub Actions.
4. O workflow `.github/workflows/deploy-pages.yml` publicará a pasta `public`.
5. Use a URL exibida pelo GitHub Pages também em `BLUECAT_SITE_URL`.

O site usa caminhos relativos para funcionar tanto em `github.io` quanto em um
domínio próprio. Configure a mesma origem do site em `BLUECAT_SITE_URL`.

## Fluxo de segurança

- Login e sessões são gerenciados pelo Supabase Auth.
- O navegador usa somente a chave publicável.
- RLS filtra empresa, perfil, categoria e artigo.
- A Edge Function valida o usuário antes de operações administrativas.
- A `service_role` fica somente nos secrets do Supabase.
- Aprovação de solicitação cria o usuário no Auth e o perfil da aplicação; a
  senha temporária é retornada apenas uma vez ao administrador.

Antes do primeiro uso público, configure domínio/URL de redirecionamento do
Auth, troque qualquer credencial de desenvolvimento e faça um teste com um
cliente que não tenha permissão para a categoria de outra empresa.
