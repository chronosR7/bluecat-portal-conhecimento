# BlueCat Knowledge Base API

MVP do backend da Base de Conhecimento para o ERP de Varejo da BlueCat.

## O que já está coberto

- Autenticação por JWT.
- Troca obrigatória da senha provisória no primeiro acesso.
- Empresas clientes e usuários vinculados a cada empresa.
- Perfis internos: `PLATFORM_ADMIN`, `CLIENT_ADMIN`, `CLIENT_EDITOR` e `CLIENT_VIEWER`.
- Somente o `PLATFORM_ADMIN` pode criar, editar, redefinir senha ou desativar usuários. Clientes devem solicitar novos acessos à BlueCat.
- Solicitações públicas de acesso ficam pendentes até que o `PLATFORM_ADMIN` escolha a empresa e o perfil, aprove ou recuse o pedido.
- Categorias hierárquicas para montar o menu lateral do frontend.
- Artigos em rascunho, publicados ou arquivados.
- Permissão de visualização de categorias por empresa cliente.
- Endpoint de saúde verificando a conexão com o PostgreSQL.
- Seed opcional com administrador da BlueCat, cliente demo, categorias e artigo de exemplo.
- RLS no PostgreSQL, com o usuário da API separado do usuário que executa migrações.

## Stack

NestJS, TypeScript, Prisma ORM, PostgreSQL e JWT. Bootstrap e HTML/CSS ficarão no frontend, que consumirá esta API.

## Pré-requisitos

- Node.js 20 ou superior.
- npm ou pnpm.
- PostgreSQL 15 ou superior.

As instruções para Fedora KDE estão em [`docs/POSTGRES-FEDORA.md`](docs/POSTGRES-FEDORA.md).

## Executando localmente

```bash
cp .env.example .env
npm install
npm run prisma:generate

# Crie um arquivo local separado com a conexão do migrador.
cp .env.example .env.migrator
# Edite .env.migrator e troque DATABASE_URL para bluecat_migrator.
PRISMA_ENV_FILE=.env.migrator npm run prisma:deploy
PRISMA_ENV_FILE=.env.migrator npm run prisma:seed
npm run start:dev
```

A API ficará em `http://localhost:3000/api`.

O portal web fica disponível na raiz da mesma aplicação:

```text
http://localhost:3000/
```

No modo local, o frontend usa HTML/CSS/JavaScript com Bootstrap, mantém a sessão
em cookie HttpOnly e consome a API NestJS. Na publicação GitHub Pages, usa o
Supabase Auth e a Edge Function documentados abaixo. A logo fica em
`public/assets/bluecat-logo.png`.

## Publicação sem servidor próprio

Para publicar somente com GitHub Pages + Supabase, siga
[`docs/SUPABASE-GITHUB-PAGES.md`](docs/SUPABASE-GITHUB-PAGES.md). Essa versão
usa Supabase Auth, PostgreSQL com RLS e a Edge Function em
`supabase/functions/api`; o NestJS continua sendo a opção local/legada.

O arquivo `.env` da aplicação deve usar `bluecat_api`. O arquivo `.env.migrator`
é apenas local, é ignorado pelo Git e deve usar `bluecat_migrator`, que é o dono
das tabelas e o usuário usado para aplicar migrations.

Antes do seed, defina `SEED_PLATFORM_PASSWORD` e `SEED_CLIENT_PASSWORD` no
`.env.migrator`. Os valores não ficam gravados no código.

Se o schema mudar durante o desenvolvimento, crie uma nova migração com:

```bash
npm run prisma:migrate -- --name descreva-a-mudanca
```

Verificação rápida:

```bash
curl http://localhost:3000/api/health
```

## Usuários do seed

Use apenas em desenvolvimento. As senhas são lidas de
`SEED_PLATFORM_PASSWORD` e `SEED_CLIENT_PASSWORD`:

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador da plataforma | `admin@bluecat.local` | definida no ambiente |
| Administrador do cliente demo | `cliente@demo.local` | definida no ambiente |

O usuário do cliente está marcado para trocar a senha no primeiro acesso.

## Principais endpoints

| Método | Endpoint | Uso |
|---|---|---|
| POST | `/api/auth/login` | Entrar na plataforma |
| GET | `/api/auth/me` | Usuário autenticado |
| POST | `/api/auth/change-password` | Trocar senha provisória |
| GET/POST/PATCH | `/api/companies` | Administrar clientes |
| GET/POST | `/api/companies/:companyId/users` | Listar/criar usuários (somente `PLATFORM_ADMIN`) |
| PATCH/DELETE | `/api/users/:id` | Editar/desativar usuário (somente `PLATFORM_ADMIN`) |
| GET/POST/PATCH/DELETE | `/api/categories` | Administrar categorias |
| GET/POST/PATCH/DELETE | `/api/articles` | Consultar/administrar conteúdos |
| GET/PUT | `/api/companies/:companyId/category-permissions` | Liberar categorias para uma empresa |
| POST | `/api/access-requests` | Solicitar acesso sem sessão |
| GET | `/api/access-requests` | Listar solicitações para o `PLATFORM_ADMIN` |
| POST | `/api/access-requests/:id/approve` | Aprovar e criar usuário com senha temporária |
| POST | `/api/access-requests/:id/reject` | Recusar solicitação |
| GET | `/api/admin/companies/:companyId/preview/categories` | Pré-visualizar o menu de um cliente |
| GET | `/api/admin/companies/:companyId/preview/articles` | Pré-visualizar os conteúdos de um cliente |

As rotas protegidas do frontend usam o cookie de sessão HttpOnly. Integrações
externas compatíveis também podem enviar o cabeçalho:

```text
Authorization: Bearer <accessToken>
```

## Decisões importantes do MVP

1. A permissão é feita por categoria. Assim, o administrador consegue liberar ou bloquear grupos inteiros de tutoriais para cada empresa.
2. Usuários e conteúdos são desativados/arquivados em vez de apagados fisicamente, preservando histórico e referências.
3. A senha provisória aparece apenas na resposta da criação ou redefinição. Ela nunca é gravada em texto puro.
4. Uma solicitação aprovada cria o usuário com `mustChangePassword=true`; a senha temporária é mostrada uma única vez ao administrador responsável pela aprovação.
5. O frontend deverá montar o menu lateral usando `GET /api/categories`; o backend já entrega `parentId`, ordenação e a categoria pai.
6. O administrador da plataforma pode usar os endpoints de `preview` para enxergar o menu e os conteúdos exatamente dentro do recorte de categorias liberado para determinado cliente.
7. O contexto do usuário autenticado é definido dentro de uma transação antes das consultas. As policies de RLS usam esse contexto para bloquear acesso entre empresas mesmo que uma cláusula de escopo seja esquecida na aplicação.

## Segurança

Os controles de RLS, autorização, sessão, validação, CSP e resposta a
incidentes estão documentados em [`docs/SECURITY.md`](docs/SECURITY.md).

## Próximos incrementos

- Swagger/OpenAPI para documentar e testar a API.
- Editor rico para artigos e anexos/imagens.
- Auditoria de alterações.
- Permissões por artigo, além da permissão por categoria.
- Painéis administrativos e métricas de acesso.
- Recuperação de senha por e-mail.
- Testes unitários e de integração.
