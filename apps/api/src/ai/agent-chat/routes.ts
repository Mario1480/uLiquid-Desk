import type { Express, Request, Response } from "express";
import { getUserFromLocals, requireAuth } from "../../auth.js";
import { AgentChatError, toAgentChatError } from "./errors.js";
import { createConversationSchema, createMessageSchema, patchConversationSchema } from "./schemas.js";
import { AgentChatService, type AgentChatServiceDeps } from "./service.js";

function sendError(res: Response, error: unknown) {
  const normalized = error instanceof AgentChatError ? error : toAgentChatError(error);
  return res.status(normalized.status).json({ error: normalized.code, message: normalized.message });
}

function idParam(req: Request): string {
  return String(req.params.id ?? "").trim().slice(0, 191);
}

export function registerAgentChatRoutes(app: Express, deps: AgentChatServiceDeps) {
  const service = new AgentChatService(deps);

  app.get("/api/agent-chat/profiles", requireAuth, async (_req, res) => {
    try { return res.json(await service.listProfiles(getUserFromLocals(res))); } catch (error) { return sendError(res, error); }
  });
  app.post("/api/agent-chat/profiles", requireAuth, async (req, res) => {
    try { return res.status(201).json(await service.saveProfile(getUserFromLocals(res), req.body)); } catch (error) { return sendError(res, error); }
  });
  app.put("/api/agent-chat/profiles/:id", requireAuth, async (req, res) => {
    try { return res.json(await service.saveProfile(getUserFromLocals(res), req.body, idParam(req))); } catch (error) { return sendError(res, error); }
  });
  app.delete("/api/agent-chat/profiles/:id", requireAuth, async (req, res) => {
    try { await service.deleteProfile(getUserFromLocals(res), idParam(req)); return res.status(204).end(); } catch (error) { return sendError(res, error); }
  });
  app.get("/api/agent-chat/conversations", requireAuth, async (req, res) => {
    try { return res.json(await service.listConversations(getUserFromLocals(res), typeof req.query.cursor === "string" ? req.query.cursor : undefined)); } catch (error) { return sendError(res, error); }
  });
  app.post("/api/agent-chat/conversations", requireAuth, async (req, res) => {
    const parsed = createConversationSchema.safeParse(req.body ?? {}); if (!parsed.success) return res.status(400).json({ error: "agent_chat_message_invalid", details: parsed.error.flatten() });
    try { return res.status(201).json(await service.createConversation(getUserFromLocals(res), parsed.data)); } catch (error) { return sendError(res, error); }
  });
  app.get("/api/agent-chat/conversations/:id", requireAuth, async (req, res) => {
    try { return res.json(await service.getConversation(getUserFromLocals(res), idParam(req))); } catch (error) { return sendError(res, error); }
  });
  app.patch("/api/agent-chat/conversations/:id", requireAuth, async (req, res) => {
    const parsed = patchConversationSchema.safeParse(req.body ?? {}); if (!parsed.success) return res.status(400).json({ error: "agent_chat_message_invalid", details: parsed.error.flatten() });
    try { return res.json(await service.updateConversation(getUserFromLocals(res), idParam(req), parsed.data)); } catch (error) { return sendError(res, error); }
  });
  app.delete("/api/agent-chat/conversations/:id", requireAuth, async (req, res) => {
    try { return res.json(await service.archiveConversation(getUserFromLocals(res), idParam(req))); } catch (error) { return sendError(res, error); }
  });
  app.post("/api/agent-chat/conversations/:id/messages", requireAuth, async (req, res) => {
    const parsed = createMessageSchema.safeParse(req.body ?? {}); if (!parsed.success) return res.status(400).json({ error: "agent_chat_message_invalid", details: parsed.error.flatten() });
    try { return res.status(201).json(await service.sendMessage(getUserFromLocals(res), idParam(req), parsed.data.content, parsed.data.locale, parsed.data.idempotencyKey)); } catch (error) { return sendError(res, error); }
  });
  app.get("/api/agent-chat/runs/:id/activity", requireAuth, async (req, res) => {
    try { return res.json(await service.getActivity(getUserFromLocals(res), idParam(req))); } catch (error) { return sendError(res, error); }
  });
}
