import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

/** Árvore de categorias: clientes leem seu recorte; admin gerencia a estrutura. */
@Controller("categories")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.categoriesService.findAll(user);
  }

  @Post()
  @Roles(UserRole.PLATFORM_ADMIN)
  create(@Body() dto: CreateCategoryDto, @CurrentUser() user: AuthUser) {
    return this.categoriesService.create(dto, user);
  }

  @Patch(":id")
  @Roles(UserRole.PLATFORM_ADMIN)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categoriesService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles(UserRole.PLATFORM_ADMIN)
  deactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categoriesService.deactivate(id, user);
  }
}
