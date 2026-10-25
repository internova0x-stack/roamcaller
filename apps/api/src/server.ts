import { connect } from "@roam/db";
import { roamBuddyFromEnv } from "@roam/core";
import { buildApp } from "./app.ts";

const { db } = connect();
const app = buildApp({ db, rbFor: roamBuddyFromEnv(), logger: { level: process.env.LOG_LEVEL ?? "info" } });

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
