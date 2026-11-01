import { ProjectsModule } from "./projects";
import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthModule } from "./auth";
import { Database } from "./database";
import { Cache } from "./cache";
@Controller("health")
class Health {
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
  ) {}
  @Get("live") live() {
    return { status: "alive" };
  }
  @Get("ready") async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      await this.cache.ping();
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException("Dependencies unavailable");
    }
  }
}
@Module({ imports: [AuthModule, ProjectsModule], controllers: [Health] })
export class AppModule {}
