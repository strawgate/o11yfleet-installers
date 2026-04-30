const CONFIGURATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function portalBreadcrumbConfigurationId(pathname: string): string | undefined {
  const match = pathname.match(/^\/portal\/configurations\/([^/]+)/);
  if (!match?.[1]) {
    return undefined;
  }

  const configurationId = safeDecodePathSegment(match[1]);
  return CONFIGURATION_ID_PATTERN.test(configurationId) ? configurationId : undefined;
}

export function portalBreadcrumbLabel(
  segment: string,
  index: number,
  segments: string[],
  options: { configurationId?: string; configurationName?: string } = {},
): string {
  const decoded = safeDecodePathSegment(segment);
  if (
    index === 1 &&
    segments[0] === "configurations" &&
    options.configurationName &&
    decoded === options.configurationId
  ) {
    return options.configurationName;
  }

  return decoded.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeDecodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
