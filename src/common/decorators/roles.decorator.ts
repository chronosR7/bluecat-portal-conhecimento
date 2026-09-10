import { SetMetadata } from "@nestjs/common";
import { UserRole } from "@prisma/client";

// Chave usada pelo RolesGuard para saber quais perfis podem executar uma rota.
export const ROLES_KEY = "roles";
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
