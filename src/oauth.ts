import passport from "passport";
import session from "express-session";
import { Strategy, Profile } from "passport-google-oauth20";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import { INestApplication } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth";
export async function oauth(app: INestApplication) {
  if (!process.env.GOOGLE_CLIENT_ID) return;
  if (
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.GOOGLE_CALLBACK_URL ||
    !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 48
  )
    throw new Error(
      "Complete Google OAuth and SESSION_SECRET configuration required",
    );
  const redis = createClient({ url: process.env.REDIS_URL });
  redis.on("error", () => undefined);
  await redis.connect();
  const server = app.getHttpAdapter().getInstance();
  server.use(
    "/v1/auth/google",
    session({
      store: new RedisStore({ client: redis, prefix: "oauth:" }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 600000,
      },
    }),
  );
  passport.use(
    new Strategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        state: true,
      },
      (_access: string, _refresh: string, profile: Profile, done) =>
        done(null, profile),
    ),
  );
  server.use(passport.initialize());
  server.get(
    "/v1/auth/google",
    passport.authenticate("google", {
      scope: ["openid", "email", "profile"],
      session: false,
    }),
  );
  server.get(
    "/v1/auth/google/callback",
    (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate(
        "google",
        { session: false },
        (error: Error | null, profile: Profile | false) => {
          if (error || !profile) {
            res.status(401).json({ error: "OAuth failed" });
            return;
          }
          void app
            .get(AuthService)
            .google(profile)
            .then((tokens) => {
              res.setHeader("Cache-Control", "no-store");
              res.json(tokens);
            })
            .catch(next);
        },
      )(req, res, next);
    },
  );
  app.getHttpServer().once("close", () => {
    void redis.quit();
  });
}
