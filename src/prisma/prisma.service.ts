import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient, UserRole } from "@prisma/client";

export interface LoginUserRecord {
  id: string;
  companyId: string | null;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword: boolean;
  active: boolean;
  companyActive: boolean | null;
}

/** Prisma centralizado: conexão do banco e contexto usado pelas policies de RLS. */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      log:
        process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  async onModuleInit() {
    // Falhar cedo deixa indisponibilidade do banco visível no startup.
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs all queries for one authenticated request on the same transaction
   * and gives PostgreSQL the authenticated user id used by RLS policies.
   */
  withUserContext<T>(
    userId: string,
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.$transaction(async (transaction) => {
      // O valor é local à transação e não pode vazar para outra requisição.
      await transaction.$executeRaw`
        SELECT set_config('app.user_id', ${userId}, true)
      `;

      return callback(transaction);
    });
  }

  async findUserForLogin(email: string) {
    // Login ocorre antes do JWT; a função SQL retorna somente os campos necessários.
    const users = await this.$queryRaw<LoginUserRecord[]>`
      SELECT *
      FROM public.app_auth_lookup_user(${email})
    `;

    return users[0] ?? null;
  }
}
