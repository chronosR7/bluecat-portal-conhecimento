import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Roles } from "./common/decorators/roles.decorator";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { AuthUser } from "./common/interfaces/auth-user.interface";
import { ArticlesService } from "./articles/articles.service";
import { ArticleQueryDto } from "./articles/dto/article-query.dto";
import { CategoriesService } from "./categories/categories.service";
import { CurrentUser } from "./common/decorators/current-user.decorator";

/** Permite ao admin enxergar o portal com o recorte de uma empresa cliente. */
@Controller("admin/companies")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN)
export class AdminPreviewController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly articlesService: ArticlesService,
  ) {}

  @Get(":companyId/preview/categories")
  previewCategories(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    // O service reaplica as permissões da empresa; o ID não é uma autorização.
    return this.categoriesService.findForCompany(companyId, user);
  }

  @Get(":companyId/preview/articles")
  previewArticles(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Query() query: ArticleQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    // A pré-visualização usa o mesmo filtro de artigos que o cliente usaria.
    return this.articlesService.findForCompany(companyId, query, user);
  }
}
