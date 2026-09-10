import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { PrismaService } from "../prisma/prisma.service";
import { ACCESS_TOKEN_COOKIE } from "./auth.constants";

interface JwtPayload {
  sub: string;
}

/** Extrai o JWT do cookie web ou do Authorization Bearer para integrações. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>("JWT_SECRET");

    if (
      !secret ||
      secret.length < 32 ||
      secret === "troque-esta-chave-por-uma-chave-longa-e-aleatoria"
    ) {
      throw new Error(
        "JWT_SECRET ausente ou fraco. Use uma chave aleatória com pelo menos 32 caracteres.",
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: { headers?: { cookie?: string } }) => {
          // O cookie é HttpOnly; o navegador envia, mas o JavaScript não lê.
          const cookieHeader = request.headers?.cookie ?? "";
          const cookie = cookieHeader
            .split(";")
            .map((item) => item.trim())
            .find((item) => item.startsWith(`${ACCESS_TOKEN_COOKIE}=`));

          if (!cookie) return null;

          try {
            return decodeURIComponent(
              cookie.slice(ACCESS_TOKEN_COOKIE.length + 1),
            );
          } catch {
            return null;
          }
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    // Cada request consulta o estado atual do usuário dentro do contexto de RLS.
    return this.prisma.withUserContext(payload.sub, async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          companyId: true,
          active: true,
          company: { select: { active: true } },
        },
      });

      if (!user || !user.active || (user.company && !user.company.active)) {
        throw new UnauthorizedException("Usuário não autorizado.");
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      };
    });
  }
}
