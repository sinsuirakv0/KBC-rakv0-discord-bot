import { GitHubStorageConfig, storageLimits } from "../config/storage";
import { DataRepository, RepositoryFile, StorageError } from "./types";

export class GitHubDataRepository implements DataRepository {
  private readonly baseUrl: string;
  private queue: Promise<unknown> = Promise.resolve();
  private lastWriteAt = 0;
  private cooldownUntil = 0;

  constructor(private readonly config: GitHubStorageConfig, private readonly dependencies = {
    fetch: globalThis.fetch,
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
  }) {
    this.baseUrl = `https://api.github.com/repos/${config.owner}/${config.repository}`;
  }

  private fileUrl(filePath: string): string {
    if (filePath.split("/").some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..")) {
      throw new StorageError("invalid-path");
    }
    return `${this.baseUrl}/contents/${filePath}`;
  }

  private async request(url: string, options: RequestInit = {}): Promise<Response> {
    const remaining = this.cooldownUntil - this.dependencies.now();
    if (remaining > 0) throw new StorageError("rate-limited", remaining);
    let response: Response;
    try {
      response = await this.dependencies.fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(storageLimits.requestTimeoutMs),
      });
    } catch { throw new StorageError("network-unavailable"); }
    if (response.status === 403 || response.status === 429) {
      const detail = await response.text();
      if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0"
        || response.headers.has("retry-after") || /rate limit|abuse/i.test(detail)) {
        const retry = response.headers.get("retry-after");
        const seconds = retry !== null ? Number(retry) : NaN;
        const retryAt = Number.isFinite(seconds) ? this.dependencies.now() + seconds * 1000 : Date.parse(retry || "");
        const resetAt = response.headers.get("x-ratelimit-remaining") === "0"
          ? Number(response.headers.get("x-ratelimit-reset")) * 1000 : 0;
        this.cooldownUntil = Math.max(this.dependencies.now() + 60_000, retryAt || 0, resetAt || 0);
        throw new StorageError("rate-limited", this.cooldownUntil - this.dependencies.now());
      }
      throw new StorageError("forbidden");
    }
    return response;
  }

  private async json(response: Response): Promise<any> {
    if (!response.ok) throw new StorageError(`http-${response.status}`);
    try { return await response.json(); } catch { throw new StorageError("invalid-response"); }
  }

  async verify(): Promise<void> {
    const repository = await this.json(await this.request(this.baseUrl));
    if (repository.private !== true) throw new StorageError("private-repository-required");
    if (repository.archived || repository.disabled) throw new StorageError("repository-unavailable");
    await this.json(await this.request(`${this.baseUrl}/branches/${encodeURIComponent(this.config.branch)}`));
  }

  async read(filePath: string): Promise<RepositoryFile | undefined> {
    const response = await this.request(`${this.fileUrl(filePath)}?ref=${encodeURIComponent(this.config.branch)}`);
    if (response.status === 404) { await this.verify(); return undefined; }
    const file = await this.json(response);
    if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string" || typeof file.sha !== "string") {
      throw new StorageError("invalid-file");
    }
    const bytes = Buffer.from(file.content, "base64");
    if (bytes.length > storageLimits.maxDocumentBytes) throw new StorageError("document-too-large");
    return { content: bytes.toString("utf8"), sha: file.sha };
  }

  async list(directory: string): Promise<string[]> {
    const response = await this.request(`${this.fileUrl(directory)}?ref=${encodeURIComponent(this.config.branch)}`);
    if (response.status === 404) { await this.verify(); return []; }
    const items = await this.json(response);
    if (!Array.isArray(items) || items.length >= 1000 || items.some(item => item.type !== "file"
      || typeof item.path !== "string" || !item.path.startsWith(`${directory}/`))) throw new StorageError("invalid-directory");
    return items.map(item => item.path);
  }

  async write(filePath: string, content: string, expectedSha?: string): Promise<void> {
    if (Buffer.byteLength(content) > storageLimits.maxDocumentBytes) throw new StorageError("document-too-large");
    const task = this.queue.then(async () => {
      const waitMs = this.lastWriteAt + storageLimits.writeIntervalMs - this.dependencies.now();
      if (waitMs > 0) await this.dependencies.sleep(waitMs);
      this.lastWriteAt = this.dependencies.now();
      try {
        const response = await this.request(this.fileUrl(filePath), {
          method: "PUT",
          body: JSON.stringify({ message: `Update ${filePath}`, branch: this.config.branch,
            content: Buffer.from(content).toString("base64"), ...(expectedSha ? { sha: expectedSha } : {}) }),
        });
        if (response.status === 409 || response.status === 422) throw new StorageError("conflict");
        await this.json(response);
      } catch (error) {
        if (!(error instanceof StorageError) || ["forbidden", "rate-limited", "http-401"].includes(error.code)) throw error;
        // 応答消失時は実際の保存内容を確認し、古いJSONで上書きしない。
        const confirmed = await this.read(filePath);
        if (confirmed?.content !== content) throw error;
      }
    });
    this.queue = task.catch(() => undefined);
    await task;
  }
}
