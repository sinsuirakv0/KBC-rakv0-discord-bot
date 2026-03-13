import crypto from "crypto";

const KEY_BASE = "battlecats";

export const FILE_MAP: Record<string, string> = {
  "002a4b18244f32d7833fd81bc833b97f.dat": "sale.tsv",
  "09b1058188348630d98a08e0f731f6bd.dat": "gatya.tsv",
  "408f66def075926baea9466e70504a3b.dat": "item.tsv",
  "523af537946b79c4f8369ed39ba78605.dat": "ad.tsv",
  "sale.tsv": "002a4b18244f32d7833fd81bc833b97f.dat",
  "gatya.tsv": "09b1058188348630d98a08e0f731f6bd.dat",
  "item.tsv": "408f66def075926baea9466e70504a3b.dat",
  "ad.tsv": "523af537946b79c4f8369ed39ba78605.dat",
};

export const SALTS: Record<string, string> = {
  jp: "battlecats",
  kr: "battlecatskr",
  en: "battlecatsen",
  tw: "battlecatstw",
};

function getKey(): Buffer {
  const hash = crypto.createHash("md5").update(KEY_BASE).digest("hex");
  return Buffer.from(hash.substring(0, 16), "utf8");
}

/** .dat → 復号 → TSVバイト列 */
export function decryptDat(input: Buffer): Buffer {
  const key = getKey();
  const encryptedPart = input.slice(0, input.byteLength - 32);
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(encryptedPart), decipher.final()]);
}

/** TSVバイト列 → 暗号化 → .dat バイト列 */
export function encryptTsv(input: Buffer, locale: string): Buffer {
  const key = getKey();
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(true);
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);

  const salt = SALTS[locale] || "battlecats";
  const hash = crypto
    .createHash("md5")
    .update(Buffer.from(salt, "utf8"))
    .update(ciphertext)
    .digest("hex");

  return Buffer.concat([ciphertext, Buffer.from(hash, "utf8")]);
}

export function getOutputName(inputName: string): string {
  return FILE_MAP[inputName] ?? inputName;
}
