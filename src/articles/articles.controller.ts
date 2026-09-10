import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { ArticlesService } from "./articles.service";
import { ArticleQueryDto } from "./dto/article-query.dto";
import { CreateArticleDto } from "./dto/create-article.dto";
import { UpdateArticleDto } from "./dto/update-article.dto";

/** Leitura de conteúdos para clientes e gestão completa para PLATFORM_ADMIN. */
@Controller("articles")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ArticleQueryDto) {
    return this.articlesService.findAll(user, query);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.articlesService.findOne(id, user);
  }

  @Post()
  @Roles(UserRole.PLATFORM_ADMIN)
  create(@Body() dto: CreateArticleDto, @CurrentUser() user: AuthUser) {
    return this.articlesService.create(dto, user);
  }

  @Patch(":id")
  @Roles(UserRole.PLATFORM_ADMIN)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateArticleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.articlesService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles(UserRole.PLATFORM_ADMIN)
  archive(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.articlesService.archive(id, user);
  }
}
