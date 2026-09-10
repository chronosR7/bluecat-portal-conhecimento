import {
  Body,
  Controller,
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
import { CompaniesService } from "./companies.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";

/** Empresas são dados internos da BlueCat e não ficam disponíveis ao cliente. */
@Controller("companies")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @Roles(UserRole.PLATFORM_ADMIN)
  findAll(@CurrentUser() user: AuthUser) {
    return this.companiesService.findAll(user);
  }

  @Post()
  @Roles(UserRole.PLATFORM_ADMIN)
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: AuthUser) {
    return this.companiesService.create(dto, user);
  }

  @Get(":id")
  @Roles(UserRole.PLATFORM_ADMIN)
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companiesService.findOne(id, user);
  }

  @Patch(":id")
  @Roles(UserRole.PLATFORM_ADMIN)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companiesService.update(id, dto, user);
  }
}
