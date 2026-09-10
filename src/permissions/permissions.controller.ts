import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { ReplaceCategoryAccessDto } from "./dto/replace-category-access.dto";
import { PermissionsService } from "./permissions.service";

/** Rotas para substituir o conjunto de categorias visíveis por uma empresa. */
@Controller("companies/:companyId/category-permissions")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  list(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.permissionsService.listForCompany(companyId, user);
  }

  @Put()
  replace(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() dto: ReplaceCategoryAccessDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.permissionsService.replaceForCompany(
      companyId,
      dto.categoryIds,
      user,
    );
  }
}
