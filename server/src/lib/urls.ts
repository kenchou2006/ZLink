export interface AppUrls {
  shortLinkUrl: string;
  shortOrigin: string;
  shortHost: string;
  shortHostname: string;
  shortBase: string; // e.g. "" or "/s"

  adminUrl: string;
  adminOrigin: string;
  adminHost: string;
  adminHostname: string;
  adminBase: string; // e.g. "" or "/admin" or "/zlink"
  adminBaseHref: string; // e.g. "/" or "/admin/" or "/zlink/"
}

export type EnvUrlsLike = {
  SHORT_LINK_URL?: string;
  ADMIN_URL?: string;
  SITE_ORIGIN?: string;
};

export function resolveAppUrls(env: EnvUrlsLike, requestUrl?: string): AppUrls {
  const shortRaw =
    env.SHORT_LINK_URL?.trim() ||
    env.SITE_ORIGIN?.trim() ||
    (requestUrl ? new URL(requestUrl).origin : "http://localhost:8787");
  const shortNormalized = shortRaw.replace(/\/+$/, "");
  const shortObj = new URL(shortNormalized);
  const shortOrigin = shortObj.origin;
  const shortHost = shortObj.host.toLowerCase();
  const shortHostname = shortObj.hostname.toLowerCase();
  const shortBase =
    shortObj.pathname === "/" ? "" : shortObj.pathname.replace(/\/+$/, "");

  let adminRaw = env.ADMIN_URL?.trim();
  if (!adminRaw) {
    adminRaw = `${shortNormalized}/admin`;
  }
  const adminNormalized = adminRaw.replace(/\/+$/, "");
  const adminObj = new URL(adminNormalized);
  const adminOrigin = adminObj.origin;
  const adminHost = adminObj.host.toLowerCase();
  const adminHostname = adminObj.hostname.toLowerCase();
  const adminBase =
    adminObj.pathname === "/" ? "" : adminObj.pathname.replace(/\/+$/, "");
  const adminBaseHref = adminBase ? `${adminBase}/` : "/";

  return {
    shortLinkUrl: shortNormalized,
    shortOrigin,
    shortHost,
    shortHostname,
    shortBase,

    adminUrl: adminNormalized,
    adminOrigin,
    adminHost,
    adminHostname,
    adminBase,
    adminBaseHref,
  };
}

export function hostsMatch(host1: string, host2: string): boolean {
  const h1 = host1.toLowerCase();
  const h2 = host2.toLowerCase();
  if (h1 === h2) return true;

  const [name1, port1 = ""] = h1.split(":");
  const [name2, port2 = ""] = h2.split(":");

  const isLoopback = (n: string) =>
    n === "localhost" || n === "127.0.0.1" || n === "[::1]";
  if (port1 === port2 && isLoopback(name1) && isLoopback(name2)) {
    return true;
  }

  return false;
}
