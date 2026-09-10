import { Transform } from "class-transformer";
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/** Campos aceitos no formulário público, sem dados de perfil ou senha. */
export class CreateAccessRequestDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(160)
  companyName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  companyDocument?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
