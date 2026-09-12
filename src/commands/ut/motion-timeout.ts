export class UtMotionTimeoutError extends Error {
  constructor(reason: "total" | "stalled") {
    super(`Motion rendering timed out (${reason})`);
    this.name = "UtMotionTimeoutError";
  }
}

export function createMotionWatchdog(totalMs: number, stallMs: number) {
  let rejectTimeout!: (error: Error) => void;
  const expired = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const totalTimer = setTimeout(() => rejectTimeout(new UtMotionTimeoutError("total")), totalMs);
  let stallTimer: ReturnType<typeof setTimeout>;
  let disposed = false;
  const touch = () => {
    if (disposed) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => rejectTimeout(new UtMotionTimeoutError("stalled")), stallMs);
  };
  touch();
  return {
    expired,
    touch,
    dispose() { disposed = true; clearTimeout(totalTimer); clearTimeout(stallTimer); },
  };
}
