const assert = require("node:assert/strict");
const test = require("node:test");

const { createUtCommand } = require("../dist/commands/ut/command");
const { createRemoteUtDataSource } = require("../dist/commands/ut/data-source");
const {
  normalizeSearchText,
  resolveOriginAssetPath,
  searchCharacterIndex,
} = require("../dist/commands/ut/domain");
const {
  parseCharacterAssets,
  parseCharacterIndex,
  parseUtRequest,
} = require("../dist/commands/ut/parsers");

function unit(id, name, forms = [], aliases = []) {
  return {
    id: String(id).padStart(3, "0"),
    forms: [{ name, description: "" }, ...forms.map((value) => ({ name: value, description: "" }))],
    aliases,
  };
}

function createIndex(count, prefix = "共通") {
  return {
    units: Array.from({ length: count }, (_, index) => unit(index, `${prefix}${index}`)),
  };
}

function createFakeOutput(reactions = []) {
  const messages = [];
  const attachments = [];
  const reactionQueue = [...reactions];

  function createMessage(content) {
    const message = {
      content,
      reactions: [],
      events: [],
      clearCount: 0,
      async edit(nextContent) {
        this.events.push(["edit", nextContent]);
        this.content = nextContent;
      },
      async delete() {
        this.events.push(["delete"]);
      },
      async react(emoji) {
        this.events.push(["react", emoji]);
        this.reactions.push(emoji);
      },
      async clearReactions() {
        this.events.push(["clear"]);
        this.clearCount += 1;
      },
      async waitForUserReaction(emojis, userId, timeoutMs) {
        this.events.push(["wait", [...emojis], userId, timeoutMs]);
        return reactionQueue.shift();
      },
    };
    messages.push(message);
    return message;
  }

  return {
    userId: "user-1",
    messages,
    attachments,
    async send(content) {
      return createMessage(content);
    },
    async sendAttachment(attachment) {
      attachments.push(attachment);
      return createMessage(undefined);
    },
  };
}

function commandContext(output) {
  return { inGuild: true, async reply() {}, interactive: output };
}

function dataSourceFor(index, overrides = {}) {
  return {
    async fetchCharacterIndex() { return index; },
    async fetchCharacterAssets() { throw new Error("assets must not be requested"); },
    async fetchPng() { throw new Error("PNG must not be requested"); },
    ...overrides,
  };
}

test("ut parses origin forms and searches ID, normalized forms, raw forms, and aliases in priority order", () => {
  assert.deepEqual(parseUtRequest([]), { kind: "landing" });
  assert.deepEqual(parseUtRequest(["ネコ", "-f", "origin", "wide", "u"]), {
    kind: "search",
    query: "ネコ",
    force: true,
    origin: { family: "wide", variant: "u" },
  });
  assert.deepEqual(parseUtRequest(["ネコ", "origin", "f"]), {
    kind: "search",
    query: "ネコ",
    force: false,
    origin: { family: "icon", variant: "f" },
  });
  assert.deepEqual(parseUtRequest(["ネコ", "origin", "gacha", "m"]), {
    kind: "search",
    query: "ネコ",
    force: false,
    origin: { family: "gacha", variant: "m" },
  });
  assert.deepEqual(parseUtRequest(["origin"]), { kind: "invalid-origin" });
  assert.deepEqual(parseUtRequest(["ネコ", "origin", "gacha", "f"]), {
    kind: "invalid-origin",
  });

  const index = {
    units: [
      unit(0, "ネコ－Ａ", ["二形態ヒット", "三形態ヒット"], ["別称ヒット"]),
      unit(1, "別キャラ", [], ["ヒット別称"]),
    ],
  };
  assert.equal(normalizeSearchText("ネコ－Ａ"), "ねこーa");
  assert.equal(searchCharacterIndex(index, "0", false)[0].source.kind, "id");
  assert.equal(searchCharacterIndex(index, "000", false)[0].unit.id, "000");
  assert.equal(searchCharacterIndex(index, "ねこ-a", false)[0].unit.id, "000");

  const matches = searchCharacterIndex(index, "ヒット", false);
  assert.deepEqual(matches.map((match) => match.unit.id), ["000", "001"]);
  assert.deepEqual(matches[0].source, { kind: "form", formIndex: 1 });
  assert.deepEqual(matches[1].source, { kind: "alias" });
  assert.equal(searchCharacterIndex(index, "ねこ-a", true).length, 0);
  assert.equal(searchCharacterIndex(index, "別称ヒット", true).length, 0);
});

