import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AccessRequestsService } from "./access-requests.service";
import { ApproveAccessRequestDto } from "./dto/approve-access-request.dto";
import { CreateAccessRequestDto } from "./dto/create-access-request.dto";
import { RejectAccessRequestDto } from "./dto/reject-access-request.dto";

/** Entrada pública e fila administrativa de pedidos de acesso. */
@Controller("access-requests")
export class AccessRequestsController {
  constructor(private readonly accessRequestsService: AccessRequestsService) {}

  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  create(@Body() dto: CreateAccessRequestDto) {
    // Não exige login: este é o ponto de entrada de novos usuários.
    return this.accessRequestsService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  list(@CurrentUser() user: AuthUser) {
    // O decorator @Roles impede que clientes consultem a fila.
    return this.accessRequestsService.list(user);
  }

  @Post(":id/approve")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveAccessRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.accessRequestsService.approve(id, dto, user);
  }

  @Post(":id/reject")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectAccessRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.accessRequestsService.reject(id, dto, user);
  }
}
