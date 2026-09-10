import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

/** Senha atual e nova senha exigidas na troca obrigatória ou manual. */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
