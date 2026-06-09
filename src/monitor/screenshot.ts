import { chromium } from "playwright";

const DEFAULT_EVENT_SITE_URL = "https://kbc-rakv0-event.vercel.app/";
const EVENT_TYPES = ["gatya", "sale", "item"] as const;

function normalizeTargetUrl(historyUrl: string | null): string {
  const url = new URL(historyUrl ?? process.env.EVENT_SITE_URL ?? DEFAULT_EVENT_SITE_URL);
  url.searchParams.set("tab", "history");
  url.searchParams.set("type", "all");
  return url.toString();
}

export async function captureHistoryTypeScreenshot(
  historyUrl: string | null,
  type: string
): Promise<Buffer | null> {
  if (!EVENT_TYPES.includes(type as typeof EVENT_TYPES[number])) return null;

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 860, height: 900 },
      deviceScaleFactor: 1.25,
    });
    page.setDefaultTimeout(90_000);

    await page.goto(normalizeTargetUrl(historyUrl), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForFunction(() => {
      const overlay = document.querySelector("#overlay.show");
      const body = document.querySelector("#overlay-body");
      return Boolean(overlay && body?.querySelector(".hist-section"));
    });

    const created = await page.evaluate(({ type, eventTypes }) => {
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

      const root = document.createElement("div");
      root.id = "bot-history-capture";
      const bodyStyle = window.getComputedStyle(document.body);
      const panel = document.querySelector<HTMLElement>(".overlay-panel");
      const panelStyle = panel ? window.getComputedStyle(panel) : bodyStyle;
      root.style.cssText = [
        "box-sizing:border-box",
        "width:780px",
        "padding:20px",
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
      document.body.replaceChildren(root);
      return true;
    }, { type, eventTypes: [...EVENT_TYPES] });

    if (!created) return null;
    await page.waitForTimeout(250);
    return await page.locator("#bot-history-capture").screenshot({
      type: "jpeg",
      quality: 90,
      animations: "disabled",
    });
  } catch (error) {
    console.error(`[event-screenshot] ${type} capture failed:`, error);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
