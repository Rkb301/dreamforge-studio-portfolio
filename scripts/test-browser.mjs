import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Own the direct Node process rather than an npm -> shell -> Vite process tree.
// This avoids Windows Playwright webServer teardown hanging after passing tests.
const base = "http://127.0.0.1:4184";
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, DREAMFORGE_PORT: "4184" },
  stdio: "pipe",
  windowsHide: true,
});
let serverError = "";
server.stderr.on("data", (data) => (serverError += data));
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null)
      throw Error(serverError || "Test server exited.");
    try {
      const response = await fetch(base);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The direct server may still be binding its loopback socket.
    }
    await delay(100);
  }
  if (!ready) throw Error("Test server did not become ready.");
  const child = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    {
      env: { ...process.env, DREAMFORGE_TEST_URL: base },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  server.kill();
}
