export interface GitHubStorageConfig {
  owner: string;
  repository: string;
  branch: string;
  token: string;
}

export const storageLimits = {
  requestTimeoutMs: 10_000,
  writeIntervalMs: 1_000,
  retryDelayMs: 30_000,
  maxDocumentBytes: 256 * 1024,
};

export function loadStorageConfig(environment: NodeJS.ProcessEnv = process.env): GitHubStorageConfig | undefined {
  const owner = environment.GITHUB_DATA_OWNER?.trim();
  const repository = environment.GITHUB_DATA_REPO?.trim();
  const token = environment.GITHUB_DATA_TOKEN?.trim();
  if (!owner && !repository && !token) return undefined;
  if (!owner || !repository || !token) throw new Error("GITHUB_DATA_OWNER, GITHUB_DATA_REPO and GITHUB_DATA_TOKEN are required together");
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid GitHub data repository");
  return { owner, repository, token, branch: environment.GITHUB_DATA_BRANCH?.trim() || "main" };
}
