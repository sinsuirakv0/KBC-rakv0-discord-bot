export class MotionTimeoutError extends Error {
  constructor(reason: "total" | "stalled") {
    super(`Motion rendering timed out (${reason})`);
    this.name = "MotionTimeoutError";
  }
}

export function createMotionWatchdog(totalMs: number, stallMs: number) {
  let rejectTimeout!: (error: Error) => void;
  const expired = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const totalTimer = setTimeout(() => rejectTimeout(new MotionTimeoutError("total")), totalMs);
  let stallTimer: ReturnType<typeof setTimeout>;
  let disposed = false;
  const touch = () => {
    if (disposed) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => rejectTimeout(new MotionTimeoutError("stalled")), stallMs);
  };
  touch();
  return {
    expired,
    touch,
    dispose() { disposed = true; clearTimeout(totalTimer); clearTimeout(stallTimer); },
  };
}

export { MotionTimeoutError as UtMotionTimeoutError };
