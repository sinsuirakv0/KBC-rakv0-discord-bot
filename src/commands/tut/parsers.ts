import { EnemyAliasEntry, TutRequest } from "./types";
import { parseMotionArguments } from "../shared/motion/parser";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTutRequest(args: readonly string[]): TutRequest {
  if (args.length === 0) return { kind: "landing" };

  let force = false;
  let origin = false;
  let file = false;
  const queryParts: string[] = [];
  const fileParts: string[] = [];
  const motionParts: string[] = [];
  let motion = false;
  for (const argument of args) {
    const normalized = argument.toLowerCase();
    if (normalized === "-f" || normalized === "-force") {
      force = true;
    } else if (normalized === "origin") {
      origin = true;
    } else if (normalized === "file" && !file) {
      file = true;
    } else if (normalized === "motion" && !motion) {
      motion = true;
    } else {
      (motion ? motionParts : file ? fileParts : queryParts).push(argument);
    }
  }
  const query = queryParts.join(" ").trim();
  if (!query) return { kind: "help" };
  if (file) {
    return !origin && !motion && fileParts.length === 0
      ? { kind: "search", query, force, origin: false, file: true }
      : { kind: "invalid-file" };
  }
  if (!motion) return { kind: "search", query, force, origin };
  const parsed = parseMotionArguments(motionParts);
  if (!parsed || origin) return { kind: "invalid-motion" };
  return {
    kind: "search", query, force, origin: false,
    motion: { format: parsed.format, full: parsed.full, segments: parsed.segments },
  };
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
