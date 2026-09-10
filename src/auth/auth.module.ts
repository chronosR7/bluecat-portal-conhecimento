import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";

/** Configura Passport/JWT e injeta o segredo somente via ambiente. */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // A aplicação não inicia com segredo ausente, curto ou valor de exemplo.
        const secret = configService.get<string>("JWT_SECRET");

        if (
          !secret ||
          secret.length < 32 ||
          secret === "troque-esta-chave-por-uma-chave-longa-e-aleatoria"
        ) {
          throw new Error(
            "JWT_SECRET ausente ou fraco. Use uma chave aleatória com pelo menos 32 caracteres.",
          );
        }

        return {
          secret,
          signOptions: {
            expiresIn: Number(
              configService.get<string>("JWT_EXPIRES_IN_SECONDS") ?? 900,
            ),
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
