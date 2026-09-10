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
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersService } from "./users.service";

/** Gestão de usuários clientes; todas as rotas são exclusivas da plataforma. */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("companies/:companyId/users")
  @Roles(UserRole.PLATFORM_ADMIN)
  listByCompany(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.listByCompany(companyId, actor);
  }

  @Post("companies/:companyId/users")
  @Roles(UserRole.PLATFORM_ADMIN)
  create(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.create(companyId, dto, actor);
  }

  @Patch("users/:id")
  @Roles(UserRole.PLATFORM_ADMIN)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.update(id, dto, actor);
  }

  @Delete("users/:id")
  @Roles(UserRole.PLATFORM_ADMIN)
  deactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.deactivate(id, actor);
  }
}
