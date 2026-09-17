const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadImage } = require("@napi-rs/canvas");
const legacy = require("../dist/commands/shared/motion/vendor/motion-engine");
const rust = require("../dist/commands/shared/motion/kbc_motion_core.node");
const { hashMotionPackets } = require("../dist/commands/shared/motion/packet-hash");

const imgcutText = [
  "[imgcut]",
  "1",
  "sprite.png",
  "2",
  "0,0,32,32,root",
  "32,0,32,32,child",
].join("\n");

const modelText = [
  "[mamodel]",
  "3",
  "2",
  "-1,0,0,0,0,0,0,0,1000,1000,0,255,0,root",
  "0,1,1,1,20,10,4,5,900,1100,100,200,1,child",
  "1000,3600,255",
  "1",
  "1,0,4,5,0,0,anchor",
].join("\n");

function track(part, property, loop, keys, name = "") {
  return [
    `${part},${property},${loop},0,0,${name}`,
    String(keys.length),
    ...keys.map((key) => key.join(",")),
  ];
}

const animationText = [
  "[modelanim:animation]",
  "1",
  "16",
  ...track(0, 4, -1, [[-5, 0, 0, 0], [5, 40, 0, 0]], "negative loop"),
  ...track(1, 0, 1, [[0, 0, 1, 0]], "parent"),
  ...track(1, 1, 1, [[0, 1, 1, 0]], "id"),
  ...track(1, 2, 1, [[0, 1, 1, 0], [200, 0, 1, 0]], "image"),
  ...track(1, 3, 1, [[0, 1, 0, 0], [399, -1, 0, 0]], "z"),
  ...track(1, 4, 1, [[0, 0, 0, 0], [100, 100, 0, 0], [399, -50, 0, 0]], "x"),
  ...track(1, 5, 1, [[0, 0, 1, 0], [200, 80, 0, 0], [399, -20, 0, 0]], "hold"),
  ...track(1, 6, 1, [[0, 0, 2, 2], [100, 20, 0, 0], [399, -4, 0, 0]], "easing"),
  ...track(1, 7, 1, [[0, 0, 3, 0], [40, 80, 3, 0], [80, 0, 0, 0], [399, 5, 0, 0]], "lagrange"),
  ...track(1, 8, 1, [[0, 1000, 0, 0], [399, 1200, 0, 0]], "scale"),
  ...track(1, 9, 1, [[0, 1000, 0, 0], [399, -800, 0, 0]], "scale x"),
  ...track(1, 10, 1, [[0, 1000, 0, 0], [399, 700, 0, 0]], "scale y"),
  ...track(1, 11, 1, [[0, 0, 0, 0], [399, 7200, 0, 0]], "angle"),
  ...track(1, 12, 1, [[0, 255, 0, 0], [399, 64, 0, 0]], "opacity"),
  ...track(1, 13, 1, [[0, 0, 1, 0], [150, 1, 1, 0]], "flip x"),
  ...track(1, 14, 1, [[0, 0, 1, 0], [250, 1, 1, 0]], "flip y"),
].join("\n");

function createProjects() {
  const image = { width: 64, height: 32, naturalWidth: 64, naturalHeight: 32 };
  return {
    legacy: legacy.createMotionProject({
      image,
      imgcut: legacy.parseImgCut(imgcutText),
      model: legacy.parseMaModel(modelText),
      motions: { attack: legacy.parseMaAnim(animationText) },
    }),
    rust: new rust.MotionCoreProject(
      imgcutText,
      modelText,
      [{ key: "attack", text: animationText }],
      64,
      32,
    ),
  };
}

test("Rust parsers match the JavaScript reference", () => {
  assert.deepEqual(JSON.parse(rust.parseImgCutJson(imgcutText)), legacy.parseImgCut(imgcutText));
  assert.deepEqual(JSON.parse(rust.parseMaModelJson(modelText)), legacy.parseMaModel(modelText));
  assert.deepEqual(JSON.parse(rust.parseMaAnimJson(animationText)), legacy.parseMaAnim(animationText));
});

test("Rust draw packets match hierarchy, properties, easing, Lagrange, loops, and sequential frames", () => {
  const projects = createProjects();
  assert.equal(projects.rust.getMaxFrame("attack"), 399);
  for (let frame = 0; frame <= 399; frame += 1) {
    const legacyPackets = legacy.buildNativeDrawPackets(
      projects.legacy,
      "attack",
      frame,
    ).packets;
    const rustPackets = projects.rust.buildDrawPackets("attack", frame);
    assert.deepEqual(rustPackets, legacyPackets, `frame ${frame}`);
    assert.equal(hashMotionPackets(rustPackets), hashMotionPackets(legacyPackets));
  }
});

test("Rust draw packets match transformed and interpolated output", () => {
  const projects = createProjects();
  const options = {
    originX: 123.5,
    originY: 45.25,
    scale: 0.75,
    facing: -1,
    alpha: 0.4,
    useModelAnchor: true,
    interpolate: true,
  };
  for (const frame of [0.5, 39.25, 149.5, 249.75, 398.5]) {
    assert.deepEqual(
      projects.rust.buildDrawPackets("attack", frame, options),
      legacy.buildNativeDrawPackets(projects.legacy, "attack", frame, options).packets,
      `interpolated frame ${frame}`,
    );
  }
});

test("Rust packets match representative real 710-f assets when available", async (t) => {
  const root = "D:/KBC/KBC-rakv0-assets/jp/sitedata";
  const required = [
    "Number/710_f.png",
    "ImageData/710_f.imgcut",
    "ImageData/710_f.mamodel",
    "ImageData/710_f00.maanim",
    "ImageData/710_f01.maanim",
    "ImageData/710_f02.maanim",
    "ImageData/710_f03.maanim",
  ];
  if (required.some((relative) => !fs.existsSync(path.join(root, relative)))) {
    t.skip("local real assets are unavailable");
    return;
  }
  const image = await loadImage(fs.readFileSync(path.join(root, required[0])));
  const imgcut = fs.readFileSync(path.join(root, required[1]), "utf8");
  const model = fs.readFileSync(path.join(root, required[2]), "utf8");
  const keys = ["move", "idle", "attack", "knockback"];
  const motionTexts = Object.fromEntries(keys.map((key, index) => [
    key,
    fs.readFileSync(path.join(root, required[index + 3]), "utf8"),
  ]));
  const legacyMotions = Object.fromEntries(
    Object.entries(motionTexts).map(([key, text]) => [key, legacy.parseMaAnim(text)]),
  );
  const legacyProject = legacy.createMotionProject({
    image,
    imgcut: legacy.parseImgCut(imgcut),
    model: legacy.parseMaModel(model),
    motions: legacyMotions,
  });
  const rustProject = new rust.MotionCoreProject(
    imgcut,
    model,
    Object.entries(motionTexts).map(([key, text]) => ({ key, text })),
    image.width,
    image.height,
  );
  for (const key of keys) {
    assert.equal(rustProject.getMaxFrame(key), legacyMotions[key].maxFrame);
    for (let frame = 0; frame <= legacyMotions[key].maxFrame; frame += 1) {
      assert.deepEqual(
        rustProject.buildDrawPackets(key, frame),
        legacy.buildNativeDrawPackets(legacyProject, key, frame).packets,
        `${key} frame ${frame}`,
      );
    }
  }
});
