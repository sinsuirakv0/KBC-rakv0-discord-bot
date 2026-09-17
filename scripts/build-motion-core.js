const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = path.join(root, "native", "motion-core", "Cargo.toml");
const outputDirectory = path.join(root, "dist", "commands", "shared", "motion");
const rustc = spawnSync("rustc", ["-vV"], { cwd: root, encoding: "utf8" });
if (rustc.status !== 0) {
  process.stderr.write(rustc.stderr || "rustc is unavailable\n");
  process.exit(rustc.status ?? 1);
}

const environment = { ...process.env };
const host = rustc.stdout.match(/^host: (.+)$/m)?.[1] ?? "";
const sysrootResult = spawnSync("rustc", ["--print", "sysroot"], {
  cwd: root,
  encoding: "utf8",
});
const sysroot = sysrootResult.stdout.trim();
if (process.platform === "win32" && host.endsWith("-gnullvm")) {
  const libnodeDirectory = path.join(tmpdir(), "kbc-motion-core-libnode");
  mkdirSync(libnodeDirectory, { recursive: true });
  copyFileSync(process.execPath, path.join(libnodeDirectory, "libnode.dll"));
  environment.LIBNODE_PATH = libnodeDirectory;
  environment.PATH = `${libnodeDirectory};${path.join(sysroot, "bin")};${environment.PATH}`;
}

const cargo = spawnSync("cargo", ["build", "--release", "--manifest-path", manifest], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});
if (cargo.status !== 0) process.exit(cargo.status ?? 1);

const libraryName = process.platform === "win32"
  ? "kbc_motion_core.dll"
  : process.platform === "darwin" ? "libkbc_motion_core.dylib" : "libkbc_motion_core.so";
const source = path.join(root, "native", "motion-core", "target", "release", libraryName);
mkdirSync(outputDirectory, { recursive: true });
copyFileSync(source, path.join(outputDirectory, "kbc_motion_core.node"));

const unwind = path.join(sysroot, "bin", "libunwind.dll");
if (process.platform === "win32" && existsSync(unwind)) {
  copyFileSync(unwind, path.join(outputDirectory, "libunwind.dll"));
}
