export const SESSION_COOKIE = "session";

export function parseSessionId(value: string | undefined): string | undefined {
  if (!value || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    return undefined;
  }
  return value;
}
