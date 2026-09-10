const assert = require("node:assert/strict");
const test = require("node:test");

const { createTutCommand } = require("../dist/commands/tut/command");
const { createRemoteTutDataSource } = require("../dist/commands/tut/data-source");
const {
  buildEnemySearchData,
  resolveEnemyDisplayName,
  searchEnemies,
} = require("../dist/commands/tut/domain");
const { formatEnemyDetail } = require("../dist/commands/tut/formatters");
const {
  parseEnemyAliasJson,
  parseEnemyNameTsv,
  parseTutRequest,
} = require("../dist/commands/tut/parsers");

function createData(names, aliases = []) {
  return buildEnemySearchData(names, aliases);
}

function repeatedData(count) {
  return createData(
    Array.from({ length: count }, (_, index) => `共通${index}`),
  );
}

function createFakeOutput(reactions = []) {
  const messages = [];
  const attachments = [];
  const queue = [...reactions];
  const createMessage = (content) => {
    const message = {
      content,
      reactions: [],
      events: [],
      async edit(next) { this.events.push(["edit", next]); this.content = next; },
      async react(emoji) { this.events.push(["react", emoji]); this.reactions.push(emoji); },
      async clearReactions() { this.events.push(["clear"]); },
      async waitForUserReaction(emojis, userId, timeoutMs) {
        this.events.push(["wait", [...emojis], userId, timeoutMs]);
        return queue.shift();
      },
    };
    messages.push(message);
    return message;
  };
  return {
    userId: "user-1",
    messages,
    attachments,
    async send(content) { return createMessage(content); },
    async sendAttachment(attachment) {
      attachments.push(attachment);
      return createMessage(undefined);
    },
  };
}

function commandContext(output) {
  return { inGuild: true, interactive: output, async reply() {} };
}

test("tut parses controls and searches IDs, normalized names, raw aliases, and single-name AND matches", () => {
  assert.deepEqual(parseTutRequest([]), { kind: "landing" });
  assert.deepEqual(parseTutRequest(["origin", "ネコ", "-force"]), {
    kind: "search", query: "ネコ", force: true, origin: true,
  });
  assert.deepEqual(parseTutRequest(["-f"]), { kind: "help" });
  assert.deepEqual(parseTutRequest(["origin"]), { kind: "help" });

  const names = parseEnemyNameTsv("\uFEFFわんこ\n\nダミー\nネコ－Ａ\n");
  const aliases = parseEnemyAliasJson(JSON.stringify([
    { id: 0, names: ["わんこ", "犬"] },
    { id: 1, names: ["対象外"] },
    { id: 2, names: ["黒ネコの城", "殺意のネコ城", "黒ネコの城"] },
    { id: 3, names: ["別の呼び名"] },
    { id: 99, names: ["範囲外"] },
  ]));
  const data = buildEnemySearchData(names, aliases);
  assert.equal(data.entries.length, 3);
  assert.deepEqual(data.entries[0].aliases, ["犬"]);
  assert.deepEqual(data.entries[1].aliases, ["黒ネコの城", "殺意のネコ城"]);

  assert.equal(searchEnemies(data, "000", false)[0].enemy.id, 0);
  assert.equal(searchEnemies(data, "002", true)[0].enemy.id, 2);
  assert.equal(searchEnemies(data, "ねこ-a", false)[0].enemy.id, 3);
  assert.equal(searchEnemies(data, "ねこ-a", true).length, 0);
  assert.equal(searchEnemies(data, "別の呼び名", true)[0].enemy.id, 3);
  assert.equal(searchEnemies(data, "ダミー 黒", false).length, 0);

  const aliasMatch = searchEnemies(data, "ネコ 城", false)[0];
  assert.equal(aliasMatch.matchedAlias, "黒ネコの城");
  assert.equal(resolveEnemyDisplayName(aliasMatch), "黒ネコの城 (ダミー)");
  assert.equal(resolveEnemyDisplayName(searchEnemies(data, "002", false)[0]), "黒ネコの城 (ダミー)");
  assert.equal(
    resolveEnemyDisplayName({ enemy: { id: 4, displayName: "ダミー", aliases: [] } }),
    "ダミー",
  );
  assert.equal(
    formatEnemyDetail(searchEnemies(data, "2", false)[0]),
    "2 黒ネコの城 (ダミー)\nhttps://jarjarblink.github.io/JDB/t000.html?cc=ja&unit=2",
  );
});

