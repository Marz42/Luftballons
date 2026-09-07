import { bootstrap } from "./bootstrap/bootstrap.js";

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Bootstrap failed";
  console.error("[Luftballons] bootstrap error:", message);
});
