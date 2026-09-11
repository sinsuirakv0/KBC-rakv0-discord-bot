const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonStore } = require("../dist/storage/json-store");
const { GuildSettingsStore } = require("../dist/storage/guild-settings");
const { NotificationStore } = require("../dist/notifications/store");
const { createDetectionService } = require("../dist/notifications/service");
const { parseDetectionEvent } = require("../dist/notifications/parsers");
const { formatDetection } = require("../dist/notifications/formatters");
const { createEventUpdateServer } = require("../dist/notifications/server");
const { createPushCommand } = require("../dist/commands/push/command");
const { parsePushRequest } = require("../dist/commands/push/parsers");

const detected = { version: 1, eventId: "run:1:skd", category: "skd", phase: "detected", detectedAt: "2026-09-05T15:00:00.000Z", types: [] };
async function fixture() {
  const files = new Map();
  const repository = {
    async verify() {},
    async read(path) { return files.get(path); },
    async list(directory) { return [...files.keys()].filter(path => path.startsWith(directory + "/")); },
    async write(path, content, sha) {
      assert.equal(files.get(path)?.sha, sha);
      files.set(path, { content, sha: String(Number(sha || 0) + 1) });
    },
  };
  const json = new JsonStore(repository);
  await json.initialize(true);
  const guilds = new GuildSettingsStore(json);
  await guilds.restore();
  const store = new NotificationStore(json, guilds);
  store.restart = async () => { const next = new GuildSettingsStore(json); await next.restore(); return new NotificationStore(json, next); };
  return store;
}

test("detection validation and JST messages follow the category contract", () => {
  assert.equal(formatDetection(parseDetectionEvent(detected)), "**スケジュール更新を検知**\n検知時刻: 2026/09/06(日) 00:00:00");
  assert.match(formatDetection(parseDetectionEvent({ ...detected, phase: "types", types: ["sale", "gatya", "sale"] })), /種類: gatya,sale$/);
  assert.match(formatDetection({ ...detected, category: "ad" }), /^adの更新を検知/);
  assert.match(formatDetection({ ...detected, category: "notice" }), /^popup_noticeの更新を検知/);
  for (const invalid of [{ ...detected, types: ["adcontrol"] }, { ...detected, detectedAt: "bad" },
    { ...detected, eventId: "" }, { ...detected, category: "notice", phase: "types", types: ["sale"] }]) {
    assert.throws(() => parseDetectionEvent(invalid));
  }
});

test("fixed administrators can configure subscriptions and other users cannot", async t => {
  const store = await fixture(t);
  const replies = [];
  const context = { inGuild: true, guildId: "1", channelId: "10", userId: "20", reply: async text => replies.push(text) };
  assert.deepEqual(parsePushRequest(["notice", "off"]), { category: "notice", enabled: false });
  assert.equal(parsePushRequest(["notice", "oops"]), undefined);
  await createPushCommand().execute(context, ["skd"]);
  assert.match(replies[0], /権限が必要/);
  const command = createPushCommand({ getStore: () => store });
  for (const userId of ["1447045405257760820", "1347420765410295928", "1138400546823340102"]) {
    await command.execute({ ...context, userId }, ["skd"]);
  }
  context.userId = "1447045405257760820";
  await command.execute(context, ["skd"]);
  await command.execute(context, ["skd"]);
  await command.execute(context, ["ad"]);
  await command.execute({ ...context, channelId: "11" }, ["notice"]);
  await command.execute(context, ["skd", "off"]);
  const restored = await store.restart();
  assert.deepEqual(restored.guilds.subscriptions().map(s => [s.channelId, s.category]), [["10", "ad"], ["11", "notice"]]);
});

test("concurrent duplicates, reordered types and restart edit one persisted schedule message", async t => {
  const store = await fixture(t);
  await store.setSubscription({ guildId: "1", channelId: "10", category: "skd" }, true);
  const calls = [];
  const transport = { send: async (channel, content, nonce) => { calls.push(["send", content, nonce]); return "100"; }, edit: async (channel, id, content) => calls.push(["edit", id, content]) };
  let receive = createDetectionService(store, transport);
  await Promise.all([receive(detected), receive(detected)]);
  receive = createDetectionService(await store.restart(), transport);
  await receive({ ...detected, phase: "types", types: ["sale"] });
  await receive({ ...detected, phase: "types", types: ["gatya"], detectedAt: "2026-09-06T00:00:00Z" });
  await receive(detected);
  assert.equal(calls.filter(call => call[0] === "send").length, 1);
  assert.equal(calls.length, 3);
  assert.match(calls.at(-1)[2], /00:00:00\n種類: gatya,sale$/);
});

