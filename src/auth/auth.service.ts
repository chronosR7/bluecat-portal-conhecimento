import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";

/** Regras de autenticação e troca de senha; nunca retorna passwordHash. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    // A busca usa uma função SQL controlada porque ainda não existe contexto JWT.
    const user = await this.prisma.findUserForLogin(dto.email);

    if (
      !user ||
      !user.active ||
      (user.companyId && !user.companyActive) ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException("E-mail ou senha inválidos.");
    }

    // O payload contém apenas o identificador; dados do usuário são recarregados no guard.
    const accessToken = await this.jwtService.signAsync({ sub: user.id });

    return {
      accessToken,
      tokenType: "Bearer",
      mustChangePassword: user.mustChangePassword,
      user: this.toSafeUser({
        ...user,
        company: user.companyId ? { active: user.companyActive } : null,
      }),
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    // A troca ocorre na mesma transação com RLS vinculada ao usuário autenticado.
    return this.prisma.withUserContext(userId, async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.active) {
        throw new UnauthorizedException("Usuário não autorizado.");
      }

      const currentPasswordIsValid = await bcrypt.compare(
        dto.currentPassword,
        user.passwordHash,
      );

      if (!currentPasswordIsValid) {
        throw new UnauthorizedException("Senha atual inválida.");
      }

      if (dto.currentPassword === dto.newPassword) {
        throw new UnauthorizedException(
          "A nova senha precisa ser diferente da senha atual.",
        );
      }

      const passwordHash = await bcrypt.hash(dto.newPassword, 12);
      // mustChangePassword libera o usuário depois da troca inicial/provisória.
      const updatedUser = await transaction.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
      });

      return {
        message: "Senha alterada com sucesso.",
        user: this.toSafeUser(updatedUser),
      };
    });
  }

  async me(userId: string) {
    // Revalida o usuário no banco para impedir sessão de conta desativada.
    return this.prisma.withUserContext(userId, async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id: userId },
        include: {
          company: {
            select: { id: true, name: true, document: true, active: true },
          },
        },
      });

      if (!user || !user.active) {
        throw new NotFoundException("Usuário não encontrado.");
      }

      return this.toSafeUser(user);
    });
  }

  private toSafeUser(user: {
    id: string;
    name: string;
    email: string;
    role: string;
    companyId: string | null;
    mustChangePassword: boolean;
    active: boolean;
    company?: unknown;
  }) {
    // Resposta pública segura: credenciais e campos internos ficam fora do contrato.
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      mustChangePassword: user.mustChangePassword,
      active: user.active,
      ...(user.company !== undefined ? { company: user.company } : {}),
    };
  }
}
