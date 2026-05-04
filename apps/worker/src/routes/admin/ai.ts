// Admin AI guidance and chat endpoints

import { Hono } from "hono";
import type { AdminEnv } from "./shared.js";
import { handleAdminGuidanceRequest, handleAdminChatRequest } from "../../ai/guidance.js";

// ─── Sub-router ─────────────────────────────────────────────────────

export const aiRoutes = new Hono<AdminEnv>();

aiRoutes.post("/ai/guidance", async (c) => {
  return handleAdminGuidanceRequest(c.req.raw, c.env);
});

aiRoutes.post("/ai/chat", async (c) => {
  return handleAdminChatRequest(c.req.raw, c.env);
});
