import { UserRole } from "@prisma/client";

/** Dados mínimos do usuário confiados pelos guards aos controllers/services. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string | null;
}
