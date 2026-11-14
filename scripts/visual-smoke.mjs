import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));
await page.goto("http://127.0.0.1:4173");
await page.getByRole("heading", { name: /Every world starts/ }).waitFor();
await page.screenshot({
  path: "test-results/studio-welcome.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "Explore an example ↗", exact: true })
  .click();
await page.getByRole("heading", { name: /Your world/, level: 1 }).waitFor();
await page.screenshot({ path: "test-results/studio-desk.png", fullPage: true });
for (const [route, title] of [
  ["entities", "World codex"],
  ["graph", "Your constellation"],
  ["relationships", "Relationships"],
  ["timeline", "Timeline"],
  ["audit", "Continuity"],
  ["ai", "World Architect"],
  ["chat", "Universe Chat"],
  ["settings", "Settings & backups"],
  ["guide", "Worlds worth getting lost in."],
]) {
  await page.goto("http://127.0.0.1:4173/#" + route);
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  if (route === "graph")
    await page.screenshot({
      path: "test-results/studio-map.png",
      fullPage: true,
    });
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:4173");
await page.getByRole("heading", { name: /Your world/, level: 1 }).waitFor();
await page.screenshot({
  path: "test-results/studio-mobile.png",
  fullPage: true,
});
console.log(
  JSON.stringify(
    {
      errors,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    },
    null,
    2,
  ),
);
await browser.close();
