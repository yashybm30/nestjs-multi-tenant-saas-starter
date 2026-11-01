import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength, MaxLength } from "class-validator";
import { AuthGuard, AuthModule, AuthRequest } from "./auth";
import { Database } from "./database";
import { Cache } from "./cache";
export class NewProject {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
}
@Injectable()
export class Maintenance implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly db: Database) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.run().catch(() =>
        console.error(JSON.stringify({ event: "tenant-maintenance-failed" })),
      );
    }, 3600000);
    this.timer.unref();
  }
  async run() {
    const tenants = await this.db.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants)
      await this.db.withTenant(tenant.id, async (tx) => {
        await tx.audit.deleteMany({
          where: {
            tenantId: tenant.id,
            createdAt: { lt: new Date(Date.now() - 90 * 86400000) },
          },
        });
      });
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
@Controller("v1/projects")
@UseGuards(AuthGuard)
@ApiBearerAuth()
class Projects {
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
  ) {}
  private async invalidate(tenant: string) {
    try {
      await this.cache.incr(`projects:version:${tenant}`);
    } catch {
      /* TTL bounds stale reads if cache invalidation is unavailable. */
    }
  }
  @Get() async list(@Req() req: AuthRequest, @Query("page") rawPage = "1") {
    const page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new ForbiddenException("Invalid page");
    const tenant = req.actor.tenantId;
    // Versioned cache keys prevent an in-flight read from repopulating an invalidated key.
    let key: string | undefined;
    try {
      const version =
        (await this.cache.get(`projects:version:${tenant}`)) ?? "0";
      key = `projects:${tenant}:${version}:${page}`;
      const cached = await this.cache.get(key);
      if (cached) return JSON.parse(cached) as unknown;
    } catch {
      /* Database fallback. */
    }
    const result = await this.db.withTenant(tenant, async (tx) => ({
      items: await tx.project.findMany({
        where: { tenantId: tenant },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        skip: (page - 1) * 20,
      }),
      page,
      pageSize: 20,
      total: await tx.project.count({ where: { tenantId: tenant } }),
    }));
    if (key)
      try {
        await this.cache.set(key, JSON.stringify(result), "EX", 30);
      } catch {
        /* Cache is an optimization. */
      }
    return result;
  }
  @Post() async create(@Req() req: AuthRequest, @Body() input: NewProject) {
    if (req.actor.role !== "admin")
      throw new ForbiddenException("Admin required");
    const project = await this.db.withTenant(req.actor.tenantId, async (tx) => {
      const p = await tx.project.create({
        data: { tenantId: req.actor.tenantId, name: input.name },
      });
      await tx.audit.create({
        data: {
          tenantId: req.actor.tenantId,
          actorId: req.actor.sub,
          action: "project.created",
          resourceId: p.id,
        },
      });
      return p;
    });
    await this.invalidate(req.actor.tenantId);
    return project;
  }
  @Get(":id") async get(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const project = await this.db.withTenant(req.actor.tenantId, (tx) =>
      tx.project.findFirst({ where: { id, tenantId: req.actor.tenantId } }),
    );
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }
  @Delete(":id") async remove(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    if (req.actor.role !== "admin")
      throw new ForbiddenException("Admin required");
    await this.db.withTenant(req.actor.tenantId, async (tx) => {
      const removed = await tx.project.deleteMany({
        where: { id, tenantId: req.actor.tenantId },
      });
      if (!removed.count) throw new NotFoundException("Project not found");
      await tx.audit.create({
        data: {
          tenantId: req.actor.tenantId,
          actorId: req.actor.sub,
          action: "project.deleted",
          resourceId: id,
        },
      });
    });
    await this.invalidate(req.actor.tenantId);
    return { deleted: true };
  }
}
@Module({
  imports: [AuthModule],
  controllers: [Projects],
  providers: [Maintenance],
})
export class ProjectsModule {}
