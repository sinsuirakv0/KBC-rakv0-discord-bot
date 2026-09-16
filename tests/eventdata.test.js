const assert = require("node:assert/strict");
const { createHash, createCipheriv } = require("node:crypto");
const test = require("node:test");

const { createEventDataCommand } = require("../dist/commands/eventdata/command");
const { createRemoteEventDataSource } = require("../dist/commands/eventdata/data-source");
const {
  buildKbcEventDataUrl,
  buildOfficialEventDataUrl,
  encryptEventData,
} = require("../dist/commands/eventdata/domain");
const { parseEventDataRequest } = require("../dist/commands/eventdata/parsers");

function createOutput() {
  const messages = [];
  const attachments = [];
  const sent = { async edit() {}, async react() {}, async clearReactions() {}, async waitForUserReaction() {} };
  return {
    userId: "user-1",
    messages,
    attachments,
    async send(content) { messages.push(content); return sent; },
    async sendAttachment(attachment) { attachments.push(attachment); return sent; },
  };
}

function context(output) {
  return { inGuild: true, interactive: output, async reply() {} };
}

test("eventdata parses type, country aliases, file aliases and options", () => {
  assert.deepEqual(parseEventDataRequest([]), { kind: "all-links" });
  assert.deepEqual(parseEventDataRequest(["all", "en", "kbc"]), {
    kind: "all", country: "en", file: false, encrypted: false, kbc: true,
  });
  assert.deepEqual(parseEventDataRequest(["all", "tw", "enc", "kbc"]), {
    kind: "all", country: "tw", file: false, encrypted: true, kbc: true,
  });
  assert.deepEqual(parseEventDataRequest(["all", "en", "file", "enc", "kbc"]), {
    kind: "all", country: "en", file: true, encrypted: true, kbc: true,
  });
  assert.deepEqual(parseEventDataRequest(["sale", "enc", "kbc"]), {
    kind: "selected", type: "sale", country: "jp",
    file: false, encrypted: true, kbc: true,
  });
  assert.deepEqual(parseEventDataRequest(["placement", "ko", "file", "enc", "kbc"]), {
    kind: "selected", type: "notice", country: "kr",
    file: true, encrypted: true, kbc: true,
  });
  assert.deepEqual(parseEventDataRequest(["sale", "tsv"]), {
    kind: "selected", type: "sale", country: "jp",
    file: true, encrypted: false, kbc: false,
  });
  for (const args of [
    ["unknown"], ["sale", "fr"], ["sale", "enc"],
    ["sale", "jp", "en"], ["sale", "file", "tsv"], ["sale", "kbc", "kbc"],
    ["all", "file", "tsv"], ["all", "enc"], ["all", "jp", "en"],
  ]) assert.deepEqual(parseEventDataRequest(args), { kind: "invalid" });
});

test("eventdata builds official-like KBC URLs and compatible DAT bytes", () => {
  assert.equal(
    buildOfficialEventDataUrl("sale", "jp", "token value"),
    "https://nyanko-events.ponosgames.com/battlecats_production/sale.tsv?jwt=token%20value",
  );
  assert.equal(
    buildOfficialEventDataUrl("ad", "en"),
    "https://nyanko-events.ponosgames.com/control/ad/battlecats/adcontrol.json",
  );
  assert.equal(
    buildKbcEventDataUrl("sale", "jp"),
    "https://kbc-rakv0.vercel.app/nyanko-events/battlecats_production/sale.tsv",
  );
  assert.equal(
    buildKbcEventDataUrl("notice", "tw", true),
    "https://kbc-rakv0.vercel.app/nyanko-events/control/placement/battlecatstw/event.json?enc=1",
  );

  const source = Buffer.from("row\tvalue\n");
  const encrypted = Buffer.from(encryptEventData(source, "en"));
  const key = createHash("md5").update("battlecats").digest("hex").slice(0, 16);
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const ciphertext = Buffer.concat([cipher.update(source), cipher.final()]);
  const signature = createHash("md5")
    .update(Buffer.concat([Buffer.from("battlecatsen"), ciphertext])).digest("hex");
  assert.deepEqual(encrypted, Buffer.concat([ciphertext, Buffer.from(signature)]));
});

