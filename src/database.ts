import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
@Injectable()
export class Database
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
    const roles = await this.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    if (roles[0]?.rolsuper || roles[0]?.rolbypassrls)
      throw new Error("Runtime database role must not bypass RLS");
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  withTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
      return fn(tx);
    });
  }
}
