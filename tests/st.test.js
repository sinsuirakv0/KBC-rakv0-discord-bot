const assert = require("node:assert/strict");
const test = require("node:test");

const { createStCommand } = require("../dist/commands/st/command");
const {
  createRemoteStDataSource,
  MissingStageNameFilesError,
} = require("../dist/commands/st/data-source");
const {
  buildStageSearchData,
  chapterStageDefinitions,
  normalizeStageSearchText,
  searchStages,
} = require("../dist/commands/st/domain");
const { formatStageDetail } = require("../dist/commands/st/formatters");
const { parseStRequest, parseStageTypeCsv } = require("../dist/commands/st/parsers");

function chapterRows(prefix = "章") {
  return new Map(
    chapterStageDefinitions.map((definition) => [
      definition.fileName,
      [[`${prefix}0`], [`${prefix}1`], [`${prefix}2`]],
    ]),
  );
}

function searchFixture() {
  return buildStageSearchData({
    stageTypes: [{ from: 1000, to: 1999, type: "S" }],
    mapNames: new Map([
      [0, "伝説のはじまり"],
      [1000, "月曜ステージ（旧）"],
      [1001, "赤い世界"],
      [3000, "日本編 第1章"],
      [23000, "フィリバスター襲来"],
    ]),
    saleNames: new Map([
      [0, "無効な別名"],
      [1000, "販売別名"],
      [1001, "青い別名"],
    ]),
    normalStages: new Map([
      ["N", [["伝説ステージ"]]],
      ["S", [["ネコ－Ａ"], ["共通ステージ"]]],
    ]),
    chapterStages: chapterRows(),
  });
}

function createFakeOutput(reactions = []) {
  const messages = [];
  const queue = [...reactions];
  return {
    userId: "user-1",
    messages,
    async send(content) {
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
    },
    async sendAttachment() { throw new Error("not used"); },
  };
}

function commandContext(output) {
  return { inGuild: true, interactive: output, async reply() {} };
}

function repeatedData(count) {
  const maps = Array.from({ length: count }, (_, index) => ({
    kind: "map",
    rawMapId: 1000 + index,
    displayId: `S${String(index).padStart(3, "0")}`,
    displayName: `共通${index}`,
    searchNames: [`共通${index}`],
    jdbType: "S",
    jdbMap: index,
    displayType: "S",
    displayMap: index,
  }));
  return { maps, stages: [], displayTypes: ["S"], idIndex: new Map() };
}

test("st parses only a leading force flag and searches normalized names and exact IDs", () => {
  assert.deepEqual(parseStRequest([]), { kind: "landing" });
  assert.deepEqual(parseStRequest(["-f"]), { kind: "help" });
  assert.deepEqual(parseStRequest(["-force", "ネコ"]), {
    kind: "search", query: "ネコ", force: true,
  });
  assert.deepEqual(parseStRequest(["ネコ", "-f"]), {
    kind: "search", query: "ネコ -f", force: false,
  });
  assert.deepEqual(parseStageTypeCsv("from,to,type\n1000,1999,S\n"), [
    { from: 1000, to: 1999, type: "S" },
  ]);

  const data = searchFixture();
  assert.equal(normalizeStageSearchText("ネコ－Ａ"), "ねこーa");
  assert.equal(searchStages(data, "ねこ-a", false)[0].displayId, "S000-000");
  assert.equal(searchStages(data, "ねこ-a", true).length, 0);
  assert.equal(searchStages(data, "ネコ－Ａ", true)[0].displayId, "S000-000");
  assert.equal(searchStages(data, "S0", false)[0].rawMapId, 1000);
  assert.equal(searchStages(data, "s0-0", false)[0].displayId, "S000-000");
  assert.equal(searchStages(data, "1000-0", false)[0].displayId, "S000-000");
  assert.equal(searchStages(data, "2_inv0", false)[0].rawMapId, 23000);
  assert.equal(searchStages(data, "23000", false)[0].displayId, "2_Inv000");
  assert.equal(searchStages(data, "販売別名", false)[0].displayName, "月曜ステージ（旧）");
  assert.equal(searchStages(data, "青い別名", false)[0].displayName, "青い別名");
  assert.equal(searchStages(data, "赤い 青い", false).length, 0);
  assert.equal(searchStages(data, "無効な別名", false).length, 0);

  assert.equal(
    formatStageDetail(searchStages(data, "S0-0", false)[0]),
    "S000-000 ネコ－Ａ\nhttps://jarjarblink.github.io/JDB/map.html?cc=ja&type=S&map=0&stage=0",
  );
});

