import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthUser } from "../interfaces/auth-user.interface";

// Expõe o usuário validado pelo JwtStrategy sem repetir acesso ao request em cada rota.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
