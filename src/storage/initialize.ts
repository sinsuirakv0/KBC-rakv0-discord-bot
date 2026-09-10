import "dotenv/config";
import { initializeStorage } from "./runtime";
import { StorageError } from "./types";
void initializeStorage(true).then(() => console.log("GitHub storage initialized and verified.")).catch(error => {
  console.error("Storage initialization failed.", error instanceof StorageError ? error.code : "configuration-error");
  process.exitCode = 1;
});
