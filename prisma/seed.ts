import dotenv from "dotenv";
import { ArticleStatus, PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";

dotenv.config({
  path: process.env.PRISMA_ENV_FILE ?? ".env",
  override: true,
});

const prisma = new PrismaClient();

/** Cria dados mínimos para desenvolvimento local sem depender de dados reais. */
async function main() {
  // As senhas vêm do ambiente para não ficarem gravadas no repositório.
  const platformPassword = process.env.SEED_PLATFORM_PASSWORD;
  const clientPassword = process.env.SEED_CLIENT_PASSWORD;

  if (!platformPassword || !clientPassword) {
    throw new Error(
      "Defina SEED_PLATFORM_PASSWORD e SEED_CLIENT_PASSWORD no ambiente antes de executar o seed.",
    );
  }

  const platformPasswordHash = await bcrypt.hash(platformPassword, 12);
  const clientPasswordHash = await bcrypt.hash(clientPassword, 12);

  // Admin sem empresa: é a conta que administra o conteúdo e os clientes.
  const platformAdmin = await prisma.user.upsert({
    where: { email: "admin@bluecat.local" },
    update: {
      name: "Administrador BlueCat",
      passwordHash: platformPasswordHash,
      role: UserRole.PLATFORM_ADMIN,
      mustChangePassword: false,
      active: true,
      companyId: null,
    },
    create: {
      name: "Administrador BlueCat",
      email: "admin@bluecat.local",
      passwordHash: platformPasswordHash,
      role: UserRole.PLATFORM_ADMIN,
      mustChangePassword: false,
      active: true,
    },
  });

  // Empresa e usuário demo permitem testar o recorte de acesso localmente.
  const company = await prisma.company.upsert({
    where: { document: "00000000000100" },
    update: { name: "Cliente Demo BlueCat", active: true },
    create: {
      name: "Cliente Demo BlueCat",
      document: "00000000000100",
    },
  });

  const clientAdmin = await prisma.user.upsert({
    where: { email: "cliente@demo.local" },
    update: {
      companyId: company.id,
      name: "Administrador Cliente Demo",
      passwordHash: clientPasswordHash,
      role: UserRole.CLIENT_ADMIN,
      mustChangePassword: true,
      active: true,
    },
    create: {
      companyId: company.id,
      name: "Administrador Cliente Demo",
      email: "cliente@demo.local",
      passwordHash: clientPasswordHash,
      role: UserRole.CLIENT_ADMIN,
      mustChangePassword: true,
      active: true,
    },
  });

  const cadastro = await prisma.category.upsert({
    where: { slug: "cadastro" },
    update: { name: "Cadastro", active: true, parentId: null, sortOrder: 1 },
    create: { name: "Cadastro", slug: "cadastro", sortOrder: 1 },
  });

  const produtos = await prisma.category.upsert({
    where: { slug: "cadastro-produtos" },
    update: {
      name: "Produtos",
      parentId: cadastro.id,
      active: true,
      sortOrder: 1,
    },
    create: {
      name: "Produtos",
      slug: "cadastro-produtos",
      parentId: cadastro.id,
      sortOrder: 1,
    },
  });

  const configuracao = await prisma.category.upsert({
    where: { slug: "configuracao" },
    update: {
      name: "Configuração",
      active: true,
      parentId: null,
      sortOrder: 2,
    },
    create: { name: "Configuração", slug: "configuracao", sortOrder: 2 },
  });

  // Libera todas as categorias de exemplo para o cliente demo.
  await prisma.companyCategoryPermission.createMany({
    data: [cadastro.id, produtos.id, configuracao.id].map((categoryId) => ({
      companyId: company.id,
      categoryId,
      canView: true,
    })),
    skipDuplicates: true,
  });

  // Artigo publicado usado para validar a navegação do portal.
  await prisma.article.upsert({
    where: { slug: "como-cadastrar-um-produto" },
    update: {
      title: "Como cadastrar um produto",
      categoryId: produtos.id,
      authorId: platformAdmin.id,
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
    },
    create: {
      title: "Como cadastrar um produto",
      slug: "como-cadastrar-um-produto",
      summary: "Passo a passo inicial para cadastrar um produto no ERP.",
      content:
        "# Cadastro de produto\n\n1. Acesse o menu **Cadastro**.\n2. Abra **Produtos**.\n3. Clique em **Novo produto**.\n4. Preencha os campos obrigatórios e salve.",
      categoryId: produtos.id,
      authorId: platformAdmin.id,
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });

  console.log("Seed concluído.");
  console.log(`Administrador criado/atualizado: ${platformAdmin.email}`);
  console.log(`Cliente demo criado/atualizado: ${clientAdmin.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
