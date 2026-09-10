import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { AuthUser } from "../interfaces/auth-user.interface";

/** Aplica a autorização declarada com @Roles depois que o JWT foi validado. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Rotas sem @Roles exigem autenticação, mas não restringem um perfil específico.
    if (!roles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    return Boolean(request.user && roles.includes(request.user.role));
  }
}