test("ut validates every index/assets unit, ignores schemaVersion values, and rejects unsafe paths", () => {
  const parsedIndex = parseCharacterIndex({
    schemaVersion: "future-value",
    units: [unit(0, "ネコ")],
  });
  assert.equal(parsedIndex.units[0].forms[0].name, "ネコ");
  assert.throws(
    () => parseCharacterIndex({ units: [unit(0, "ネコ"), { ...unit(1, "タンク"), id: "999" }] }),
    /invalid id/,
  );

  const assets = parseCharacterAssets({
    schemaVersion: -1,
    pathTemplates: {
      un: "Unit/uni{id}{suffix}",
      uu: "Unit/udi{id}{suffix}",
      g: "Image/gatyachara_{id}{suffix}",
      x: "{suffix}",
    },
    units: [{
      id: "000",
      un: ["_f00.png", "_c00.png"],
      uu: ["_u.png"],
      g: ["_f.png", "_m.png", "_z.png"],
    }],
  });
  assert.equal(
    resolveOriginAssetPath(assets, "000", { family: "icon", variant: "c" }),
    "Unit/uni000_c00.png",
  );
  assert.equal(
    resolveOriginAssetPath(assets, "000", { family: "wide", variant: "u" }),
    "Unit/udi000_u.png",
  );
  assert.equal(
    resolveOriginAssetPath(assets, "000", { family: "gacha", variant: "m" }),
    "Image/gatyachara_000_m.png",
  );
  assert.equal(
    resolveOriginAssetPath(assets, "000", { family: "icon", variant: "s" }),
    undefined,
  );
  assert.throws(
    () => parseCharacterAssets({
      pathTemplates: {
        un: "Unit/uni{id}{suffix}",
        uu: "Unit/udi{id}{suffix}",
        g: "Image/gatyachara_{id}{suffix}",
        x: "{suffix}",
      },
      units: [{ id: "000", x: ["../secret.png"] }],
    }),
    /Unsafe character asset path/,
  );
});

test("ut honors result-count boundaries and completes reaction selection", async () => {
  const threeOutput = createFakeOutput();
  await createUtCommand({ dataSource: dataSourceFor(createIndex(3)) }).execute(
    commandContext(threeOutput),
    ["共通"],
  );
  assert.equal(threeOutput.messages.length, 3);
  assert.match(threeOutput.messages[0].content, /u000\.html/);

  const fourOutput = createFakeOutput(["2️⃣"]);
  await createUtCommand({ dataSource: dataSourceFor(createIndex(4)) }).execute(
    commandContext(fourOutput),
    ["共通"],
  );
  assert.deepEqual(fourOutput.messages[0].reactions, ["1️⃣", "2️⃣", "3️⃣", "4️⃣"]);
  assert.equal(fourOutput.messages[0].clearCount, 1);
  assert.match(fourOutput.messages[0].content, /選択済み: 001 共通1/);
  assert.match(fourOutput.messages[1].content, /u001\.html/);

  const nineOutput = createFakeOutput([undefined]);
  await createUtCommand({ dataSource: dataSourceFor(createIndex(9)) }).execute(
    commandContext(nineOutput),
    ["共通"],
  );
  assert.equal(nineOutput.messages[0].reactions.length, 9);
  assert.match(nineOutput.messages[0].content, /選択受付は終了しました。$/);

  for (const count of [10, 20]) {
    const output = createFakeOutput();
    await createUtCommand({ dataSource: dataSourceFor(createIndex(count)) }).execute(
      commandContext(output),
      ["共通"],
    );
    assert.equal(output.messages.length, 1);
    assert.equal(output.messages[0].reactions.length, 0);
    assert.match(output.messages[0].content, new RegExp(`1～${count}/${count}`));
    assert.match(output.messages[0].content, /詳細は o\.ut <ID> で表示できます。$/);
  }
});

test("ut serializes page changes as clear, edit, and valid-arrow re-add before timing out", async () => {
  const output = createFakeOutput(["▶️", undefined]);
  await createUtCommand({ dataSource: dataSourceFor(createIndex(21)) }).execute(
    commandContext(output),
    ["共通"],
  );

  const message = output.messages[0];
  assert.equal(message.clearCount, 2);
  assert.deepEqual(
    message.events.map((event) => event[0]),
    ["react", "wait", "clear", "edit", "react", "wait", "clear", "edit"],
  );
  assert.deepEqual(message.events[0], ["react", "▶️"]);
  assert.deepEqual(message.events[4], ["react", "◀️"]);
  assert.match(message.events[3][1], /21～21\/21（2\/2ページ）/);
  assert.match(message.content, /ページ操作受付は終了しました。/);
});

