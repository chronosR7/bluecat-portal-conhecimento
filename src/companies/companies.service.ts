import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";

/** CRUD de empresas sempre executado dentro do escopo do PLATFORM_ADMIN. */
@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: AuthUser) {
    this.assertPlatformAdmin(user);

    // Include de contadores alimenta os cards da área administrativa.
    return this.prisma.withUserContext(user.id, (transaction) =>
      transaction.company.findMany({
        orderBy: { name: "asc" },
        include: {
          _count: { select: { users: true, categoryPermissions: true } },
        },
      }),
    );
  }

  create(dto: CreateCompanyDto, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, (transaction) =>
      transaction.company.create({
        data: {
          name: this.requiredText(dto.name, "O nome da empresa é obrigatório."),
          document: dto.document?.trim() || undefined,
        },
      }),
    );
  }

  async findOne(id: string, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      const company = await transaction.company.findUnique({
        where: { id },
        include: {
          _count: { select: { users: true, categoryPermissions: true } },
          categoryPermissions: {
            where: { canView: true },
            include: {
              category: {
                select: { id: true, name: true, slug: true, parentId: true },
              },
            },
            orderBy: { category: { name: "asc" } },
          },
        },
      });

      if (!company) {
        throw new NotFoundException("Empresa não encontrada.");
      }

      return company;
    });
  }

  async update(id: string, dto: UpdateCompanyDto, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      // A checagem explícita produz 404 consistente antes do update.
      await this.ensureExists(transaction, id);

      return transaction.company.update({
        where: { id },
        data: {
          name:
            dto.name === undefined
              ? undefined
              : this.requiredText(dto.name, "O nome da empresa é obrigatório."),
          document: dto.document?.trim() || undefined,
          active: dto.active,
        },
      });
    });
  }

  private async ensureExists(
    transaction: Prisma.TransactionClient,
    id: string,
  ) {
    const company = await transaction.company.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!company) {
      throw new NotFoundException("Empresa não encontrada.");
    }
  }

  private assertPlatformAdmin(user: AuthUser) {
    if (user.role !== UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException(
        "Somente o administrador da plataforma pode gerenciar empresas.",
      );
    }
  }

  private requiredText(value: string, message: string) {
    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }
    return normalized;
  }
}
