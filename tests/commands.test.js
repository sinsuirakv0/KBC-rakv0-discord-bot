const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { dispatchCommand } = require("../dist/commands/dispatcher");
const { parseCommandInput } = require("../dist/commands/input");
const {
  commandDefinitions,
  commandRegistry,
  createCommandRegistry,
  createStaticCommandDefinitions,
  staticCommandDefinitions,
} = require("../dist/commands/registry");
const {
  loadStaticCommandResponses,
  staticCommandResponses: staticResponses,
} = require("../dist/commands/static/data-source");

test("command input parser preserves the legacy prefix and lowercases names", () => {
  assert.deepEqual(parseCommandInput("o.PING one two", "o."), {
    name: "ping",
    args: ["one", "two"],
  });
  assert.equal(parseCommandInput("ping", "o."), undefined);
  assert.equal(parseCommandInput("o.   ", "o."), undefined);
});

test("registry derives every static command from response text files", () => {
  assert.equal(commandRegistry.resolve("PING")?.name, "ping");
  assert.equal(commandRegistry.resolve("sale")?.name, "sale");
  assert.equal(commandRegistry.resolve("gatya")?.name, "gatya");
  assert.equal(commandRegistry.resolve("item")?.name, "item");
  assert.equal(commandRegistry.resolve("st")?.name, "st");
  assert.equal(commandRegistry.resolve("tut")?.name, "tut");
  assert.equal(commandRegistry.resolve("enemy"), undefined);
  assert.equal(commandRegistry.resolve("ut")?.name, "ut");
  assert.equal(commandRegistry.resolve("help")?.name, "help");
  assert.equal(commandRegistry.resolve("skd")?.name, "skd");
  assert.deepEqual(
    new Set(staticCommandDefinitions.map((command) => command.name)),
    new Set(Object.keys(staticResponses)),
  );
  assert.deepEqual(
    new Set(commandDefinitions.map((command) => command.name)),
    new Set([...Object.keys(staticResponses), "help", "sale", "gatya", "item", "st", "tut", "ut", "push", "skd"]),
  );
});

test("editable command text files are BOM-prefixed but replies exclude it", async () => {
  const helpDirectory = path.join("content", "help");
  const helpFiles = fs.readdirSync(helpDirectory).filter((name) => name.endsWith(".txt"));
  for (const file of helpFiles) {
    const bytes = fs.readFileSync(path.join(helpDirectory, file));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  }
  for (const commandName of Object.keys(staticResponses)) {
    const bytes = fs.readFileSync(path.join("content", "responses", `${commandName}.txt`));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  }

  const replies = [];
  const context = {
    inGuild: true,
    async reply(content) { replies.push(content); },
  };
  await dispatchCommand({ name: "help", args: [] }, commandRegistry, context);
  await dispatchCommand({ name: "ping", args: ["help"] }, commandRegistry, context);
  assert.match(replies[0], /超健康bot Hugin コマンド一覧/);
  assert.match(replies[1], /o\.ping/);
  assert.doesNotMatch(replies.join("\n"), /\uFEFF/);
});

test("adding one text file is enough to create a static command", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "static-command-"));
  try {
    fs.writeFileSync(
      path.join(directory, "only_in_temp.txt"),
      "\uFEFFfirst line\r\n\r\nlast line\r\n",
    );
    const definitions = createStaticCommandDefinitions(
      loadStaticCommandResponses(directory),
    );
    const registry = createCommandRegistry(definitions);
    const replies = [];
    const context = {
      inGuild: true,
      async reply(content) {
        replies.push(content);
      },
    };
    for (const args of [["ignored"], ["help"]]) {
      assert.equal(
        await dispatchCommand({ name: "only_in_temp", args }, registry, context),
        true,
      );
    }
    assert.deepEqual(replies, [
      "first line\n\nlast line",
      "first line\n\nlast line",
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("registry rejects duplicate names and aliases", () => {
  const command = {
    name: "ping",
    aliases: ["p"],
    guildOnly: true,
    async execute() {},
  };

  assert.throws(
    () => createCommandRegistry([command, { ...command, name: "P" }]),
    /Duplicate command registration: p/,
  );
});

test("dispatcher sends the legacy static response and ignores arguments", async () => {
  const replies = [];
  const handled = await dispatchCommand(
    { name: "ping", args: ["ignored"] },
    commandRegistry,
    {
      inGuild: true,
      async reply(content) {
        replies.push(content);
      },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(replies, ["pong!!"]);
});

test("dispatcher ignores unknown commands and guild-only commands in DMs", async () => {
  const replies = [];
  const context = {
    inGuild: false,
    async reply(content) {
      replies.push(content);
    },
  };

  assert.equal(
    await dispatchCommand({ name: "unknown", args: [] }, commandRegistry, context),
    false,
  );
  assert.equal(
    await dispatchCommand({ name: "home", args: [] }, commandRegistry, context),
    false,
  );
  assert.deepEqual(replies, []);
});


test("Discord messages recognize exactly the three configured administrators", async () => {
  const { handleDiscordMessage } = require("../dist/discord/message-handler");
  const { botAdministratorIds } = require("../dist/config/administrators");
  const recognized = [];
  const registry = createCommandRegistry([{ name: "probe", guildOnly: true, async execute(context) { recognized.push(context.isBotAdministrator); } }]);
  for (const id of [...botAdministratorIds, "999999999999999999"]) {
    await handleDiscordMessage({ author: { id, bot: false }, content: "o.probe", guildId: "1", channelId: "2", inGuild: () => true, channel: { send: async () => {} } }, { prefix: "o.", registry });
  }
  assert.deepEqual(recognized, [true, true, true, false]);
});
