const assert = require("node:assert/strict");
const test = require("node:test");

const { createUtCommand } = require("../dist/commands/ut/command");
const { createRemoteUtDataSource } = require("../dist/commands/ut/data-source");
const { createUtMotionRenderer } = require("../dist/commands/ut/motion-renderer");
const { createUtMotionProgress } = require("../dist/commands/ut/motion-progress");
const { createMotionCanvas } = require("../dist/commands/ut/motion-canvas");
const {
  normalizeSearchText,
  resolveMotionAssetPlan,
  resolveOriginAssetPath,
  searchCharacterIndex,
} = require("../dist/commands/ut/domain");
const {
  parseCharacterAssets,
  parseCharacterIndex,
  parseUnitBuy,
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
    async fetchUnitBuy() {
      return {
        units: index.units.map((entry) => ({
          id: entry.id,
          sharedFormIds: [undefined, undefined],
        })),
      };
    },
    async fetchAsset() { throw new Error("asset must not be requested"); },
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
  assert.deepEqual(parseUtRequest(["ネコ", "origin", "sprite", "c"]), {
    kind: "search",
    query: "ネコ",
    force: false,
    origin: { family: "sprite", variant: "c" },
  });
  assert.deepEqual(parseUtRequest(["ネコ", "motion", "png", "s", "a", "15"]), {
    kind: "search",
    query: "ネコ",
    force: false,
    motion: {
      format: "png",
      form: "s",
      segments: [{ motion: "attack", frame: 15 }],
    },
  });
  assert.deepEqual(parseUtRequest(["ネコ", "motion", "gif", "w", "1~~15", "i", "1", "30", "k"]), {
    kind: "search",
    query: "ネコ",
    force: false,
    motion: {
      format: "gif",
      form: "f",
      segments: [
        { motion: "move", range: { start: 1, end: 15 } },
        { motion: "idle", range: { start: 1, end: 30 } },
        { motion: "knockback" },
      ],
    },
  });
  assert.deepEqual(parseUtRequest(["ネコ", "motion", "png", "a", "1~~2"]), {
    kind: "invalid-motion",
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
      i: "ImageData/{id}{suffix}",
      un: "Unit/uni{id}{suffix}",
      uu: "Unit/udi{id}{suffix}",
      g: "Image/gatyachara_{id}{suffix}",
      x: "{suffix}",
    },
    units: [{
      id: "000",
      i: ["_f.imgcut", "_f.mamodel"],
      un: ["_f00.png", "_c00.png"],
      uu: ["_u.png"],
      g: ["_f.png", "_m.png", "_z.png"],
    }],
  });
  assert.equal(
    resolveOriginAssetPath(
      assets,
      { units: [{ id: "000", sharedFormIds: [undefined, undefined] }] },
      "000",
      { family: "icon", variant: "c" },
    ),
    "Unit/uni000_c00.png",
  );
  assert.equal(
    resolveOriginAssetPath(
      assets,
      { units: [{ id: "000", sharedFormIds: [undefined, undefined] }] },
      "000",
      { family: "wide", variant: "u" },
    ),
    "Unit/udi000_u.png",
  );
  assert.equal(
    resolveOriginAssetPath(assets, { units: [] }, "000", { family: "gacha", variant: "m" }),
    "Image/gatyachara_000_m.png",
  );
  assert.equal(
    resolveOriginAssetPath(
      assets,
      { units: [{ id: "000", sharedFormIds: [undefined, undefined] }] },
      "000",
      { family: "icon", variant: "s" },
    ),
    undefined,
  );
  assert.throws(
    () => parseCharacterAssets({
      pathTemplates: {
        i: "ImageData/{id}{suffix}",
        un: "Unit/uni{id}{suffix}",
        uu: "Unit/udi{id}{suffix}",
        g: "Image/gatyachara_{id}{suffix}",
        x: "{suffix}",
      },
      units: [{ id: "000", x: ["../secret.png"] }],
    }),
    /Unsafe character asset path/,
  );

  const unitBuyRow = Array(63).fill("0");
  unitBuyRow[61] = "0";
  unitBuyRow[62] = "1";
  assert.deepEqual(parseUnitBuy(unitBuyRow.join(",")).units[0].sharedFormIds, ["000", "001"]);
});