test("st uses the ut-compatible count boundaries, selection, and serialized paging", async () => {
  const fourOutput = createFakeOutput(["2️⃣"]);
  await createStCommand({ dataSource: { async fetchSearchData() { return repeatedData(4); } } })
    .execute(commandContext(fourOutput), ["共通"]);
  assert.deepEqual(fourOutput.messages[0].reactions, ["1️⃣", "2️⃣", "3️⃣", "4️⃣"]);
  assert.match(fourOutput.messages[0].content, /ステージ「共通」検索結果（4件）/);
  assert.match(fourOutput.messages[0].content, /選択済み: S001 共通1$/);
  assert.match(fourOutput.messages[1].content, /type=S&map=1$/);

  const tenOutput = createFakeOutput();
  await createStCommand({ dataSource: { async fetchSearchData() { return repeatedData(10); } } })
    .execute(commandContext(tenOutput), ["共通"]);
  assert.equal(tenOutput.messages[0].reactions.length, 0);
  assert.match(tenOutput.messages[0].content, /検索結果（10件）/);
  assert.match(tenOutput.messages[0].content, /詳細は o\.st <ID> で表示できます。$/);

  const pageOutput = createFakeOutput(["▶️", undefined]);
  await createStCommand({ dataSource: { async fetchSearchData() { return repeatedData(21); } } })
    .execute(commandContext(pageOutput), ["共通"]);
  assert.deepEqual(
    pageOutput.messages[0].events.map((event) => event[0]),
    ["react", "wait", "clear", "edit", "react", "wait", "clear", "edit"],
  );
  assert.match(pageOutput.messages[0].events[3][1], /（21件・2\/2ページ）/);
  assert.match(pageOutput.messages[0].content, /ページ操作受付は終了しました。/);
});

test("st caches the complete dataset, revalidates conditionally, falls back stale, but not for double 404", async () => {
  const urls = {
    stageTypes: "https://example.test/stage_type.csv",
    mapNames: "https://example.test/Map_Name.csv",
    saleNames: "https://example.test/sale_name.csv",
    normalStageBase: "https://example.test/res",
    chapterStageBase: "https://example.test/search",
  };
  const bodies = new Map([
    [urls.stageTypes, "from,to,type\n1000,1999,S\n"],
    [urls.mapNames, "0,伝説のはじまり\n1000,月曜ステージ\n"],
    [urls.saleNames, "1000,月曜別名\n"],
    [`${urls.normalStageBase}/StageName_RN_ja.csv`, "伝説ステージ\n"],
    [`${urls.normalStageBase}/StageName_S_ja.csv`, "ネコボン屋敷\n"],
    ...chapterStageDefinitions.map((definition) => [
      `${urls.chapterStageBase}/${definition.fileName}`,
      "章0\n章1\n章2\n",
    ]),
  ]);
  let now = 0;
  let mode = "initial";
  let calls = 0;
  const observedHeaders = [];
  const fetchImpl = async (url, init = {}) => {
    calls += 1;
    const key = String(url);
    const headers = new Headers(init.headers);
    if (key === urls.stageTypes) {
      observedHeaders.push([
        headers.get("if-none-match"),
        headers.get("if-modified-since"),
      ]);
    }
    if (key.endsWith("/StageName_RS_ja.csv")) {
      return new Response("missing", { status: 404 });
    }
    if (mode === "fatal" && key.endsWith("/StageName_S_ja.csv")) {
      return new Response("missing", { status: 404 });
    }
    if (mode === "offline" && key === urls.mapNames) {
      return new Response("offline", { status: 503 });
    }
    const body = bodies.get(key);
    assert.notEqual(body, undefined, `unexpected URL ${key}`);
    if (mode === "revalidate" && key !== urls.mapNames) {
      return new Response(null, { status: 304 });
    }
    return new Response(body, {
      headers: {
        etag: '"v1"',
        "last-modified": "Tue, 01 Sep 2026 00:00:00 GMT",
      },
    });
  };
  const source = createRemoteStDataSource({
    urls,
    fetchImpl,
    now: () => now,
    cacheTtlMs: 100,
  });

  const first = await source.fetchSearchData();
  const initialCalls = calls;
  now = 99;
  assert.equal(await source.fetchSearchData(), first);
  assert.equal(calls, initialCalls);

  mode = "revalidate";
  now = 100;
  assert.equal(await source.fetchSearchData(), first);
  assert.deepEqual(observedHeaders[1], ['"v1"', "Tue, 01 Sep 2026 00:00:00 GMT"]);

  mode = "offline";
  now = 200;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal(await source.fetchSearchData(), first);
  } finally {
    console.error = originalConsoleError;
  }

  mode = "fatal";
  now = 300;
  await assert.rejects(source.fetchSearchData(), MissingStageNameFilesError);
});
