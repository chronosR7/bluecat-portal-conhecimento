import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/** Rejeita chamadas sem um JWT válido antes de chegar ao controller. */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
