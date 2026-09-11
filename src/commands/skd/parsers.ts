export function parseSkdDate(args: readonly string[]): string | undefined {
  if (!args.length) return undefined;
  const parts = args.join(" ").trim().split(/[\/\s]+/);
  if (parts.length !== 3 || !/^\d{4}$/.test(parts[0]) || parts.slice(1).some(part => !/^\d{1,2}$/.test(part))) {
    throw new Error("Invalid schedule date");
  }
  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Invalid schedule date");
  }
  return date.toISOString().slice(0, 10);
}