test("tut applies UT count boundaries, selection, serialized paging, and origin-only attachment", async () => {
  const threeOutput = createFakeOutput();
  await createTutCommand({ dataSource: { async fetchSearchData() { return repeatedData(3); } } })
    .execute(commandContext(threeOutput), ["共通"]);
  assert.equal(threeOutput.messages.length, 3);

  const fourOutput = createFakeOutput(["2️⃣"]);
  await createTutCommand({ dataSource: { async fetchSearchData() { return repeatedData(4); } } })
    .execute(commandContext(fourOutput), ["共通"]);
  assert.deepEqual(fourOutput.messages[0].reactions, ["1️⃣", "2️⃣", "3️⃣", "4️⃣"]);
  assert.match(fourOutput.messages[0].content, /選択済み: 1 共通1$/);
  assert.match(fourOutput.messages[1].content, /unit=1$/);

  const tenOutput = createFakeOutput();
  await createTutCommand({ dataSource: { async fetchSearchData() { return repeatedData(10); } } })
    .execute(commandContext(tenOutput), ["共通"]);
  assert.equal(tenOutput.messages[0].reactions.length, 0);
  assert.match(tenOutput.messages[0].content, /1～10\/10/);
  assert.match(tenOutput.messages[0].content, /詳細は o\.tut <ID> で表示できます。$/);

  const pageOutput = createFakeOutput(["▶️", undefined]);
  await createTutCommand({ dataSource: { async fetchSearchData() { return repeatedData(21); } } })
    .execute(commandContext(pageOutput), ["共通"]);
  assert.deepEqual(
    pageOutput.messages[0].events.map((event) => event[0]),
    ["react", "wait", "clear", "edit", "react", "wait", "clear", "edit"],
  );
  assert.match(pageOutput.messages[0].events[3][1], /21～21\/21（2\/2ページ）/);
  assert.match(pageOutput.messages[0].content, /ページ操作受付は終了しました。/);

  const originOutput = createFakeOutput(["2️⃣"]);
  const fetchedIds = [];
  await createTutCommand({
    dataSource: {
      async fetchSearchData() { return repeatedData(2); },
      async fetchEnemyPng(id) {
        fetchedIds.push(id);
        return { data: Uint8Array.from([1, 2, 3]), filename: "enemy_icon_001.png" };
      },
    },
  }).execute(commandContext(originOutput), ["origin", "共通", "-force"]);
  assert.deepEqual(fetchedIds, [1]);
  assert.equal(originOutput.attachments.length, 1);
  assert.doesNotMatch(originOutput.messages[0].content, /origin|-force/);
  assert.equal(originOutput.messages[1].content, undefined);
});

test("tut atomically caches both resources, revalidates conditionally, falls back stale, and never caches PNG", async () => {
  const urls = {
    enemyNames: "https://example.test/Enemyname.tsv",
    aliases: "https://example.test/enemyname.json",
    enemyIconsBase: "https://example.test/Image",
  };
  let now = 0;
  let mode = "initial";
  let dataCalls = 0;
  let pngCalls = 0;
  const pngUrls = [];
  const observedHeaders = [];
  const fetchImpl = async (url, init = {}) => {
    const key = String(url);
    if (key.includes("enemy_icon_")) {
      pngCalls += 1;
      pngUrls.push(key);
      return new Response(Uint8Array.from([1, 2, 3]));
    }
    dataCalls += 1;
    observedHeaders.push([
      key,
      new Headers(init.headers).get("if-none-match"),
      new Headers(init.headers).get("if-modified-since"),
    ]);
    if (mode === "not-modified") return new Response(null, { status: 304 });
    if (mode === "invalid") {
      if (key.endsWith("Enemyname.tsv")) return new Response(null, { status: 304 });
      return new Response('{"broken":true}', { headers: { etag: '"bad"' } });
    }
    const body = key.endsWith("Enemyname.tsv")
      ? "わんこ\nダミー\n"
      : JSON.stringify([
        { id: 0, names: ["わんこ"] },
        { id: 1, names: [mode === "changed" ? "新別称" : "旧別称"] },
      ]);
    return new Response(body, {
      headers: { etag: `"${mode}"`, "last-modified": "Sat, 05 Sep 2026 00:00:00 GMT" },
    });
  };
  const source = createRemoteTutDataSource({
    urls,
    fetchImpl,
    now: () => now,
    cacheTtlMs: 100,
  });

  const [first, concurrent] = await Promise.all([
    source.fetchSearchData(),
    source.fetchSearchData(),
  ]);
  assert.equal(first, concurrent);
  assert.equal(dataCalls, 2);
  now = 99;
  assert.equal(await source.fetchSearchData(), first);
  assert.equal(dataCalls, 2);

  mode = "not-modified";
  now = 100;
  assert.equal(await source.fetchSearchData(), first);
  assert.equal(observedHeaders[2][1], '"initial"');
  assert.equal(observedHeaders[2][2], "Sat, 05 Sep 2026 00:00:00 GMT");

  mode = "changed";
  now = 200;
  const changed = await source.fetchSearchData();
  assert.equal(changed.entries[1].aliases[0], "新別称");

  mode = "invalid";
  now = 300;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal(await source.fetchSearchData(), changed);
  } finally {
    console.error = originalConsoleError;
  }

  const attachment = await source.fetchEnemyPng(1);
  await source.fetchEnemyPng(1);
  assert.equal(pngCalls, 2);
  assert.deepEqual(pngUrls, [
    "https://example.test/Image/enemy_icon_001.png",
    "https://example.test/Image/enemy_icon_001.png",
  ]);
  assert.equal(attachment.filename, "enemy_icon_001.png");
});
