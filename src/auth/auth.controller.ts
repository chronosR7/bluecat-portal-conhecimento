import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/interfaces/auth-user.interface";
import { AuthService } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { ACCESS_TOKEN_COOKIE } from "./auth.constants";

/** Endpoints de sessão: login, logout, usuário atual e troca de senha. */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    // O token nunca é devolvido para armazenamento no frontend; fica em cookie HttpOnly.
    const result = await this.authService.login(dto);
    response.cookie(ACCESS_TOKEN_COOKIE, result.accessToken, {
      httpOnly: true,
      secure: this.isProduction(),
      sameSite: "lax",
      maxAge: this.sessionMaxAgeMs(),
      path: "/",
    });

    return {
      tokenType: "Bearer",
      mustChangePassword: result.mustChangePassword,
      user: result.user,
    };
  }

  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response) {
    // Limpa o mesmo cookie e mantém o logout idempotente.
    response.clearCookie(ACCESS_TOKEN_COOKIE, {
      httpOnly: true,
      secure: this.isProduction(),
      sameSite: "lax",
      path: "/",
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post("change-password")
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  private isProduction() {
    return this.configService.get<string>("NODE_ENV") === "production";
  }

  private sessionMaxAgeMs() {
    const seconds = Number(
      this.configService.get<string>("JWT_EXPIRES_IN_SECONDS") ?? 900,
    );
    return Math.max(60, Number.isFinite(seconds) ? seconds : 900) * 1000;
  }
}
