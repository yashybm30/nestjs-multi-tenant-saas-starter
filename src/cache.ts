import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
@Injectable()
export class Cache extends Redis implements OnModuleDestroy, OnModuleInit {
  constructor() {
    super(process.env.REDIS_URL!, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });
    this.on("error", () => undefined);
  }
  async onModuleInit() {
    await this.connect();
  }
  onModuleDestroy() {
    this.disconnect();
  }
}
