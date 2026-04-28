#!/usr/bin/env npx tsx
/**
 * fake-collector.ts — Interactive fake OTel Collector
 *
 * Simulates an OTel Collector connecting via OpAMP to FleetPlane.
 * Handles enrollment, config delivery, health reporting, and reconnection.
 *
 * Usage:
 *   npx tsx scripts/fake-collector.ts                    # uses .local-state.json
 *   npx tsx scripts/fake-collector.ts --token <token>    # explicit token
 *   npx tsx scripts/fake-collector.ts --name collector-1 # custom name
 */

import { log, loadState, saveState, BASE_URL } from "./lib.js";
import {
  encodeFrame,
  decodeFrame,
  AgentCapabilities,
  RemoteConfigStatuses,
} from "@o11yfleet/core/codec";
import type { AgentToServer, ServerToAgent } from "@o11yfleet/core/codec";

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECTS = 10;

// ──────────────────────────────────────────────
// Parse CLI args
// ──────────────────────────────────────────────
function parseArgs(): { token: string; name: string } {
  const args = process.argv.slice(2);
  let token = "";
  let name = "fake-collector";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--token" && args[i + 1]) {
      token = args[++i];
    } else if (args[i] === "--name" && args[i + 1]) {
      name = args[++i];
    }
  }

  if (!token) {
    const state = loadState();
    if (state?.assignment_claim) {
      token = state.assignment_claim;
      log.info("Using stored assignment claim (reconnect mode)");
    } else if (state?.enrollment_token) {
      token = state.enrollment_token;
      log.info("Using enrollment token from .local-state.json");
    } else {
      log.error("No token found. Run 'just seed' first or pass --token");
      process.exit(1);
    }
  }

  return { token, name };
}

// ──────────────────────────────────────────────
// Collector state
// ──────────────────────────────────────────────
interface CollectorState {
  sequenceNum: number;
  instanceUid: Uint8Array;
  healthy: boolean;
  status: string;
  currentConfigHash: string | null;
  assignmentClaim: string | null;
  configsApplied: number;
  messagesReceived: number;
  messagesSent: number;
}

function initialState(): CollectorState {
  return {
    sequenceNum: 0,
    instanceUid: crypto.getRandomValues(new Uint8Array(16)),
    healthy: true,
    status: "starting",
    currentConfigHash: null,
    assignmentClaim: null,
    configsApplied: 0,
    messagesReceived: 0,
    messagesSent: 0,
  };
}

// ──────────────────────────────────────────────
// WebSocket management
// ──────────────────────────────────────────────
function buildWsUrl(token: string): string {
  const base = BASE_URL.replace(/^http/, "ws");
  return `${base}/v1/opamp?token=${encodeURIComponent(token)}`;
}

