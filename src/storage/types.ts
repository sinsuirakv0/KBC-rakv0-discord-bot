export class StorageError extends Error {
  constructor(public readonly code: string, public readonly retryAfterMs = 0) {
    super(`Storage error: ${code}`);
  }
}

export interface RepositoryFile {
  content: string;
  sha: string;
}

export interface DataRepository {
  verify(): Promise<void>;
  read(path: string): Promise<RepositoryFile | undefined>;
  list(directory: string): Promise<string[]>;
  write(path: string, content: string, expectedSha?: string): Promise<void>;
}