test("eventdata command formats official links, all links, KBC links, files and validation errors", async () => {
  const requests = [];
  const dataSource = {
    async fetchOfficialLinks(types, country) {
      requests.push(["links", [...types], country]);
      return new Map(types.map(type => [type, `https://official.test/${type}?jwt=token`]));
    },
    async fetchAttachment(request) {
      requests.push(["file", request]);
      return { data: Uint8Array.from([1, 2, 3]), filename: `${request.type}.dat` };
    },
  };
  const command = createEventDataCommand({ dataSource });
  const all = createOutput();
  await command.execute(context(all), []);
  assert.deepEqual(requests[0], ["links", ["gatya", "sale", "item"], "jp"]);
  assert.match(all.messages[0], /^\[gatya\]\n.*\n\n\[sale\]\n.*\n\n\[item\]\n/);

  const allTypes = createOutput();
  await command.execute(context(allTypes), ["all", "en"]);
  assert.deepEqual(requests[1], [
    "links", ["gatya", "sale", "item", "notice", "ad"], "en",
  ]);
  assert.match(
    allTypes.messages[0],
    /^\[gatya\]\n.*\n\n\[sale\]\n.*\n\n\[item\]\n.*\n\n\[notice\]\n.*\n\n\[ad\]\n/,
  );

  const allKbc = createOutput();
  await command.execute(context(allKbc), ["all", "tw", "enc", "kbc"]);
  assert.match(allKbc.messages[0], /^\[gatya\]\nhttps:\/\/kbc-rakv0\.vercel\.app\//);
  assert.match(allKbc.messages[0], /gatya\.tsv\?enc=1/);
  assert.match(allKbc.messages[0], /\n\n\[ad\]\n.*battlecats\/adcontrol\.json\?enc=1$/);

  const allFiles = createOutput();
  await command.execute(context(allFiles), ["all", "kr", "file", "enc", "kbc"]);
  assert.deepEqual(allFiles.attachments.map(({ filename }) => filename), [
    "gatya.dat", "sale.dat", "item.dat", "notice.dat", "ad.dat",
  ]);
  assert.deepEqual(
    requests.slice(2, 7).map(([, request]) => [
      request.type, request.country, request.file, request.encrypted, request.kbc,
    ]),
    [
      ["gatya", "kr", true, true, true],
      ["sale", "kr", true, true, true],
      ["item", "kr", true, true, true],
      ["notice", "kr", true, true, true],
      ["ad", "kr", true, true, true],
    ],
  );

  const kbc = createOutput();
  await command.execute(context(kbc), ["notice", "en", "enc", "kbc"]);
  assert.equal(kbc.messages[0], "[notice]\nhttps://kbc-rakv0.vercel.app/nyanko-events/control/placement/battlecatsen/event.json?enc=1");

  const file = createOutput();
  await command.execute(context(file), ["gatya", "tw", "file", "enc", "kbc"]);
  assert.equal(file.attachments[0].filename, "gatya.dat");
  assert.equal(requests[7][0], "file");
  assert.equal(requests[7][1].kbc, true);

  const invalid = createOutput();
  await command.execute(context(invalid), ["sale", "enc"]);
  assert.match(invalid.messages[0], /指定が正しくありません/);
});

test("eventdata data source shares a JWT and obtains official and KBC attachments", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes("createAccount")) return Response.json({ accountId: "account" });
    if (value.endsWith("/v1/users")) return Response.json({ payload: { password: "password" } });
    if (value.endsWith("/v1/tokens")) return Response.json({ payload: { token: "jwt" } });
    if (value === "https://nyanko-events.ponosgames.com/battlecats_production/item.tsv?jwt=jwt") {
      return new Response("[start]\nitem\tvalue\n[end]\n");
    }
    if (value === "https://kbc-rakv0.vercel.app/nyanko-events/control/placement/battlecatskr/event.json") {
      return Response.json({ header: "event" });
    }
    throw new Error(`Unexpected URL: ${value}`);
  };
  const source = createRemoteEventDataSource({ fetchImpl, now: () => 0 });
  const links = await source.fetchOfficialLinks(["sale", "gatya", "item"], "jp");
  assert.match(links.get("sale"), /sale\.tsv\?jwt=jwt$/);
  assert.equal(calls.filter(value => value.endsWith("/v1/tokens")).length, 1);
  const item = await source.fetchAttachment({
    kind: "selected", type: "item", country: "jp",
    file: true, encrypted: false, kbc: false,
  });
  assert.equal(item.filename, "item.tsv");
  assert.match(Buffer.from(item.data).toString(), /item/);
  assert.equal(calls.filter(value => value.endsWith("/v1/tokens")).length, 1);
  const notice = await source.fetchAttachment({
    kind: "selected", type: "notice", country: "kr",
    file: true, encrypted: false, kbc: true,
  });
  assert.equal(notice.filename, "popup_notice.json");
  assert.deepEqual(JSON.parse(Buffer.from(notice.data).toString()), { header: "event" });
});
