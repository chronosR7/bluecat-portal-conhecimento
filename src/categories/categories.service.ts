import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

/** Mantém a árvore de categorias e entrega somente o recorte autorizado ao cliente. */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser) {
    return this.prisma.withUserContext(user.id, async (transaction) => {
      if (user.role === UserRole.PLATFORM_ADMIN) {
        // Admin precisa da árvore completa e dos contadores para a tela de gestão.
        return transaction.category.findMany({
          where: {},
          orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
          include: {
            parent: { select: { id: true, name: true, slug: true } },
            _count: { select: { articles: true, companyPermissions: true } },
          },
        });
      }

      return this.findByCompanyAccess(this.companyIdOrThrow(user), transaction);
    });
  }

  async findForCompany(companyId: string, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      await this.ensureCompany(companyId, transaction);
      return this.findByCompanyAccess(companyId, transaction);
    });
  }

  private findByCompanyAccess(
    companyId: string,
    transaction: Prisma.TransactionClient,
  ) {
    // A relação companyPermissions é o vínculo que define o que o cliente pode ver.
    return transaction.category.findMany({
      where: {
        active: true,
        companyPermissions: {
          some: { companyId, canView: true },
        },
      },
      orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        _count: { select: { articles: true, companyPermissions: true } },
      },
    });
  }

  async create(dto: CreateCategoryDto, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      if (dto.parentId) {
        await this.ensureExists(dto.parentId, transaction);
      }

      return transaction.category.create({
        data: {
          name: this.requiredText(dto.name, "O nome da categoria é obrigatório."),
          slug: this.normalizeSlug(dto.slug),
          description: dto.description?.trim() || undefined,
          parentId: dto.parentId,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    });
  }

  async update(id: string, dto: UpdateCategoryDto, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      await this.ensureExists(id, transaction);

      if (dto.parentId === id) {
        // Evita um ciclo imediato na árvore de categorias.
        throw new BadRequestException(
          "Uma categoria não pode ser pai dela mesma.",
        );
      }

      if (dto.parentId) {
        await this.ensureExists(dto.parentId, transaction);
      }

      return transaction.category.update({
        where: { id },
        data: {
          name:
            dto.name === undefined
              ? undefined
              : this.requiredText(dto.name, "O nome da categoria é obrigatório."),
          slug: dto.slug ? this.normalizeSlug(dto.slug) : undefined,
          description: dto.description?.trim(),
          parentId: dto.parentId,
          sortOrder: dto.sortOrder,
          active: dto.active,
        },
      });
    });
  }

  async deactivate(id: string, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      await this.ensureExists(id, transaction);

      return transaction.category.update({
        where: { id },
        data: { active: false },
      });
    });
  }

  private async ensureExists(
    id: string,
    transaction: Prisma.TransactionClient,
  ) {
    const category = await transaction.category.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException("Categoria não encontrada.");
    }
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
        "Somente o administrador da plataforma pode alterar categorias.",
      );
    }
  }

  private companyIdOrThrow(user: AuthUser) {
    if (!user.companyId) {
      throw new ForbiddenException("Usuário sem empresa associada.");
    }
    return user.companyId;
  }

  private normalizeSlug(value: string) {
    // Slugs previsíveis e sem acentos são usados nas URLs e na busca interna.
    const slug = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!slug) {
      throw new BadRequestException("O slug informado é inválido.");
    }

    return slug;
  }

  private requiredText(value: string, message: string) {
    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }
    return normalized;
  }
}