test("ut origin selects candidates, preserves the registered filename, and sends no result text", async () => {
  const index = createIndex(2);
  const assets = {
    pathTemplates: {
      un: "Unit/uni{id}{suffix}",
      uu: "Unit/udi{id}{suffix}",
      g: "Image/gatyachara_{id}{suffix}",
    },
    units: [
      { id: "000", suffixes: { un: ["_f00.png"] } },
      { id: "001", suffixes: { un: ["_f00.png"] } },
    ],
  };
  const fetchedPaths = [];
  const output = createFakeOutput(["2️⃣"]);
  const command = createUtCommand({
    dataSource: dataSourceFor(index, {
      async fetchCharacterAssets() { return assets; },
      async fetchPng(relativePath) {
        fetchedPaths.push(relativePath);
        return { data: Uint8Array.from([1, 2, 3]), filename: "uni001_f00.png" };
      },
    }),
  });
  await command.execute(commandContext(output), ["共通", "origin"]);

  assert.deepEqual(fetchedPaths, ["Unit/uni001_f00.png"]);
  assert.equal(output.attachments.length, 1);
  assert.equal(output.attachments[0].filename, "uni001_f00.png");
  assert.equal(output.messages[1].content, undefined);
});

test("ut caches JSON for ten minutes, revalidates conditionally, updates content, and falls back stale", async () => {
  const urls = {
    characterIndex: "https://example.test/character-index.json",
    characterAssets: "https://example.test/character-assets.json",
    siteDataBase: "https://example.test/sitedata",
  };
  const indexV1 = JSON.stringify({ schemaVersion: 2, units: [unit(0, "ネコ")] });
  const indexV2 = JSON.stringify({ schemaVersion: 2, units: [unit(0, "ネコ", [], ["にゃんこ"])] });
  const assetsText = JSON.stringify({
    pathTemplates: {
      un: "Unit/uni{id}{suffix}",
      uu: "Unit/udi{id}{suffix}",
      g: "Image/gatyachara_{id}{suffix}",
    },
    units: [{ id: "000", un: ["_f00.png"] }],
  });
  let now = 0;
  let indexCall = 0;
  let assetsCalls = 0;
  let pngCalls = 0;
  const conditionalHeaders = [];
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith("character-index.json")) {
      indexCall += 1;
      conditionalHeaders.push(new Headers(init.headers).get("if-none-match"));
      if (indexCall === 1) return new Response(indexV1, { headers: { etag: '"v1"' } });
      if (indexCall === 2) return new Response(null, { status: 304 });
      if (indexCall === 3) return new Response(indexV2, { headers: { etag: '"v2"' } });
      return new Response("offline", { status: 503 });
    }
    if (value.endsWith("character-assets.json")) {
      assetsCalls += 1;
      return new Response(assetsText, { headers: { "last-modified": "Mon, 31 Aug 2026 00:00:00 GMT" } });
    }
    pngCalls += 1;
    return new Response(Uint8Array.from([1, 2, 3]));
  };
  const source = createRemoteUtDataSource({
    urls,
    fetchImpl,
    now: () => now,
    cacheTtlMs: 1_000,
  });

  const first = await source.fetchCharacterIndex();
  now = 999;
  assert.equal(await source.fetchCharacterIndex(), first);
  assert.equal(indexCall, 1);
  assert.equal(assetsCalls, 0);

  now = 1_000;
  assert.equal(await source.fetchCharacterIndex(), first);
  assert.deepEqual(conditionalHeaders, [null, '"v1"']);

  now = 2_000;
  const changed = await source.fetchCharacterIndex();
  assert.deepEqual(changed.units[0].aliases, ["にゃんこ"]);

  now = 3_000;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal(await source.fetchCharacterIndex(), changed);
  } finally {
    console.error = originalConsoleError;
  }

  await source.fetchCharacterAssets();
  await source.fetchPng("Unit/uni000_f00.png");
  await source.fetchPng("Unit/uni000_f00.png");
  assert.equal(assetsCalls, 1);
  assert.equal(pngCalls, 2);
});
