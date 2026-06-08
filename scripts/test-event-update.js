const endpoint = process.env.EVENT_UPDATE_ENDPOINT ?? "http://localhost:3000/event-update";
const secret = process.env.EVENT_UPDATE_SECRET ?? "";
const types = (process.env.EVENT_UPDATE_TEST_TYPES ?? "gatya,sale")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

const base = process.env.EVENT_SITE_URL ?? "https://kbc-rakv0-event.vercel.app/";
const historyUrl = new URL(base);
historyUrl.searchParams.set("tab", "history");
historyUrl.searchParams.set("tsv", String(Math.floor(Date.now() / 1000)));
historyUrl.searchParams.set("type", "all");

async function main() {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-event-update-secret": secret } : {}),
    },
    body: JSON.stringify({
      types,
      detectedAt: new Date().toISOString(),
      historyUrl: historyUrl.toString(),
      runUrl: "https://github.com/sinsuirakv0/KBC-rakv0-event/actions/workflows/check-events.yml",
      source: "local-test",
    }),
  });

  const text = await res.text();
  console.log(`${res.status} ${res.statusText}`);
  console.log(text);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
