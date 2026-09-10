import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { ArticleStatus } from "@prisma/client";

/** Payload de criação; o backend ainda valida slug, vídeo e publicação. */
export class CreateArticleDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(180)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100_000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;

  @IsUUID("4")
  @IsNotEmpty()
  categoryId: string;

  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;
}
