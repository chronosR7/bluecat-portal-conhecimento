import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { join } from "node:path";
import { AppModule } from "./app.module";

/** Inicializa a API, a camada de segurança e o frontend estático. */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const isProduction = configService.get<string>("NODE_ENV") === "production";

  // Todas as rotas de negócio ficam agrupadas em /api para separar API e frontend.
  app.setGlobalPrefix("api");
  app.getHttpAdapter().getInstance().disable("x-powered-by");

  // Helmet aplica headers de segurança e a CSP limita scripts, estilos, fontes e frames.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
          styleSrc: [
            "'self'",
            "https://cdn.jsdelivr.net",
            "https://fonts.googleapis.com",
            "'unsafe-inline'",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameSrc: ["https://www.youtube-nocookie.com"],
          ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      referrerPolicy: { policy: "no-referrer" },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app
    .getHttpAdapter()
    .getInstance()
    .use(express.static(join(__dirname, "..", "public")));

  // Respostas da API nunca devem ser reutilizadas por cache intermediário.
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith("/api")) {
      response.setHeader("Cache-Control", "no-store");
    }
    next();
  });
  const allowedOrigins = (configService.get<string>("FRONTEND_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true,
  });
  const allowedOriginSet = new Set(allowedOrigins);

  // CORS controla leitura; esta checagem adicional bloqueia mutações de origens não confiáveis.
  app.use((request: Request, response: Response, next: NextFunction) => {
    const isApiRequest = request.path.startsWith("/api");
    const isReadOnly = ["GET", "HEAD", "OPTIONS"].includes(request.method);
    const origin = request.header("origin");

    if (
      allowedOrigins.length > 0 &&
      isApiRequest &&
      !isReadOnly &&
      origin &&
      !allowedOriginSet.has(origin)
    ) {
      response.status(403).json({
        statusCode: 403,
        message: "Origem não autorizada.",
      });
      return;
    }

    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      // Remove campos desconhecidos e rejeita payloads que não pertencem ao DTO.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(configService.get<string>("PORT") ?? 3000);
  // O mesmo processo serve a API e o portal web local.
  await app.listen(port);
}

void bootstrap();
