export type PhotoCredit = {
  text: string;
  source_url: string | null;
  license_url: string | null;
  license: string | null;
};

export function photoCreditLink(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const allowed = host === "commons.wikimedia.org" || host === "creativecommons.org" || host === "www.creativecommons.org" || host.endsWith(".gov");
    return allowed ? url.href : null;
  } catch { return null; }
}
