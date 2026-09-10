import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { PrismaService } from "../prisma/prisma.service";

/** Mantém o recorte de conteúdo que cada empresa cliente pode consultar. */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForCompany(companyId: string, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      await this.ensureCompany(companyId, transaction);
      return this.listForCompanyWithTransaction(companyId, transaction);
    });
  }

  async replaceForCompany(
    companyId: string,
    categoryIds: string[],
    user: AuthUser,
  ) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      await this.ensureCompany(companyId, transaction);

      // Remove duplicidades antes de validar e substituir as permissões atuais.
      const uniqueCategoryIds = [...new Set(categoryIds)];
      const categories = await transaction.category.findMany({
        where: { id: { in: uniqueCategoryIds }, active: true },
        select: { id: true },
      });

      if (categories.length !== uniqueCategoryIds.length) {
        throw new BadRequestException(
          "Uma ou mais categorias não existem ou estão inativas.",
        );
      }

      await transaction.companyCategoryPermission.deleteMany({
        where: { companyId },
      });

      // A operação é um replace completo: categorias não selecionadas deixam de aparecer.
      if (uniqueCategoryIds.length > 0) {
        await transaction.companyCategoryPermission.createMany({
          data: uniqueCategoryIds.map((categoryId) => ({
            companyId,
            categoryId,
            canView: true,
          })),
        });
      }

      return this.listForCompanyWithTransaction(companyId, transaction);
    });
  }

  private listForCompanyWithTransaction(
    companyId: string,
    transaction: Prisma.TransactionClient,
  ) {
    return transaction.companyCategoryPermission.findMany({
      where: { companyId, canView: true },
      orderBy: { category: { name: "asc" } },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            parentId: true,
            active: true,
          },
        },
      },
    });
  }

  private async ensureCompany(
    companyId: string,
    transaction: Prisma.TransactionClient,
  ) {
    const company = await transaction.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });

    if (!company) {
      throw new NotFoundException("Empresa não encontrada.");
    }
  }

  private assertPlatformAdmin(user: AuthUser) {
    if (user.role !== UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException(
        "Somente o administrador da plataforma pode gerenciar permissões.",
      );
    }
  }
}
