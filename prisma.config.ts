import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma usa .env por padrão; migrations são executadas com .env.migrator.
dotenv.config({
  path: process.env.PRISMA_ENV_FILE ?? ".env",
  override: true,
});

const databaseUrl = process.env.DATABASE_URL;

// Falha cedo para não gerar migration contra um banco diferente por engano.
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL não configurada. Defina PRISMA_ENV_FILE para o arquivo de ambiente correto.",
  );
}

export default defineConfig({
  // Schema, histórico de migrations e seed ficam centralizados neste arquivo.
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: databaseUrl,
  },
});
