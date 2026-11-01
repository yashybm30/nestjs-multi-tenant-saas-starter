import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { AppModule } from "./app";
import { configure, port } from "./platform";
import { config } from "./security";
import { oauth } from "./oauth";
async function main() {
  config.parse(process.env);
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(express.json({ limit: "32kb" }));
  configure(app);
  app.use(
    (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  await oauth(app);
  await app.listen(port(), "0.0.0.0");
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
