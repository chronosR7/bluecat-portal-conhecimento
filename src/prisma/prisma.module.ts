import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** Disponibiliza uma única instância do Prisma para todos os módulos. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
