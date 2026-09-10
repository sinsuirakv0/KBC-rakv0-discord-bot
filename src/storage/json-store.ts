import { DataRepository, StorageError } from "./types";

const storageManifest = { schemaVersion: 1, application: "kbc-discord-bot-data" };

export class JsonStore {
  private queue: Promise<unknown> = Promise.resolve();
  private initialized = false;

  constructor(private readonly repository: DataRepository) {}

  async initialize(createManifest = false): Promise<void> {
    this.initialized = false;
    await this.repository.verify();
    let manifest = await this.repository.read("meta.json");
    if (!manifest && createManifest) {
      await this.repository.write("meta.json", JSON.stringify(storageManifest));
      manifest = await this.repository.read("meta.json");
    }
    if (!manifest) throw new StorageError("initialization-required");
    const value = this.decode(manifest.content) as Partial<typeof storageManifest>;
    if (value?.schemaVersion !== 1 || value?.application !== storageManifest.application) throw new StorageError("invalid-manifest");
    this.initialized = true;
  }

  private assertReady(): void {
    if (!this.initialized) throw new StorageError("not-ready");
  }

  private decode(content: string): unknown {
    try { return JSON.parse(content.replace(/^\uFEFF/, "")); } catch { throw new StorageError("invalid-json"); }
  }

  async read<T>(path: string, parse: (value: unknown) => T): Promise<T | undefined> {
    this.assertReady();
    const file = await this.repository.read(path);
    return file ? parse(this.decode(file.content)) : undefined;
  }

  async list(directory: string): Promise<string[]> {
    this.assertReady();
    return this.repository.list(directory);
  }

  async update<T>(path: string, parse: (value: unknown) => T, change: (current: T | undefined) => T): Promise<T> {
    const task = this.queue.then(async () => {
      this.assertReady();
      const file = await this.repository.read(path);
      const current = file ? parse(this.decode(file.content)) : undefined;
      const value = parse(change(current === undefined ? undefined : structuredClone(current)));
      const content = JSON.stringify(value);
      if (!current || content !== JSON.stringify(current)) await this.repository.write(path, content, file?.sha);
      return structuredClone(value);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