function hexFromBytes(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function runCollector(token: string, name: string): Promise<void> {
  let state = initialState();
  let reconnects = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let running = true;

  // Graceful shutdown
  const shutdown = () => {
    log.warn("Shutting down...");
    running = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running && reconnects <= MAX_RECONNECTS) {
    const currentToken = state.assignmentClaim ?? token;
    const wsUrl = buildWsUrl(currentToken);

    log.info(
      `[${name}] Connecting to ${wsUrl.replace(/token=.*/, "token=<redacted>")} ` +
        `(attempt ${reconnects + 1})`,
    );

    try {
      await connectAndRun(wsUrl, name, state, (newClaim) => {
        state.assignmentClaim = newClaim;
        // Persist claim for reconnection
        const localState = loadState();
        if (localState) {
          localState.assignment_claim = newClaim;
          saveState(localState);
          log.ok("Assignment claim saved for future reconnects");
        }
      });
    } catch (err) {
      if (!running) break;
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[${name}] Connection error: ${msg}`);
    }

    if (!running) break;

    reconnects++;
    if (reconnects <= MAX_RECONNECTS) {
      log.info(`[${name}] Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
      await sleep(RECONNECT_DELAY_MS);
    }
  }

  if (reconnects > MAX_RECONNECTS) {
    log.error(`[${name}] Max reconnects (${MAX_RECONNECTS}) exceeded`);
  }

  log.info(`[${name}] Collector stopped`);
  printStats(name, state);
}

function connectAndRun(
  wsUrl: string,
  name: string,
  state: CollectorState,
  onClaim: (claim: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const cleanup = () => {
      closed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    ws.addEventListener("open", () => {
      log.ok(`[${name}] WebSocket connected`);
      state.status = "connected";

      // Send Hello
      sendHello(ws, state, name);

      // Start heartbeat
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          sendHeartbeat(ws, state, name);
        }
      }, HEARTBEAT_INTERVAL_MS);
    });

    ws.addEventListener("message", (event) => {
      state.messagesReceived++;

      // Text messages are enrollment/control messages
      if (typeof event.data === "string") {
        handleTextMessage(event.data, name, state, onClaim);
        return;
      }

      // Binary messages are OpAMP frames
      const data =
        event.data instanceof ArrayBuffer
          ? event.data
          : // Node.js may send Blob for binary
            null;

      if (!data) {
        // Handle Blob (Node.js native WebSocket may return Blob)
        if (event.data instanceof Blob) {
          (event.data as Blob).arrayBuffer().then((buf) => {
            handleBinaryMessage(buf, ws, name, state);
          });
          return;
        }
        log.warn(`[${name}] Unknown message type: ${typeof event.data}`);
        return;
      }

      handleBinaryMessage(data, ws, name, state);
    });

    ws.addEventListener("close", (event) => {
      cleanup();
      const reason = event.reason || "no reason";
      log.warn(`[${name}] WebSocket closed: code=${event.code} reason=${reason}`);
      resolve();
    });

    ws.addEventListener("error", (event) => {
      cleanup();
      reject(new Error("WebSocket error"));
    });

    // Handle Ctrl+C during connection
    const shutdownHandler = () => {
      cleanup();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close(1000, "client shutdown");
        } catch {}
      }
      resolve();
    };
    process.once("SIGINT", shutdownHandler);
    process.once("SIGTERM", shutdownHandler);
  });
}

// ──────────────────────────────────────────────
// Message handlers
// ──────────────────────────────────────────────
function handleTextMessage(
  data: string,
  name: string,
  state: CollectorState,
  onClaim: (claim: string) => void,
): void {
  try {
    const msg = JSON.parse(data);
    if (msg.type === "enrollment_complete") {
      log.ok(`[${name}] Enrolled! instance_uid=${msg.instance_uid}`);
      if (msg.assignment_claim) {
        log.ok(`[${name}] Received assignment claim for future reconnects`);
        state.assignmentClaim = msg.assignment_claim;
        onClaim(msg.assignment_claim);
      }
      if (msg.instance_uid) {
        const localState = loadState();
        if (localState) {
          localState.instance_uid = msg.instance_uid;
          saveState(localState);
        }
      }
    } else {
      log.ws("←", `[${name}] Text: ${data.slice(0, 200)}`);
    }
  } catch {
    log.ws("←", `[${name}] Text: ${data.slice(0, 200)}`);
  }
}

