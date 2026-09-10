import { IsOptional, IsString, MaxLength } from "class-validator";

/** Motivo opcional mantido no histórico da solicitação. */
export class RejectAccessRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
