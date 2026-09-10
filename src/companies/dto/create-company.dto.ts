import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Dados mínimos para cadastrar uma empresa cliente. */
export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  document?: string;
}
