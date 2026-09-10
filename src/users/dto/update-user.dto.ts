import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { UserRole } from "@prisma/client";

/** Campos administrativos, incluindo ativação e reset da senha temporária. */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  resetTemporaryPassword?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  temporaryPassword?: string;
}