test("ut resolves shared egg assets for origin and motion", () => {
  const units = [];
  units[0] = {
    id: "000",
    suffixes: {
      i: ["_m.imgcut", "_m.mamodel", "_m00.maanim", "_m02.maanim"],
      un: ["_m00.png"],
      uu: ["_m00.png"],
    },
  };
  units[1] = {
    id: "001",
    suffixes: {
      i: ["_m.imgcut", "_m.mamodel", "_m00.maanim"],
      un: ["_m01.png"],
      uu: ["_m01.png"],
    },
  };
  const unitBuyUnits = [];
  unitBuyUnits[656] = { id: "656", sharedFormIds: ["000", "001"] };
  const assets = {
    pathTemplates: {
      i: "ImageData/{id}{suffix}",
      un: "Unit/uni{id}{suffix}",
      uu: "Unit/udi{id}{suffix}",
      g: "Image/gatyachara_{id}{suffix}",
    },
    units,
  };
  const unitBuy = { units: unitBuyUnits };

  assert.equal(
    resolveOriginAssetPath(assets, unitBuy, "656", { family: "wide", variant: "f" }),
    "Unit/udi000_m00.png",
  );
  assert.equal(
    resolveOriginAssetPath(assets, unitBuy, "656", { family: "sprite", variant: "f" }),
    "Number/000_m.png",
  );
  assert.equal(
    resolveOriginAssetPath(assets, unitBuy, "656", { family: "icon", variant: "c" }),
    "Unit/uni001_m01.png",
  );
  assert.deepEqual(
    resolveMotionAssetPlan(assets, unitBuy, "656", {
      format: "mp4",
      form: "f",
      segments: [
        { motion: "move", range: { start: 1, end: 15 } },
        { motion: "attack" },
      ],
    }),
    {
      id: "656",
      form: "f",
      format: "mp4",
      segments: [
        { motion: "move", range: { start: 1, end: 15 } },
        { motion: "attack" },
      ],
      spritePath: "Number/000_m.png",
      imgcutPath: "ImageData/000_m.imgcut",
      modelPath: "ImageData/000_m.mamodel",
      animationPaths: {
        move: "ImageData/000_m00.maanim",
        attack: "ImageData/000_m02.maanim",
      },
    },
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

test("ut motion resolves assets and sends the renderer output", async () => {
  const index = { units: [unit(0, "ネコ")] };
  const assets = {
    pathTemplates: {
      i: "ImageData/{id}{suffix}",
      un: "Unit/uni{id}{suffix}",
      uu: "Unit/udi{id}{suffix}",
      g: "Image/gatyachara_{id}{suffix}",
    },
    units: [{
      id: "000",
      suffixes: {
        i: ["_f.imgcut", "_f.mamodel", "_f00.maanim", "_f02.maanim"],
      },
    }],
  };
  const fetchedPaths = [];
  const plans = [];
  const output = createFakeOutput();
  const command = createUtCommand({
    dataSource: dataSourceFor(index, {
      async fetchCharacterAssets() { return assets; },
      async fetchAsset(relativePath) {
        fetchedPaths.push(relativePath);
        return Uint8Array.from([1]);
      },
    }),
    motionRenderer: {
      async render(plan, fetchAsset) {
        plans.push(plan);
        await fetchAsset(plan.spritePath);
        return { data: Uint8Array.from([9]), filename: "motion.mp4" };
      },
    },
  });
  await command.execute(
    commandContext(output),
    ["ネコ", "motion", "mp4", "w", "1", "2", "a"],
  );

  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].animationPaths, {
    move: "ImageData/000_f00.maanim",
    attack: "ImageData/000_f02.maanim",
  });
  assert.deepEqual(fetchedPaths, ["Number/000_f.png"]);
  assert.equal(output.attachments[0].filename, "motion.mp4");
  assert.equal(output.messages.length, 2);
  assert.match(output.messages[0].content, /生成・送信が完了/);
  assert.ok(output.messages[0].events.some((event) => event[0] === "edit" && /送信しています/.test(event[1])));
});

test("ut motion progress throttles, coalesces slow edits, and preserves the final status", async () => {
  let time = 0;
  const events = [];
  let releaseEdit;
  const progress = createUtMotionProgress({
    async edit(content) {
      events.push(content);
      if (events.length === 2) await new Promise((resolve) => { releaseEdit = resolve; });
    },
  }, () => time);
  await progress.update({ stage: "rendering", completedFrames: 1, totalFrames: 10 });
  time = 500;
  await progress.update({ stage: "rendering", completedFrames: 2, totalFrames: 10 });
  assert.equal(events.length, 1);
  assert.match(events[0], /10%（1\/10フレーム）/);
  time = 2_000;
  void progress.update({ stage: "rendering", completedFrames: 5, totalFrames: 10 });
  await Promise.resolve();
  assert.match(events[1], /50%/);
  time = 4_000;
  void progress.update({ stage: "rendering", completedFrames: 9, totalFrames: 10 });
  const finished = progress.finish("完了");
  releaseEdit();
  await finished;
  await progress.update({ stage: "encoding" });
  assert.equal(events.at(-1), "完了");
  assert.equal(events.length, 3);
});

async function motionFixture() {
  const { createCanvas } = require("@napi-rs/canvas");
  const sprite = createCanvas(64, 32);
  const context = sprite.getContext("2d");
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = "#00ff00";
  context.fillRect(32, 0, 32, 32);
  const animation = (first, last) => Buffer.from(
    `[modelanim:animation]\n1\n1\n0,2,1,0,0\n2\n0,${first},1,0\n1,${last},1,0\n`,
  );
  const files = {
    "sprite.png": await sprite.encode("png"),
    "model.imgcut": Buffer.from("[imgcut]\n1\nsprite.png\n2\n0,0,32,32\n32,0,32,32\n"),
    "model.mamodel": Buffer.from("[mamodel]\n1\n1\n-1,0,0,0,0,0,0,0,1000,1000,0,255,0\n1000,3600,255\n"),
    "move.maanim": animation(0, 1),
    "attack.maanim": animation(1, 0),
  };
  return {
    plan: {
      id: "001", form: "f", format: "png", segments: [{ motion: "move", frame: 0 }],
      spritePath: "sprite.png", imgcutPath: "model.imgcut", modelPath: "model.mamodel",
      animationPaths: { move: "move.maanim", attack: "attack.maanim" },
    },
    fetchAsset: async (name) => files[name],
  };
}

test("ut worker writes PNG/MP4/GIF with inclusive segments in order and preserves blend modes", async () => {
  const { execFileSync } = require("node:child_process");
  const { createCanvas, loadImage } = require("@napi-rs/canvas");
  const ffmpeg = require("ffmpeg-static");
  const { plan, fetchAsset } = await motionFixture();
  const renderer = createUtMotionRenderer();
  const png = await renderer.render(plan, fetchAsset);
  const image = await loadImage(Buffer.from(png.data));
  assert.deepEqual([image.width, image.height], [32, 32]);
  const decoded = createCanvas(image.width, image.height);
  decoded.getContext("2d").drawImage(image, 0, 0);
  const pixelOffset = (16 * image.width + 16) * 4;
  assert.deepEqual([...decoded.data().subarray(pixelOffset, pixelOffset + 3)], [255, 0, 0]);

  const segments = [
    { motion: "move", range: { start: 0, end: 1 } },
    { motion: "attack", range: { start: 1, end: 1 } },
    { motion: "move", range: { start: 0, end: 0 } },
  ];
  for (const format of ["mp4", "gif"]) {
    const result = await renderer.render({ ...plan, format, segments }, fetchAsset);
    const frames = execFileSync(ffmpeg, [
      "-v", "error", "-threads", "1", "-i", "pipe:0", "-fps_mode", "passthrough",
      "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
    ], { input: result.data, windowsHide: true, maxBuffer: 6 * 1024 * 1024, timeout: 10_000 });
    const frameSize = image.width * image.height * 4;
    assert.equal(frames.length, frameSize * 4);
    assert.deepEqual([0, 1, 2, 3].map((index) => {
      const offset = index * frameSize + pixelOffset;
      return frames[offset] > frames[offset + 1] ? "red" : "green";
    }), ["red", "green", "red", "red"]);
  }

  const sprite = await loadImage(Buffer.from(await fetchAsset(plan.spritePath)));
  const { canvas, draw } = createMotionCanvas(sprite, 32, 32);
  const expectedColors = [[146, 21, 25], [165, 42, 50], [19, 0, 0], [146, 42, 50]];
  for (let blendMode = 0; blendMode < 4; blendMode += 1) {
    draw([{ partIndex: 0, positions: [0, 0, 0, 32, 32, 32, 32, 0], uvs: [0, 0, 0, 1, 0.5, 1, 0.5, 0], opacity: 0.5, blendMode }]);
    const color = [...canvas.data().subarray((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 3)];
    assert.ok(color.every((value, index) => Math.abs(value - expectedColors[blendMode][index]) <= 1), `${blendMode}: ${color}`);
  }
});

test("ut renderer defers queued loading, releases failures, and never starts an encoder after cancellation", async (t) => {
  const { plan, fetchAsset } = await motionFixture();
  const renderer = createUtMotionRenderer();
  let rejectFetch;
  const pendingFetch = new Promise((_, reject) => { rejectFetch = reject; });
  const failed = assert.rejects(renderer.render(plan, () => pendingFetch), /unavailable/);
  const progress = [];
  let fetchCount = 0;
  const next = renderer.render(plan, async (name) => {
    fetchCount += 1;
    return fetchAsset(name);
  }, (value) => progress.push(value.stage));
  assert.deepEqual(progress, ["queued"]);
  assert.equal(fetchCount, 0);
  rejectFetch(new Error("unavailable"));
  await failed;
  assert.ok(await next);
  assert.deepEqual(progress.slice(0, 2), ["queued", "loading"]);
  const invalid = await renderer.render({ ...plan, segments: [{ motion: "move", frame: 2 }] }, fetchAsset);
  assert.equal(invalid, undefined);
  assert.ok(await renderer.render(plan, fetchAsset));
  await assert.rejects(createUtMotionRenderer({ timeoutMs: 1 }).render(plan, fetchAsset), /timed out/);
  const timeouts = require("../dist/commands/ut/motion-timeout");
  const files = require("node:fs/promises");
  const writeFile = files.writeFile;
  let cancelWrite;
  let encoderStarts = 0;
  t.mock.method(timeouts, "createMotionWatchdog", () => ({
    expired: new Promise((_, reject) => { cancelWrite = () => reject(new timeouts.UtMotionTimeoutError("total")); }),
    touch() {}, dispose() {},
  }));
  t.mock.method(files, "writeFile", async (...args) => {
    cancelWrite();
    await writeFile(...args);
  });
  t.mock.method(require("node:child_process"), "spawn", () => {
    encoderStarts += 1;
    throw new Error("Encoder started after cancellation");
  });
  await assert.rejects(renderer.render({ ...plan, format: "gif" }, fetchAsset), /timed out/);
  assert.equal(encoderStarts, 0);
  t.mock.restoreAll();
  assert.ok(await renderer.render(plan, fetchAsset));
});

test("ut layout fits all ordinary frames, crops extreme parts, and ignores transparent margins", async () => {
  const { createMotionLayout } = require("../dist/commands/ut/motion-layout");
  const { createVisibleCutBounds } = require("../dist/commands/ut/motion-canvas");
  const { createCanvas, loadImage } = require("@napi-rs/canvas");
  const { utMotionMaxPixels, utMotionMaxDimension, utMotionPadding } = require("../dist/config/ut");
  const whole = { left: 0, top: 0, right: 1, bottom: 1 };
  const packet = (partIndex, positions) => ({ partIndex, positions, opacity: 1, blendMode: 0, uvs: [0, 0, 0, 1, 1, 1, 1, 0] });
  const normal = [
    packet(0, [-50, -100, -50, 0, 50, 0, 50, -100]),
    packet(1, [-70, -120, -100, -90, 0, 10, 30, -20]),
    packet(0, [100, -200, 100, -100, 200, -100, 200, -200]),
  ];
  const layout = createMotionLayout(() => whole, { width: 1, height: 1 });
  normal.forEach(value => layout.add([value]));
  layout.add([packet(2, [0, -10000, 0, 0, 10, 0, 10, -10000])]);
  const view = layout.finish(1);
  assert.deepEqual(view.clippedParts, [2]);
  for (const { positions } of normal) {
    for (let index = 0; index < positions.length; index += 2) {
      const x = positions[index] * view.scale + view.originX;
      const y = positions[index + 1] * view.scale + view.originY;
      assert.ok(x >= utMotionPadding && x <= view.width - utMotionPadding);
      assert.ok(y >= utMotionPadding && y <= view.height - utMotionPadding);
    }
  }
  assert.ok(-10000 * view.scale + view.originY < 0);
  const giant = createMotionLayout(() => whole, { width: 1, height: 1 });
  giant.add([packet(0, [0, -10000, 0, 0, 20000, 0, 20000, -10000])]);
  const capped = giant.finish(1);
  assert.deepEqual(capped.clippedParts, []);
  assert.ok(capped.width * capped.height <= utMotionMaxPixels);
  assert.ok(Math.max(capped.width, capped.height) <= utMotionMaxDimension);
  assert.equal(capped.width % 2 + capped.height % 2, 0);
  const largeBody = createMotionLayout(() => whole, { width: 1000, height: 1000 });
  largeBody.add([packet(0, [0, -1000, 0, 0, 1000, 0, 1000, -1000])]);
  for (let index = 1; index <= 10; index += 1) {
    largeBody.add([{ ...packet(index, [0, -10, 0, 0, 10, 0, 10, -10]), uvs: [0, 0, 0, 0.01, 0.01, 0.01, 0.01, 0] }]);
  }
  assert.deepEqual(largeBody.finish(1).clippedParts, []);

  const sprite = createCanvas(32, 32);
  sprite.getContext("2d").fillRect(8, 4, 16, 20);
  const visible = createVisibleCutBounds(await loadImage(await sprite.encode("png")), [{ x: 0, y: 0, width: 32, height: 32 }]);
  assert.deepEqual(visible(packet(0, [])), { left: 0.25, top: 0.125, right: 0.75, bottom: 0.75 });
  assert.equal(visible({ ...packet(0, []), blendMode: 1 }), undefined);
  assert.deepEqual(visible({ ...packet(0, []), blendMode: 2 }), whole);
});

test("ut watchdog renews only its idle deadline and still enforces the total limit", async (t) => {
  const { createMotionWatchdog } = require("../dist/commands/ut/motion-timeout");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watchdog = createMotionWatchdog(1000, 100);
  let expired = false;
  const completion = watchdog.expired.catch(error => { expired = true; return error.message; });
  t.mock.timers.tick(90);
  watchdog.touch();
  t.mock.timers.tick(90);
  await Promise.resolve();
  assert.equal(expired, false);
  t.mock.timers.tick(10);
  assert.match(await completion, /stalled/);
  watchdog.dispose();
  const limited = createMotionWatchdog(100, 90);
  const total = assert.rejects(limited.expired, /total/);
  t.mock.timers.tick(80);
  limited.touch();
  t.mock.timers.tick(20);
  await total;
  limited.dispose();
});

test("ut caches JSON for ten minutes, revalidates conditionally, updates content, and falls back stale", async () => {
  const urls = {
    characterIndex: "https://example.test/character-index.json",
    characterAssets: "https://example.test/character-assets.json",
    unitBuy: "https://example.test/unitbuy.csv",
    siteDataBase: "https://example.test/sitedata",
  };
  const indexV1 = JSON.stringify({ schemaVersion: 2, units: [unit(0, "ネコ")] });
  const indexV2 = JSON.stringify({ schemaVersion: 2, units: [unit(0, "ネコ", [], ["にゃんこ"])] });
  const assetsText = JSON.stringify({
    pathTemplates: {
      i: "ImageData/{id}{suffix}",
      un: "Unit/uni{id}{suffix}",
      uu: "Unit/udi{id}{suffix}",
      g: "Image/gatyachara_{id}{suffix}",
    },
    units: [{ id: "000", i: ["_f.imgcut", "_f.mamodel"], un: ["_f00.png"] }],
  });
  const unitBuyColumns = Array(63).fill("0");
  unitBuyColumns[61] = "-1";
  unitBuyColumns[62] = "-1";
  const unitBuyText = unitBuyColumns.join(",");
  let now = 0;
  let indexCall = 0;
  let assetsCalls = 0;
  let unitBuyCalls = 0;
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
    if (value.endsWith("unitbuy.csv")) {
      unitBuyCalls += 1;
      return new Response(unitBuyText);
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
  await source.fetchUnitBuy();
  await source.fetchPng("Unit/uni000_f00.png");
  await source.fetchPng("Unit/uni000_f00.png");
  assert.equal(assetsCalls, 1);
  assert.equal(unitBuyCalls, 1);
  assert.equal(pngCalls, 2);
});
