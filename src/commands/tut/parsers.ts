import { EnemyAliasEntry, TutRequest } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTutRequest(args: readonly string[]): TutRequest {
  if (args.length === 0) return { kind: "landing" };

  let force = false;
  let origin = false;
  const queryParts: string[] = [];
  for (const argument of args) {
    const normalized = argument.toLowerCase();
    if (normalized === "-f" || normalized === "-force") {
      force = true;
    } else if (normalized === "origin") {
      origin = true;
    } else {
      queryParts.push(argument);
    }
  }
  const query = queryParts.join(" ").trim();
  return query ? { kind: "search", query, force, origin } : { kind: "help" };
}

export function parseEnemyNameTsv(text: string): readonly (string | undefined)[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) {
    throw new Error("Invalid Enemyname.tsv: rows are required");
  }
  const names = lines.map((line, index) => {
    if (/\t|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(line)) {
      throw new Error(`Invalid Enemyname.tsv: row ${index + 1} is invalid`);
    }
    return line.trim() ? line : undefined;
  });
  if (!names.some(Boolean)) {
    throw new Error("Invalid Enemyname.tsv: searchable names are required");
  }
  return names;
}

export function parseEnemyAliases(value: unknown): readonly EnemyAliasEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Invalid enemyname.json: a non-empty array is required");
  }
  const seenIds = new Set<number>();
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !Number.isSafeInteger(entry.id) ||
      (entry.id as number) < 0 ||
      seenIds.has(entry.id as number) ||
      !Array.isArray(entry.names) ||
      entry.names.some((name) => typeof name !== "string" || !name.trim())
    ) {
      throw new Error(`Invalid enemyname.json: entry ${index} is invalid`);
    }
    const id = entry.id as number;
    seenIds.add(id);
    return { id, names: entry.names as string[] };
  });
}

export function parseEnemyAliasJson(text: string): readonly EnemyAliasEntry[] {
  try {
    return parseEnemyAliases(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Invalid enemyname.json: response is not JSON");
    }
    throw error;
  }
}
