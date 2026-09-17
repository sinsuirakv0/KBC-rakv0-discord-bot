import { resolveMotionAssetPlan } from "./domain";
import {
  UtDataSource,
  UtMotionAssetPlan,
  UtMotionRequest,
  UtSearchMatch,
} from "./types";

export type PreparedUtMotion =
  | { kind: "ok"; plan: UtMotionAssetPlan }
  | { kind: "data-error" }
  | { kind: "missing" };

export async function prepareUtMotion(
  match: UtSearchMatch,
  request: UtMotionRequest,
  dataSource: UtDataSource,
): Promise<PreparedUtMotion> {
  try {
    const unitBuy = await dataSource.fetchUnitBuy();
    const plan = resolveMotionAssetPlan(unitBuy, match.unit.id, request);
    if (!plan) return { kind: "missing" };
    const requiredPaths = [
      plan.spritePath,
      plan.imgcutPath,
      plan.modelPath,
      ...Object.values(plan.animationPaths).filter(
        (relativePath): relativePath is string => Boolean(relativePath),
      ),
    ];
    const existing = await dataSource.findExistingAssets(requiredPaths);
    return requiredPaths.some((relativePath) => !existing.has(relativePath))
      ? { kind: "missing" }
      : { kind: "ok", plan };
  } catch (error) {
    console.error("Ut motion data retrieval failed.", error);
    return { kind: "data-error" };
  }
}
