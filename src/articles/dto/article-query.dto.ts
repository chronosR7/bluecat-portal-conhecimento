import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { ArticleStatus } from "@prisma/client";

/** Filtros aceitos na listagem e busca de artigos. */
export class ArticleQueryDto {
  @IsOptional()
  @IsUUID("4")
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;
}
