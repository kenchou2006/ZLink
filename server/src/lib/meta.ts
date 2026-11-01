import type { Env } from "../env";

export interface BuildMeta {
  basePath: string;
  builtAt: string;
  rootReservedNames?: string[];
}

let cachedBuildMeta: BuildMeta | null | undefined = undefined;

export function resetBuildMetaCache(): void {
  cachedBuildMeta = undefined;
}

export function setBuildMetaCache(meta: BuildMeta | null): void {
  cachedBuildMeta = meta;
}

export async function getBuildMeta(
  env: Env,
  reqUrl: string,
): Promise<BuildMeta | null> {
  if (cachedBuildMeta !== undefined) {
    return cachedBuildMeta;
  }
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    cachedBuildMeta = null;
    return null;
  }
  try {
    const res = await env.ASSETS.fetch(
      new Request(new URL("/__admin/build-meta.json", reqUrl)),
    );
    if (res.ok) {
      cachedBuildMeta = (await res.json()) as BuildMeta;
      return cachedBuildMeta;
    }
  } catch (e) {
    console.error("Failed to read build-meta.json:", e);
  }
  cachedBuildMeta = null;
  return null;
}
