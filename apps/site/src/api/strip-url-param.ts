export function stripUrlParam(rawUrl: string, param: string): string {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has(param)) return rawUrl;
    url.searchParams.delete(param);
    return url.toString();
  } catch {
    return rawUrl;
  }
}
