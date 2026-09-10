import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ArticleStatus, Prisma, UserRole } from "@prisma/client";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { PrismaService } from "../prisma/prisma.service";
import { ArticleQueryDto } from "./dto/article-query.dto";
import { CreateArticleDto } from "./dto/create-article.dto";
import { UpdateArticleDto } from "./dto/update-article.dto";

/** Consulta e gestão de artigos, sempre combinando filtro da API com RLS. */
@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser, query: ArticleQueryDto) {
    // Cliente recebe apenas publicados da própria empresa; admin pode filtrar status.
    return this.prisma.withUserContext(user.id, (transaction) =>
      this.findMany(
        query,
        this.scopeForUser(user),
        user.role === UserRole.PLATFORM_ADMIN,
        transaction,
        user.role === UserRole.PLATFORM_ADMIN,
      ),
    );
  }

  async findForCompany(
    companyId: string,
    query: ArticleQueryDto,
    user: AuthUser,
  ) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      await this.ensureCompany(companyId, transaction);

      return this.findMany(
        query,
        this.scopeForCompany(companyId),
        false,
        transaction,
        true,
      );
    });
  }

  private findMany(
    query: ArticleQueryDto,
    scope: Prisma.ArticleWhereInput,
    allowStatusFilter: boolean,
    transaction: Prisma.TransactionClient,
    includeAuthor: boolean,
  ) {
    // Centraliza busca, filtro de categoria/status e includes usados por portal e admin.
    const where: Prisma.ArticleWhereInput = {
      ...scope,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { summary: { contains: query.search, mode: "insensitive" } },
              { content: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(allowStatusFilter && query.status ? { status: query.status } : {}),
    };

    return transaction.article.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        category: {
          select: { id: true, name: true, slug: true, parentId: true },
        },
        ...(includeAuthor
          ? { author: { select: { id: true, name: true } } }
          : {}),
      },
    });
  }

  async findOne(id: string, user: AuthUser) {
    // Aplicar o scope na própria consulta evita IDOR por acesso direto ao UUID.
    return this.prisma.withUserContext(user.id, async (transaction) => {
      const article = await transaction.article.findFirst({
        where: { id, ...this.scopeForUser(user) },
        include: {
          category: {
            select: { id: true, name: true, slug: true, parentId: true },
          },
          ...(user.role === UserRole.PLATFORM_ADMIN
            ? { author: { select: { id: true, name: true } } }
            : {}),
        },
      });

      if (!article) {
        throw new NotFoundException("Conteúdo não encontrado.");
      }

      return article;
    });
  }

  async create(dto: CreateArticleDto, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      await this.ensureCategory(dto.categoryId, transaction);

      // Publicação registra publishedAt; rascunhos ficam invisíveis para clientes.
      const status = dto.status ?? ArticleStatus.DRAFT;
      const videoUrl = dto.videoUrl?.trim()
        ? this.normalizeYoutubeUrl(dto.videoUrl)
        : undefined;
      return transaction.article.create({
        data: {
          title: this.requiredText(dto.title, "O título é obrigatório."),
          slug: this.slugify(dto.slug?.trim() || dto.title),
          summary: dto.summary?.trim() || undefined,
          content: this.requiredText(dto.content, "O conteúdo é obrigatório."),
          videoUrl,
          status,
          categoryId: dto.categoryId,
          authorId: user.id,
          publishedAt:
            status === ArticleStatus.PUBLISHED ? new Date() : undefined,
        },
        include: {
          category: { select: { id: true, name: true, slug: true } },
        },
      });
    });
  }

  async update(id: string, dto: UpdateArticleDto, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      const current = await transaction.article.findUnique({
        where: { id },
        select: { id: true, status: true },
      });

      if (!current) {
        throw new NotFoundException("Conteúdo não encontrado.");
      }

      if (dto.categoryId) {
        await this.ensureCategory(dto.categoryId, transaction);
      }

      const status = dto.status;
      const data: Prisma.ArticleUpdateInput = {
        title:
          dto.title === undefined
            ? undefined
            : this.requiredText(dto.title, "O título é obrigatório."),
        slug: dto.slug ? this.slugify(dto.slug) : undefined,
        summary: dto.summary?.trim(),
        content:
          dto.content === undefined
            ? undefined
            : this.requiredText(dto.content, "O conteúdo é obrigatório."),
        videoUrl:
          dto.videoUrl === undefined
            ? undefined
            : dto.videoUrl.trim()
              ? this.normalizeYoutubeUrl(dto.videoUrl)
              : null,
        status,
        category: dto.categoryId
          ? { connect: { id: dto.categoryId } }
          : undefined,
      };

      if (
        status === ArticleStatus.PUBLISHED &&
        current.status !== ArticleStatus.PUBLISHED
      ) {
        data.publishedAt = new Date();
      }

      if (status && status !== ArticleStatus.PUBLISHED) {
        data.publishedAt = null;
      }

      return transaction.article.update({
        where: { id },
        data,
        include: {
          category: { select: { id: true, name: true, slug: true } },
        },
      });
    });
  }

  async archive(id: string, user: AuthUser) {
    this.assertPlatformAdmin(user);

    return this.prisma.withUserContext(user.id, async (transaction) => {
      const current = await transaction.article.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!current) {
        throw new NotFoundException("Conteúdo não encontrado.");
      }

      return transaction.article.update({
        where: { id },
        data: { status: ArticleStatus.ARCHIVED, publishedAt: null },
      });
    });
  }

  private scopeForUser(user: AuthUser): Prisma.ArticleWhereInput {
    // Admin não tem recorte de empresa; qualquer outro usuário precisa estar vinculado.
    if (user.role === UserRole.PLATFORM_ADMIN) {
      return {};
    }

    if (!user.companyId) {
      throw new ForbiddenException("Usuário sem empresa associada.");
    }

    return this.scopeForCompany(user.companyId);
  }

  private scopeForCompany(companyId: string): Prisma.ArticleWhereInput {
    return {
      status: ArticleStatus.PUBLISHED,
      category: {
        companyPermissions: {
          some: { companyId, canView: true },
        },
      },
    };
  }

  private assertPlatformAdmin(user: AuthUser) {
    if (user.role !== UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException(
        "Somente o administrador da plataforma pode alterar conteúdos.",
      );
    }
  }

  private async ensureCategory(
    categoryId: string,
    transaction: Prisma.TransactionClient,
  ) {
    const category = await transaction.category.findUnique({
      where: { id: categoryId },
      select: { id: true, active: true },
    });

    if (!category || !category.active) {
      throw new NotFoundException("Categoria ativa não encontrada.");
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

  private slugify(value: string) {
    const slug = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!slug) {
      throw new BadRequestException("O slug gerado é inválido.");
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

  private normalizeYoutubeUrl(value: string) {
    let url: URL;

    try {
      url = new URL(value.trim());
    } catch {
      throw new BadRequestException("Informe uma URL válida do YouTube.");
    }

    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const supportedHosts = new Set([
      "youtube.com",
      "youtu.be",
      "youtube-nocookie.com",
    ]);

    if (!supportedHosts.has(hostname)) {
      throw new BadRequestException(
        "O vídeo precisa estar hospedado no YouTube.",
      );
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const videoId =
      hostname === "youtu.be"
        ? segments[0]
        : url.searchParams.get("v") ??
          (segments[0] && ["embed", "shorts", "live"].includes(segments[0])
            ? segments[1]
            : undefined);

    if (!videoId || !/^[\w-]{6,100}$/.test(videoId)) {
      throw new BadRequestException(
        "Não foi possível identificar o vídeo nessa URL do YouTube.",
      );
    }

    return `https://www.youtube.com/watch?v=${videoId}`;
  }
}