test("ambiguous delivery stays on hold while confirmed messages remain deduplicated", async t => {
  const store = await fixture(t);
  for (const channelId of ["10", "11"]) await store.setSubscription({ guildId: "1", channelId, category: "skd" }, true);
  const sent = [];
  let fail = true;
  const receive = createDetectionService(store, {
    async send(channel, content) {
      if (channel === "11" && fail) { fail = false; throw new Error("temporary"); }
      assert.doesNotMatch(content, /種類:/);
      sent.push(channel); return `${channel}0`;
    },
    async edit(channel, id, content) { assert.match(content, /種類: item$/); },
  });
  const event = { ...detected, phase: "types", types: ["item"] };
  await assert.rejects(receive(event), /delivery failed/);
  await assert.rejects(receive(event), /reconciliation-required/);
  const restarted = createDetectionService(await store.restart(), { send: async () => assert.fail("must not resend"), edit: async () => {} });
  await assert.rejects(restarted(event));
  assert.deepEqual(sent, ["10"]);
});

test("control notifications use separate destinations and do not wait for schedule delivery", async t => {
  const store = await fixture(t);
  for (const [channelId, category] of [["10", "skd"], ["11", "ad"], ["12", "notice"]]) {
    await store.setSubscription({ guildId: "1", channelId, category }, true);
  }
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const received = [];
  const receive = createDetectionService(store, {
    async send(channel, content) { if (channel === "10") await gate; received.push([channel, content]); return `${channel}0`; },
    async edit() { assert.fail("control should not edit"); },
  });
  const schedule = receive(detected);
  await receive({ ...detected, eventId: "run:1:ad", category: "ad" });
  await receive({ ...detected, eventId: "run:1:notice", category: "notice" });
  assert.deepEqual(received.map(item => item[0]), ["11", "12"]);
  release();
  await schedule;
});

test("receiver enforces secret, validates payload and distinguishes transient delivery failure", async t => {
  let count = 0;
  const server = createEventUpdateServer({ secret: "test-secret", isReady: () => true, receive: async () => { if (++count === 1) throw new Error("temporary"); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/event-update`;
  const send = (body, secret) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-event-update-secret": secret }, body: JSON.stringify(body) });
  assert.equal((await send(detected, "wrong")).status, 401);
  assert.equal((await send({}, "test-secret")).status, 400);
  assert.equal((await send(detected, "test-secret")).status, 503);
  assert.equal((await send(detected, "test-secret")).status, 200);
  assert.equal(count, 2);
});

const readyEvent = { ...detected, phase: "ready", types: ["gatya"], source: {
  beforeRef: "a".repeat(40), afterRef: "b".repeat(40), files: { gatya: { path: "raw/gatya_123.tsv", hash: "c".repeat(32) } },
} };
const detailParts = ["gatya", "sale", "item", "mission", "変更", "KBC link"];

test("ready retries and restart send each ordered detail only once", async () => {
  const store = await fixture();
  await store.setSubscription({ guildId: "1", channelId: "10", category: "skd" }, true);
  const sent = [];
  const transport = { send: async (channel, content) => { sent.push(content); return String(sent.length); }, edit: async () => {} };
  let builds = 0;
  const receive = createDetectionService(store, transport, async () => { if (++builds === 1) throw new Error("data unavailable"); return detailParts; });
  await assert.rejects(receive(readyEvent));
  assert.equal(sent.length, 1);
  await Promise.all([receive(readyEvent), receive(readyEvent)]);
  const restart = createDetectionService(await store.restart(), transport, async () => assert.fail("persisted details"));
  await restart(readyEvent);
  assert.deepEqual(sent.slice(1), detailParts);
  assert.equal(builds, 2);
  await createDetectionService(store, transport, async () => ["KBC link"])({ ...readyEvent, eventId: "skd:link-only" });
  assert.equal(sent.at(-1), "KBC link");
});

test("ambiguous detail send holds the remaining categories and final link", async () => {
  const store = await fixture();
  await store.setSubscription({ guildId: "1", channelId: "10", category: "skd" }, true);
  const sent = [];
  const transport = { send: async (channel, content) => { sent.push(content); if (content === "sale") throw new Error("lost response"); return String(sent.length); }, edit: async () => {} };
  await assert.rejects(createDetectionService(store, transport, async () => detailParts.filter(part => part !== "変更"))(readyEvent));
  await assert.rejects(createDetectionService(await store.restart(), transport)(readyEvent), /reconciliation-required/);
  assert.deepEqual(sent.slice(1), ["gatya", "sale"]);
});

test("independent receivers cannot claim the same pending message twice", async t => {
  const store = await fixture();
  await store.setSubscription({ guildId: "1", channelId: "10", category: "skd" }, true);
  let release, started, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const sending = new Promise(resolve => { started = resolve; });
  t.after(() => release());
  const transport = { send: async () => { count++; started(); await gate; return "100"; }, edit: async () => {} };
  const first = createDetectionService(store, transport);
  const second = createDetectionService(await store.restart(), transport);
  const completed = Promise.allSettled([first(detected), second(detected)]);
  await sending;
  release();
  await completed;
  await second(detected);
  assert.equal(count, 1);
});
