import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AccessRequestStatus, Prisma, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { PrismaService } from "../prisma/prisma.service";
import { ApproveAccessRequestDto } from "./dto/approve-access-request.dto";
import { CreateAccessRequestDto } from "./dto/create-access-request.dto";
import { RejectAccessRequestDto } from "./dto/reject-access-request.dto";

/** Fila de aprovação: solicitação pública, análise administrativa e criação do usuário. */
@Injectable()
export class AccessRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAccessRequestDto) {
    const name = this.requiredText(dto.name, "Informe seu nome.");
    const email = dto.email.trim().toLowerCase();
    const companyName = this.requiredText(
      dto.companyName,
      "Informe o nome da empresa.",
    );
    const companyDocument = dto.companyDocument?.trim() || null;
    const message = dto.message?.trim() || null;

    try {
      // A tabela não possui SELECT público por RLS. Um INSERT direto evita
      // que o RETURNING do Prisma transforme o pedido público em leitura.
      await this.prisma.$executeRaw`
        INSERT INTO public."AccessRequest"
          ("id", "name", "email", "companyName", "companyDocument", "message", "status", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), ${name}, ${email}, ${companyName}, ${companyDocument}, ${message}, 'PENDING'::public."AccessRequestStatus", now(), now())
      `;
      return { status: AccessRequestStatus.PENDING };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2010" &&
        String(error.message).includes("23505")
      ) {
        throw new ConflictException(
          "Já existe uma solicitação pendente para este e-mail.",
        );
      }
      throw error;
    }
  }

  list(user: AuthUser) {
    this.assertPlatformAdmin(user);

    // O contexto do admin libera a leitura da fila pela policy de RLS.
    return this.prisma.withUserContext(user.id, (transaction) =>
      transaction.accessRequest.findMany({
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      }),
    );
  }

  async approve(
    id: string,
    dto: ApproveAccessRequestDto,
    user: AuthUser,
  ) {
    this.assertPlatformAdmin(user);

    // Aprovação e criação do usuário são atômicas: ou as duas ocorrem, ou nenhuma.
    return this.prisma.withUserContext(user.id, async (transaction) => {
      const request = await transaction.accessRequest.findUnique({
        where: { id },
      });

      if (!request) {
        throw new NotFoundException("Solicitação não encontrada.");
      }
      if (request.status !== AccessRequestStatus.PENDING) {
        throw new ConflictException("Esta solicitação já foi analisada.");
      }
      if (dto.role === UserRole.PLATFORM_ADMIN) {
        throw new BadRequestException(
          "Uma solicitação de cliente não pode receber o perfil da plataforma.",
        );
      }

      const company = await transaction.company.findUnique({
        where: { id: dto.companyId },
        select: { id: true, active: true },
      });
      if (!company || !company.active) {
        throw new BadRequestException("A empresa selecionada está inativa ou não existe.");
      }

      const existingUser = await transaction.user.findUnique({
        where: { email: request.email },
        select: { id: true },
      });
      if (existingUser) {
        throw new ConflictException(
          "Já existe um usuário cadastrado com este e-mail.",
        );
      }

      // A senha clara existe somente na memória e é devolvida uma única vez ao admin.
      const temporaryPassword = randomBytes(12).toString("base64url");
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);
      const role = dto.role ?? UserRole.CLIENT_VIEWER;

      const createdUser = await transaction.user.create({
        data: {
          companyId: company.id,
          name: request.name,
          email: request.email,
          passwordHash,
          role,
          mustChangePassword: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          companyId: true,
          mustChangePassword: true,
          active: true,
        },
      });

      const updatedRequest = await transaction.accessRequest.update({
        where: { id },
        data: {
          status: AccessRequestStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedById: user.id,
        },
      });

      return { request: updatedRequest, user: createdUser, temporaryPassword };
    });
  }

  reject(id: string, dto: RejectAccessRequestDto, user: AuthUser) {
    this.assertPlatformAdmin(user);

    // Rejeitar mantém o histórico e permite que o mesmo e-mail solicite novamente depois.
    return this.prisma.withUserContext(user.id, async (transaction) => {
      const request = await transaction.accessRequest.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!request) {
        throw new NotFoundException("Solicitação não encontrada.");
      }
      if (request.status !== AccessRequestStatus.PENDING) {
        throw new ConflictException("Esta solicitação já foi analisada.");
      }

      return transaction.accessRequest.update({
        where: { id },
        data: {
          status: AccessRequestStatus.REJECTED,
          rejectionReason: dto.reason?.trim() || undefined,
          reviewedAt: new Date(),
          reviewedById: user.id,
        },
      });
    });
  }

  private assertPlatformAdmin(user: AuthUser) {
    if (user.role !== UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException(
        "Somente o administrador da plataforma pode analisar solicitações.",
      );
    }
  }

  private requiredText(value: string, message: string) {
    const normalized = value.trim();
    if (!normalized) throw new BadRequestException(message);
    return normalized;
  }
}
