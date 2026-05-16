const DEFAULT_APP_RELEASE_VERSION = "v1.0.0";

export function formatAppReleaseVersion(rawReleaseTag?: string | null): string {
  const value = rawReleaseTag?.trim();
  if (!value) return DEFAULT_APP_RELEASE_VERSION;

  const semverMatch = value.match(/(?:^|[^0-9A-Za-z])((?:v)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i);
  if (!semverMatch?.[1]) return value;

  return semverMatch[1].startsWith("v") ? semverMatch[1] : `v${semverMatch[1]}`;
}

export function getAppReleaseVersion(): string {
  return formatAppReleaseVersion(process.env.NEXT_PUBLIC_APP_RELEASE_TAG);
}
