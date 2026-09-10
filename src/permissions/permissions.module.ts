import { Module } from "@nestjs/common";
import { PermissionsController } from "./permissions.controller";
import { PermissionsService } from "./permissions.service";

/** Agrupa a substituição das permissões de categoria por empresa. */
@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