function handleBinaryMessage(
  data: ArrayBuffer,
  ws: WebSocket,
  name: string,
  state: CollectorState,
): void {
  try {
    const msg = decodeFrame<ServerToAgent>(data);
    const uid = msg.instance_uid
      ? hexFromBytes(
          msg.instance_uid instanceof Uint8Array
            ? msg.instance_uid
            : new Uint8Array(msg.instance_uid),
        )
      : "unknown";

    log.ws("←", `[${name}] ServerToAgent — uid=${uid.slice(0, 8)}... flags=${msg.flags ?? 0}`);

    // Handle remote config push
    if (msg.remote_config) {
      const hash = msg.remote_config.config_hash
        ? hexFromBytes(
            msg.remote_config.config_hash instanceof Uint8Array
              ? msg.remote_config.config_hash
              : new Uint8Array(msg.remote_config.config_hash),
          )
        : null;

      log.ok(`[${name}] 📦 Config push received! hash=${hash?.slice(0, 16) ?? "null"}`);

      // "Apply" the config
      if (hash && msg.remote_config.config_hash) {
        state.currentConfigHash = hash;
        state.configsApplied++;

        // Send config applied ACK
        state.sequenceNum++;
        const ack: AgentToServer = {
          instance_uid: state.instanceUid,
          sequence_num: state.sequenceNum,
          capabilities:
            AgentCapabilities.ReportsStatus |
            AgentCapabilities.AcceptsRemoteConfig |
            AgentCapabilities.ReportsHealth |
            AgentCapabilities.ReportsRemoteConfig,
          flags: 0,
          remote_config_status: {
            last_remote_config_hash:
              msg.remote_config.config_hash instanceof Uint8Array
                ? msg.remote_config.config_hash
                : new Uint8Array(msg.remote_config.config_hash),
            status: RemoteConfigStatuses.APPLIED,
            error_message: "",
          },
        };
        ws.send(encodeFrame(ack));
        state.messagesSent++;
        log.ws("→", `[${name}] ConfigApplied ACK — hash=${hash.slice(0, 16)}...`);
      }
    }

    // Handle ReportFullState flag
    if (msg.flags && msg.flags & 0x00000001) {
      log.warn(`[${name}] Server requested full state report`);
      sendHello(ws, state, name);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(`[${name}] Failed to decode binary message: ${errMsg}`);
  }
}

// ──────────────────────────────────────────────
// Send helpers
// ──────────────────────────────────────────────
function sendHello(ws: WebSocket, state: CollectorState, name: string): void {
  state.sequenceNum = 0;
  const msg: AgentToServer = {
    instance_uid: state.instanceUid,
    sequence_num: state.sequenceNum,
    capabilities:
      AgentCapabilities.ReportsStatus |
      AgentCapabilities.AcceptsRemoteConfig |
      AgentCapabilities.ReportsHealth |
      AgentCapabilities.ReportsRemoteConfig,
    flags: 0,
    health: {
      healthy: state.healthy,
      start_time_unix_nano: BigInt(Date.now()) * 1_000_000n,
      last_error: "",
      status: state.status,
      status_time_unix_nano: BigInt(Date.now()) * 1_000_000n,
      component_health_map: {},
    },
    agent_description: {
      identifying_attributes: [
        { key: "service.name", value: { string_value: name } },
        { key: "service.version", value: { string_value: "0.1.0" } },
      ],
      non_identifying_attributes: [
        { key: "os.type", value: { string_value: process.platform } },
        { key: "host.arch", value: { string_value: process.arch } },
      ],
    },
  };
  ws.send(encodeFrame(msg));
  state.messagesSent++;
  log.ws("→", `[${name}] Hello (seq=0, status=${state.status})`);
}

function sendHeartbeat(ws: WebSocket, state: CollectorState, name: string): void {
  state.sequenceNum++;
  const msg: AgentToServer = {
    instance_uid: state.instanceUid,
    sequence_num: state.sequenceNum,
    capabilities:
      AgentCapabilities.ReportsStatus |
      AgentCapabilities.AcceptsRemoteConfig |
      AgentCapabilities.ReportsHealth,
    flags: 0,
  };
  ws.send(encodeFrame(msg));
  state.messagesSent++;
  log.dim(`[${name}] Heartbeat (seq=${state.sequenceNum})`);
}

// ──────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function printStats(name: string, state: CollectorState): void {
  console.log(`\n┌─── ${name} Stats ───────────────────────┐`);
  console.log(`│  Messages sent:     ${state.messagesSent}`);
  console.log(`│  Messages received: ${state.messagesReceived}`);
  console.log(`│  Configs applied:   ${state.configsApplied}`);
  console.log(`│  Current config:    ${state.currentConfigHash?.slice(0, 16) ?? "none"}...`);
  console.log(`│  Healthy:           ${state.healthy}`);
  console.log(`│  Status:            ${state.status}`);
  console.log(`└──────────────────────────────────────────┘`);
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
const { token, name } = parseArgs();

console.log(`
╔═══════════════════════════════════════════════╗
║  FleetPlane Fake OTel Collector               ║
║                                               ║
║  Name:      ${name.padEnd(33)}║
║  Server:    ${BASE_URL.padEnd(33)}║
║  Heartbeat: every ${HEARTBEAT_INTERVAL_MS / 1000}s${"".padEnd(24)}║
║                                               ║
║  Ctrl+C to stop                               ║
╚═══════════════════════════════════════════════╝
`);

runCollector(token, name).catch((err) => {
  log.error(err.message);
  process.exit(1);
});
