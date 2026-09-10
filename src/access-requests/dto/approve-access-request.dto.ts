import { IsEnum, IsOptional, IsUUID } from "class-validator";
import { UserRole } from "@prisma/client";

/** Dados que o admin define no momento da liberação. */
export class ApproveAccessRequestDto {
  @IsUUID()
  companyId: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
