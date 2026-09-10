import { ArrayMaxSize, IsArray, IsUUID } from "class-validator";

/** Lista completa de categorias liberadas para uma empresa. */
export class ReplaceCategoryAccessDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  categoryIds: string[];
}
