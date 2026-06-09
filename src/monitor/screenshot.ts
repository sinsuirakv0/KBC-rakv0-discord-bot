import { chromium, Page } from "playwright";

const DEFAULT_EVENT_SITE_URL = "https://kbc-rakv0-event.vercel.app/";
const EVENT_TYPES = ["gatya", "sale", "item"] as const;

export interface HistoryScreenshot {
  type: string;
  buffer: Buffer;
}

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

async function prepareHistoryOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>(".share-loading-overlay, #ss-confirm-overlay").forEach(el => {
      el.style.display = "none";
    });

    document.querySelectorAll<HTMLElement>(".hist-section-body").forEach(body => {
      body.style.display = "block";
      body.style.maxHeight = "none";
      body.style.overflowY = "visible";
    });

    const panel = document.querySelector<HTMLElement>(".overlay-panel");
    if (panel) {
      panel.style.maxHeight = "none";
      panel.style.height = "auto";
      panel.style.overflowY = "visible";
    }
  });
}

async function createTypeCaptureRoot(page: Page, type: string): Promise<boolean> {
  return await page.evaluate(({ type, eventTypes }) => {
    document.getElementById("bot-history-capture")?.remove();

    const overlayBody = document.querySelector<HTMLElement>("#overlay-body");
    if (!overlayBody) return false;

    const children = Array.from(overlayBody.children) as HTMLElement[];
    const headingIndex = children.findIndex(child => child.textContent?.trim() === type);
    if (headingIndex === -1) return false;

    const selected: HTMLElement[] = [];
    for (let index = headingIndex; index < children.length; index++) {
      const child = children[index];
      const text = child.textContent?.trim() ?? "";
      if (index > headingIndex && (eventTypes as string[]).includes(text)) break;
      selected.push(child);
    }
    if (selected.length === 0) return false;

    const root = document.createElement("div");
    root.id = "bot-history-capture";
    const bodyStyle = window.getComputedStyle(document.body);
    const panel = document.querySelector<HTMLElement>(".overlay-panel");
    const panelStyle = panel ? window.getComputedStyle(panel) : bodyStyle;
    root.style.cssText = [
      "box-sizing:border-box",
      "width:900px",
      "padding:22px",
      `background:${panelStyle.backgroundColor || bodyStyle.backgroundColor || "#0a1931"}`,
      `color:${panelStyle.color || bodyStyle.color || "#eeeeee"}`,
      `font-family:${bodyStyle.fontFamily}`,
    ].join(";");

    for (const child of selected) root.appendChild(child.cloneNode(true));
    root.querySelectorAll<HTMLElement>(".hist-section-body").forEach(body => {
      body.style.display = "block";
      body.style.maxHeight = "none";
      body.style.overflowY = "visible";
    });

    document.body.appendChild(root);
    return true;
  }, { type, eventTypes: [...EVENT_TYPES] });
}

export async function captureHistoryScreenshots(
  historyUrl: string | null,
  requestedTypes: string[]
): Promise<HistoryScreenshot[]> {
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 1000, height: 900 },
      deviceScaleFactor: 2,
    });
    page.setDefaultTimeout(90_000);

    await page.goto(normalizeTargetUrl(historyUrl), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForFunction(() => {
      const overlay = document.querySelector("#overlay.show");
      const body = document.querySelector("#overlay-body");
      if (!overlay || !body) return false;
      return body.querySelectorAll(".hist-section").length > 0;
    });
    await prepareHistoryOverlay(page);

    const types = [...new Set(requestedTypes)].filter(type =>
      EVENT_TYPES.includes(type as typeof EVENT_TYPES[number])
    );
    const screenshots: HistoryScreenshot[] = [];

    for (const type of types) {
      if (!await createTypeCaptureRoot(page, type)) continue;
      await page.waitForTimeout(200);
      const buffer = await page.locator("#bot-history-capture").screenshot({
        animations: "disabled",
      });
      screenshots.push({ type, buffer });
    }
    return screenshots;
  } catch (error) {
    console.error("[event-screenshot] capture failed:", error);
    return [];
  } finally {
    await browser?.close().catch(() => {});
  }
}
