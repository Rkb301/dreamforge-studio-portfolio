// Opt-in live check. Uses an already installed model and an isolated example-world profile.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const base = "http://127.0.0.1:4185";
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, DREAMFORGE_PORT: "4185" },
  stdio: "ignore",
  windowsHide: true,
});
let browser;
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Startup only. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await mkdir("test-results/ownership", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [],
    external = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/chat") && response.status() === 200) {
      await writeFile(
        "test-results/ownership/last-model-response.json",
        await response.text(),
      );
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(r.url());
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Explore an example ↗", exact: true })
    .click();
  await page.goto(base + "/#settings");
  await page
    .getByRole("button", { name: "Find my local AI", exact: true })
    .click();
  await page.getByRole("button", { name: /llama3.2:1b/ }).click();
  await page.getByLabel("Enable local AI in Universe Chat").check();
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await page.goto(base + "/#chat");
  await page.locator("#chat-mode").selectOption("local");
  await page
    .getByLabel("Ask about your world")
    .fill(
      "Suggest one original dilemma for Mara Vey in two sentences. Label it as a suggestion.",
    );
  const chatStart = Date.now();
  await page.getByRole("button", { name: "Send ↑" }).click();
  await page.locator(".message.assistant").waitFor({ timeout: 125000 });
  const chatSeconds = (Date.now() - chatStart) / 1000;
  const reply = await page.locator(".message.assistant").innerText();
  await page.screenshot({
    path: "test-results/ownership/local-chat.png",
    fullPage: true,
  });
  await page.goto(base + "/#ai");
  await page
    .locator("#world-prompt")
    .fill(
      "Create exactly two entries: one lighthouse keeper character and one abandoned lighthouse location. Give them one Located In relationship. Keep each description to one sentence. Set them in the Orrery of Tides.",
    );
  const draftStart = Date.now();
  await page.getByRole("button", { name: "Draft with local AI ✦" }).click();
  await Promise.race([
    page
      .getByRole("heading", { name: "A new corner of your world" })
      .waitFor({ timeout: 125000 }),
    page
      .locator("#toast")
      .filter({ hasText: "Local AI stopped:" })
      .waitFor({ timeout: 125000 })
      .then(async () => {
        throw Error(await page.locator("#toast").innerText());
      }),
  ]);
  const draftSeconds = (Date.now() - draftStart) / 1000;
  await page.screenshot({
    path: "test-results/ownership/local-draft.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add approved entries" }).click();
  await page
    .getByRole("heading", { name: "World codex", exact: true })
    .waitFor();
  for (const [id, name] of [
    ["amethyst", "Amethyst"],
    ["rose", "Rose"],
    ["crimson", "Crimson"],
    ["gilded", "Gilded"],
    ["observatory", "Observatory"],
  ]) {
    await page.goto(base + "/#settings");
    await page.getByRole("button", { name: `${name} palette` }).click();
    await page.locator(`html[data-theme="${id}"]`).waitFor();
    await page.screenshot({
      path: `test-results/ownership/settings-${id}.png`,
      fullPage: true,
    });
    await page.goto(base);
    await page.getByRole("heading", { name: /Your world/, level: 1 }).waitFor();
    await page.screenshot({
      path: `test-results/ownership/desk-${id}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/#settings");
  await page.getByRole("button", { name: "Amethyst palette" }).click();
  await page.locator('html[data-theme="amethyst"]').waitFor();
  await page.screenshot({
    path: "test-results/ownership/mobile-amethyst.png",
    fullPage: true,
  });
  const result = {
    model: "llama3.2:1b",
    endpoint: "http://127.0.0.1:11435",
    chatSeconds,
    draftSeconds,
    reply,
    pageErrors: errors,
    externalBrowserRequests: external,
  };
  await writeFile(
    "test-results/ownership/live-result.json",
    JSON.stringify(result, null, 2),
  );
  if (errors.length || external.length) throw Error(JSON.stringify(result));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
