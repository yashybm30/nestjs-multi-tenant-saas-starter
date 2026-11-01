import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  ServiceUnavailableException,
  HttpException,
} from "@nestjs/common";
import { IsEmail, IsString, MinLength, MaxLength } from "class-validator";
import { ApiProperty, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Database } from "./database";
import { Cache } from "./cache";
import {
  Claims,
  hashPassword,
  verifyPassword,
  hashToken,
  refreshToken,
  signAccess,
  verifyAccess,
} from "./security";
export type AuthRequest = Request & { actor: Claims };
export class Register {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) tenantName!: string;
}
export class Login {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class Refresh {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  refreshToken!: string;
}
const RATE_SCRIPT =
  "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n";
@Injectable()
export class RateLimit implements CanActivate {
  constructor(private readonly cache: Cache) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const key = `limit:${req.ip}:${req.path}`;
    let n: number;
    try {
      n = Number(await this.cache.eval(RATE_SCRIPT, 1, key, 60));
    } catch {
      throw new ServiceUnavailableException(
        "Authentication temporarily unavailable",
      );
    }
    if (n > 20)
      throw new HttpException("Too many attempts; retry after 60 seconds", 429);
    return true;
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly cache: Cache,
    private readonly db: Database,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    let claims: Claims;
    try {
      const header = req.header("authorization");
      if (!header?.startsWith("Bearer ")) throw new Error();
      claims = verifyAccess(header.slice(7));
    } catch {
      throw new UnauthorizedException("Invalid access token");
    }
    if (await this.cache.get(`revoked:${claims.familyId}`))
      throw new UnauthorizedException("Session revoked");
    const revoked = await this.db.refreshSession.count({
      where: { familyId: claims.familyId, revokedAt: { not: null } },
    });
    if (revoked) throw new UnauthorizedException("Session revoked");
    const active = await this.db.refreshSession.count({
      where: {
        familyId: claims.familyId,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!active) throw new UnauthorizedException("Session expired");
    const user = await this.db.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.tenantId !== claims.tenantId || user.role !== claims.role)
      throw new UnauthorizedException("User authorization changed");
    req.actor = claims;
    return true;
  }
}
@Injectable()
export class AuthService {
  private readonly dummy = hashPassword("dummy-password-for-timing");
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
  ) {}
  async register(input: Register) {
    const password = await hashPassword(input.password);
    try {
      const user = await this.db.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: input.tenantName },
        });
        return tx.user.create({
          data: {
            email: input.email.toLowerCase(),
            password,
            role: "admin",
            tenantId: tenant.id,
          },
        });
      });
      return this.issue(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("Account already exists");
      throw error;
    }
  }
  async login(input: Login) {
    const user = await this.db.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    const valid = await verifyPassword(
      input.password,
      user?.password ?? (await this.dummy),
    );
    if (!user || !valid) throw new UnauthorizedException("Invalid credentials");
    return this.issue(user);
  }
  async issue(
    user: { id: string; tenantId: string; role: string },
    familyId = randomUUID(),
  ) {
    const token = refreshToken();
    await this.db.refreshSession.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    return {
      accessToken: signAccess(user, familyId),
      refreshToken: token,
      tokenType: "Bearer",
      expiresIn: 900,
    };
  }
  async refresh(token: string) {
    const tokenHash = hashToken(token),
      replacement = refreshToken();
    const result = await this.db.$transaction(async (tx) => {
      const session = await tx.refreshSession.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      if (!session || session.expiresAt <= new Date())
        return { kind: "invalid" as const };
      // Serialize every refresh in a family, including concurrent rotations and replay.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${session.familyId},0))::text AS locked`;
      const current = await tx.refreshSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      const revoked = await tx.refreshSession.count({
        where: { familyId: session.familyId, revokedAt: { not: null } },
      });
      if (current.consumedAt || current.revokedAt || revoked) {
        await tx.refreshSession.updateMany({
          where: { familyId: session.familyId },
          data: { revokedAt: new Date() },
        });
        return { kind: "replay" as const, familyId: session.familyId };
      }
      await tx.refreshSession.update({
        where: { id: session.id },
        data: { consumedAt: new Date() },
      });
      await tx.refreshSession.create({
        data: {
          userId: session.userId,
          familyId: session.familyId,
          tokenHash: hashToken(replacement),
          expiresAt: session.expiresAt,
        },
      });
      return {
        kind: "ok" as const,
        user: session.user,
        familyId: session.familyId,
      };
    });
    if (result.kind === "replay") {
      await this.cache.set(`revoked:${result.familyId}`, "1", "EX", 30 * 86400);
      throw new UnauthorizedException(
        "Refresh replay detected; session revoked",
      );
    }
    if (result.kind !== "ok")
      throw new UnauthorizedException("Invalid refresh token");
    if (await this.cache.get(`revoked:${result.familyId}`))
      throw new UnauthorizedException("Session revoked");
    return {
      accessToken: signAccess(result.user, result.familyId),
      refreshToken: replacement,
      tokenType: "Bearer",
      expiresIn: 900,
    };
  }
  async logout(actor: Claims) {
    await this.cache.set(`revoked:${actor.familyId}`, "1", "EX", 30 * 86400);
    await this.db.refreshSession.updateMany({
      where: { familyId: actor.familyId, userId: actor.sub },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }
  async google(profile: {
    id: string;
    emails?: { value: string; verified?: boolean }[];
    _json?: { email_verified?: boolean };
  }) {
    const email = profile.emails
      ?.find((e) => e.verified || profile._json?.email_verified)
      ?.value?.toLowerCase();
    if (!email)
      throw new BadRequestException("Verified provider email required");
    let user = await this.db.user.findUnique({
      where: { googleId: profile.id },
    });
    if (!user) {
      if (await this.db.user.findUnique({ where: { email } }))
        throw new ConflictException(
          "Use your existing account; automatic email linking is disabled",
        );
      user = await this.db.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: "Personal workspace" },
        });
        return tx.user.create({
          data: {
            email,
            googleId: profile.id,
            tenantId: tenant.id,
            role: "admin",
          },
        });
      });
    }
    return this.issue(user);
  }
}
@Controller("v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("register") @UseGuards(RateLimit) register(@Body() body: Register) {
    return this.auth.register(body);
  }
  @Post("login") @UseGuards(RateLimit) login(@Body() body: Login) {
    return this.auth.login(body);
  }
  @Post("refresh") @UseGuards(RateLimit) refresh(@Body() body: Refresh) {
    return this.auth.refresh(body.refreshToken);
  }
  @Post("logout") @UseGuards(AuthGuard) @ApiBearerAuth() logout(
    @Req() req: AuthRequest,
  ) {
    return this.auth.logout(req.actor);
  }
  @Get("me") @UseGuards(AuthGuard) @ApiBearerAuth() me(
    @Req() req: AuthRequest,
  ) {
    return {
      id: req.actor.sub,
      tenantId: req.actor.tenantId,
      role: req.actor.role,
    };
  }
}
@Module({
  controllers: [AuthController],
  providers: [Database, Cache, AuthService, AuthGuard, RateLimit],
  exports: [Database, Cache, AuthService, AuthGuard, RateLimit],
})
export class AuthModule {}
