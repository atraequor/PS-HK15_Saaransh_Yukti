const fs = require("fs");
const path = require("path");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(path.join(process.cwd(), "servers", "node_modules", "playwright")));
}

const BASE_URL = "http://127.0.0.1:3000";
const OUT_DIR = path.join(process.cwd(), "visual-audit");
const SHOT_DIR = path.join(OUT_DIR, "screenshots");

const pages = [
  "/sites/login.html",
  "/sites/project.html",
  "/sites/copilot.html",
  "/sites/crop_scan.html",
  "/sites/crop-info.html",
  "/sites/weather.html",
  "/sites/agri-news.html",
  "/sites/community.html",
  "/sites/what-if.html",
  "/sites/profile.html",
];

const viewports = [
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

const tokenPayload = Buffer.from(
  JSON.stringify({
    id: 1,
    email: "visual@test.local",
    full_name: "Visual Tester",
    role: "farmer",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
  })
)
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");
const fakeToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${tokenPayload}.signature`;

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function run() {
  await ensureDir(SHOT_DIR);
  const browser = await chromium.launch({ headless: true });
  const findings = [];

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
    });
    await context.addInitScript(([token]) => {
      localStorage.setItem("fm_token", token);
      localStorage.setItem(
        "fm_user",
        JSON.stringify({
          id: 1,
          full_name: "Visual Tester",
          email: "visual@test.local",
          role: "farmer",
        })
      );
    }, [fakeToken]);

    for (const pagePath of pages) {
      const page = await context.newPage();
      const pageName = pagePath.split("/").pop().replace(".html", "");
      const key = `${pageName}-${vp.name}`;
      const url = `${BASE_URL}${pagePath}`;
      const consoleErrors = [];
      page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(`console: ${msg.text()}`);
      });

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1200);
        await page.screenshot({
          path: path.join(SHOT_DIR, `${key}.png`),
          fullPage: true,
        });

        const visual = await page.evaluate(() => {
          const html = document.documentElement;
          const body = document.body;
          const vw = window.innerWidth;
          const overflowX = Math.max(html.scrollWidth, body.scrollWidth) - vw;
          const offenders = [];

          for (const el of Array.from(document.querySelectorAll("*"))) {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            if (r.right > vw + 1 || r.left < -1) {
              offenders.push({
                tag: el.tagName.toLowerCase(),
                cls: el.className || "",
                id: el.id || "",
                left: Math.round(r.left),
                right: Math.round(r.right),
                width: Math.round(r.width),
              });
              if (offenders.length >= 20) break;
            }
          }

          return {
            title: document.title,
            overflowX,
            offenders,
          };
        });

        findings.push({
          key,
          url,
          viewport: vp,
          title: visual.title,
          overflowX: visual.overflowX,
          offenders: visual.offenders,
          consoleErrors,
        });
      } catch (err) {
        findings.push({
          key,
          url,
          viewport: vp,
          title: "",
          overflowX: null,
          offenders: [],
          consoleErrors: [...consoleErrors, `navigation: ${err.message}`],
        });
      } finally {
        await page.close();
      }
    }
    await context.close();
  }

  await browser.close();
  await fs.promises.writeFile(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(findings, null, 2),
    "utf8"
  );

  const problemCount = findings.filter(
    (f) => (f.overflowX && f.overflowX > 1) || f.consoleErrors.length > 0
  ).length;
  console.log(`Audit completed. Entries=${findings.length}, problems=${problemCount}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
