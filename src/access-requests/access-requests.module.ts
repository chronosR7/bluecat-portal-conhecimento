import { Module } from "@nestjs/common";
import { AccessRequestsController } from "./access-requests.controller";
import { AccessRequestsService } from "./access-requests.service";

/** Encapsula controller e regras do fluxo de aprovação de acessos. */
@Module({
  controllers: [AccessRequestsController],
  providers: [AccessRequestsService],
})
export class AccessRequestsModule {}
