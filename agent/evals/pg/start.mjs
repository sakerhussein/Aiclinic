// Runs a throwaway Postgres 17 on localhost:54329 (user postgres, password test) until stopped with Ctrl+C.
// Data lives in ./data and is wiped on every start.  npm install && npm start
import fs from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

const dataDir = new URL("./data", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.rmSync(dataDir, { recursive: true, force: true });
const pg = new EmbeddedPostgres({
  databaseDir: dataDir, user: "postgres", password: "test", port: 54329, persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {},
});
await pg.initialise();
await pg.start();
console.log("READY postgresql://postgres:test@localhost:54329/postgres");
const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
