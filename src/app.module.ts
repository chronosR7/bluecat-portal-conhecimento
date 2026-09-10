import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ArticlesModule } from "./articles/articles.module";
import { AccessRequestsModule } from "./access-requests/access-requests.module";
import { AdminPreviewController } from "./admin-preview.controller";
import { AuthModule } from "./auth/auth.module";
import { CategoriesModule } from "./categories/categories.module";
import { CompaniesModule } from "./companies/companies.module";
import { HealthController } from "./health.controller";
import { PermissionsModule } from "./permissions/permissions.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";

/** Módulo raiz: registra módulos de negócio e proteções globais da aplicação. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        // Limite padrão para reduzir abuso acidental e tentativas automatizadas.
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    AccessRequestsModule,
    AuthModule,
    CompaniesModule,
    UsersModule,
    CategoriesModule,
    ArticlesModule,
    PermissionsModule,
  ],
  controllers: [HealthController, AdminPreviewController],
  // O guard é global; cada rota define perfis adicionais quando necessário.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
