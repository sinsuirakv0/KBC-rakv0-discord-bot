import { chromium } from "playwright";

const DEFAULT_EVENT_SITE_URL = "https://kbc-rakv0-event.vercel.app/";

function fallbackHistoryUrl(): string {
  const base = process.env.EVENT_SITE_URL ?? DEFAULT_EVENT_SITE_URL;
  const url = new URL(base);
  url.searchParams.set("tab", "history");
  url.searchParams.set("type", "all");
  return url.toString();
}

function normalizeTargetUrl(historyUrl: string | null): string {
  if (!historyUrl) return fallbackHistoryUrl();
  const url = new URL(historyUrl);
  url.searchParams.set("tab", "history");
  url.searchParams.set("type", "all");
  return url.toString();
}

export async function captureHistoryAllScreenshot(historyUrl: string | null): Promise<Buffer | null> {
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 430, height: 900 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(90_000);

    await page.goto(normalizeTargetUrl(historyUrl), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    await page.waitForFunction(() => {
      const overlay = document.querySelector("#overlay.show");
      const body = document.querySelector("#overlay-body");
      if (!overlay || !body) return false;
      const loadingText = body.textContent ?? "";
      return !loadingText.includes("計算中") && !loadingText.includes("読み込み中");
    });

    await page.evaluate(() => {
      document.querySelectorAll<HTMLElement>(".share-loading-overlay, #ss-confirm-overlay").forEach(el => {
        el.style.display = "none";
      });

      document.querySelectorAll<HTMLElement>(".hist-section-body").forEach(body => {
        body.style.display = "block";
        body.style.maxHeight = "none";
        body.style.overflowY = "visible";
      });

      document.querySelectorAll<HTMLElement>(".hist-section-header span:first-child").forEach(span => {
        const text = span.textContent ?? "";
        if (text.startsWith("▶") || text.startsWith("▸")) {
          span.textContent = "▼" + text.slice(1);
        }
      });

      const panel = document.querySelector<HTMLElement>(".overlay-panel");
      if (panel) {
        panel.style.maxHeight = "none";
        panel.style.height = "auto";
        panel.style.overflowY = "visible";
      }
      window.scrollTo(0, 0);
    });

    await page.waitForTimeout(800);
    const target = page.locator(".overlay-panel").first();
    return await target.screenshot({ animations: "disabled" });
  } catch (error) {
    console.error("[event-screenshot] capture failed:", error);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
