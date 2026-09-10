export const botAdministratorIds: readonly string[] = Object.freeze([
  "1447045405257760820",
  "1347420765410295928",
  "1138400546823340102",
]);

export function isBotAdministrator(userId: string): boolean {
  return botAdministratorIds.includes(userId);
}
