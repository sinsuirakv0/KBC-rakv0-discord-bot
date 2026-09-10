const test = require("node:test");
const assert = require("node:assert/strict");
const { GitHubDataRepository } = require("../dist/storage/github-repository");
const { JsonStore } = require("../dist/storage/json-store");
const { GuildSettingsStore } = require("../dist/storage/guild-settings");

function fixture() {
  const files = new Map();
  let mode = "";
  let calls = 0;
  let now = 100000;
  const repository = new GitHubDataRepository({ owner: "test", repository: "data", branch: "main", token: "secret" }, {
    now: () => now, sleep: async ms => { now += ms; },
    fetch: async (url, options) => {
      calls++;
      const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
      if (mode === "rate") return reply({}, 429, { "retry-after": "120" });
      if (mode === "auth") return reply({}, 404);
      if (!url.includes("/contents/")) return reply({ private: mode !== "public" });
      const path = url.split("/contents/")[1].split("?")[0];
      if (options.method === "PUT") {
        if (mode === "conflict") return reply({}, 409);
        const body = JSON.parse(options.body);
        assert.equal(body.sha, files.get(path)?.sha);
        files.set(path, { type: "file", encoding: "base64", content: body.content, sha: String(calls) });
        if (mode === "lost") throw new Error("response lost");
        return reply({});
      }
      return files.has(path) ? reply(files.get(path)) : reply({}, 404);
    },
  });
  return { files, repository, setMode: value => { mode = value; }, calls: () => calls };
}
test("initialization is explicit and rejects inaccessible, public and corrupt repositories", async () => {
  const f = fixture(); const store = new JsonStore(f.repository);
  await assert.rejects(store.initialize(), /initialization-required/);
  await store.initialize(true);
  f.files.set("meta.json", { type: "file", encoding: "base64", content: Buffer.from("{").toString("base64"), sha: "bad" });
  await assert.rejects(store.initialize(), /invalid-json/);
  f.setMode("public"); await assert.rejects(store.initialize(), /private-repository-required/);
  f.setMode("auth"); await assert.rejects(f.repository.read("missing.json"), /http-404/);
});
test("lost PUT response is confirmed by readback; conflict and rate limits do not overwrite", async () => {
  const f = fixture();
  f.setMode("lost"); await f.repository.write("data.json", '{"value":1}');
  f.setMode("conflict"); await assert.rejects(f.repository.write("data.json", '{"value":2}', "old"), /conflict/);
  assert.equal(Buffer.from(f.files.get("data.json").content,"base64").toString(), '{"value":1}');
  f.setMode("rate"); await assert.rejects(f.repository.read("data.json"), /rate-limited/);
  const count=f.calls(); await assert.rejects(f.repository.read("data.json"), /rate-limited/); assert.equal(f.calls(),count);
});
test("settings preserve other fields and only update cache after confirmed writes", async () => {
  const f=fixture(); const json=new JsonStore(f.repository); await json.initialize(true);
  const guilds=new GuildSettingsStore(json);
  await guilds.setHealthMaintainerRole("1","99");
  await guilds.setSubscription({guildId:"1",channelId:"10",category:"skd"},true);
  const saved=JSON.parse((await f.repository.read("config/guilds/1.json")).content);
  assert.equal(saved.healthMaintainerRoleId,"99");
  f.setMode("conflict");
  await assert.rejects(guilds.setSubscription({guildId:"1",channelId:"11",category:"ad"},true));
  assert.equal(guilds.subscriptions().length,1);
});
