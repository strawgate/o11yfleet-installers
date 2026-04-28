import { basename } from "node:path";

export const PRIMARY_COMMAND = "ofleet";
export const LEGACY_COMMAND = "o11y";

export function getCommandName(): string {
  const invoked = basename(process.argv[1] ?? PRIMARY_COMMAND);
  return invoked === LEGACY_COMMAND ? LEGACY_COMMAND : PRIMARY_COMMAND;
}
