import { connect, runMigrations } from "./index.ts";

const { db, close } = connect();
await runMigrations(db);
await close();
console.log("Migrations applied");
