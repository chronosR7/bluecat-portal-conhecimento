import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";

/** Endpoint simples para confirmar que a aplicação e o banco estão disponíveis. */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      // Uma consulta mínima evita transformar o health check em uma operação pesada.
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        database: "up",
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        database: "down",
      });
    }
  }
}
