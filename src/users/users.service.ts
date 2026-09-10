import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

/** Criação, manutenção e desativação de usuários sem expor hashes de senha. */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listByCompany(companyId: string, actor: AuthUser) {
    this.assertPlatformAdmin(actor);

    return this.prisma.withUserContext(actor.id, async (transaction) => {
      await this.ensureCompany(companyId, transaction);

      return transaction.user.findMany({
        where: { companyId },
        orderBy: { name: "asc" },
        select: this.safeUserSelect(),
      });
    });
  }

  async create(companyId: string, dto: CreateUserDto, actor: AuthUser) {
    this.assertPlatformAdmin(actor);

    return this.prisma.withUserContext(actor.id, async (transaction) => {
      await this.ensureCompany(companyId, transaction);

      if (dto.role === UserRole.PLATFORM_ADMIN) {
        throw new ForbiddenException(
          "Administradores da plataforma não pertencem a uma empresa cliente.",
        );
      }

      // Se o admin não informar uma senha, gera uma aleatória para o primeiro acesso.
      const temporaryPassword =
        dto.temporaryPassword ?? randomBytes(12).toString("base64url");
      // Apenas o hash vai para o banco; a senha clara volta uma vez na resposta.
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);

      const user = await transaction.user.create({
        data: {
          companyId,
          name: this.requiredText(dto.name, "O nome do usuário é obrigatório."),
          email: dto.email.trim().toLowerCase(),
          passwordHash,
          role: dto.role ?? UserRole.CLIENT_VIEWER,
          mustChangePassword: true,
        },
        select: this.safeUserSelect(),
      });

      return { user, temporaryPassword };
    });
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser) {
    this.assertPlatformAdmin(actor);

    return this.prisma.withUserContext(actor.id, async (transaction) => {
      const currentUser = await transaction.user.findUnique({
        where: { id },
        select: { id: true, companyId: true, role: true },
      });

      if (!currentUser) {
        throw new NotFoundException("Usuário não encontrado.");
      }

      if (
        dto.role === UserRole.PLATFORM_ADMIN &&
        currentUser.companyId !== null
      ) {
        throw new ForbiddenException(
          "Usuários de uma empresa cliente não podem receber o perfil da plataforma.",
        );
      }

      if (
        currentUser.role === UserRole.PLATFORM_ADMIN &&
        dto.role !== undefined &&
        dto.role !== UserRole.PLATFORM_ADMIN
      ) {
        throw new ForbiddenException(
          "O administrador da plataforma não pode ser convertido em usuário cliente.",
        );
      }

      let temporaryPassword: string | undefined;
      const shouldResetPassword =
        dto.resetTemporaryPassword === true ||
        dto.temporaryPassword !== undefined;

      const data: {
        name?: string;
        role?: UserRole;
        active?: boolean;
        passwordHash?: string;
        mustChangePassword?: boolean;
        passwordChangedAt?: Date | null;
      } = {
        name:
          dto.name === undefined
            ? undefined
            : this.requiredText(dto.name, "O nome do usuário é obrigatório."),
        role: dto.role,
        active: dto.active,
      };

      if (shouldResetPassword) {
        // Redefinição também força o usuário a trocar a senha no próximo login.
        temporaryPassword =
          dto.temporaryPassword ?? randomBytes(12).toString("base64url");
        data.passwordHash = await bcrypt.hash(temporaryPassword, 12);
        data.mustChangePassword = true;
        data.passwordChangedAt = null;
      }

      const user = await transaction.user.update({
        where: { id },
        data,
        select: this.safeUserSelect(),
      });

      return { user, ...(temporaryPassword ? { temporaryPassword } : {}) };
    });
  }

  async deactivate(id: string, actor: AuthUser) {
    this.assertPlatformAdmin(actor);

    return this.prisma.withUserContext(actor.id, async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!user) {
        throw new NotFoundException("Usuário não encontrado.");
      }

      return transaction.user.update({
        where: { id },
        data: { active: false },
        select: this.safeUserSelect(),
      });
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

  private assertPlatformAdmin(actor: AuthUser) {
    if (actor.role !== UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException(
        "Somente a equipe BlueCat pode gerenciar usuários.",
      );
    }
  }

  private safeUserSelect() {
    // Lista centralizada impede que um novo endpoint retorne passwordHash por engano.
    return {
      id: true,
      companyId: true,
      name: true,
      email: true,
      role: true,
      mustChangePassword: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  private requiredText(value: string, message: string) {
    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }
    return normalized;
  }
}
