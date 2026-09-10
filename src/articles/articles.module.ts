import { Module } from "@nestjs/common";
import { ArticlesController } from "./articles.controller";
import { ArticlesService } from "./articles.service";

/** Agrupa endpoints e regras de artigos. */
@Module({
  controllers: [ArticlesController],
  providers: [ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
