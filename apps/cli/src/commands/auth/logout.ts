/**
 * Logout command
 */

import { output } from "../../utils/output.js";
import { clearSession } from "../../utils/config.js";

export async function logout(): Promise<void> {
  await clearSession();
  output.success("Logged out");
}
