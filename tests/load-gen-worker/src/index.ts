// o11yfleet Load Generator Worker
//
// Coordinates thousands of outbound WebSocket connections to the target
// o11yfleet worker. Fans out across LoadGenDO shards to avoid per-DO limits.

export { LoadGenDO } from "./load-gen-do.js";

export interface Env {
  LOAD_GEN_DO: DurableObjectNamespace;
  API_KEY?: string;
}

interface StartRequest {
  target: string;
  token: string;
  agents: number;
  shards?: number;
}

interface ShardStats {
  shard: number;
  target_count: number;
  connected: number;
  enrolled: number;
  dropped: number;
  close_codes: Record<number, number>;
}

interface AggregatedStatus {
  running: boolean;
  total_target: number;
  connected: number;
  enrolled: number;
  dropped: number;
  shards: ShardStats[];
}

// Module-level run state (survives within the same isolate)
// The real source of truth is the shard DOs themselves.
let currentRun: { target: string; token: string; agents: number; shards: number } | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/start" && request.method === "POST") {
      return handleStart(request, env);
    }
    if (url.pathname === "/status" && request.method === "GET") {
      return handleStatus(request, env);
    }
    if (url.pathname === "/stop" && request.method === "POST") {
      return handleStop(request, env);
    }

    return new Response("o11yfleet load generator\n\nPOST /start\nGET /status\nPOST /stop\n", {
      status: 200,
    });
  },
};

async function handleStart(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as StartRequest;
  const { target, token, agents } = body;

  if (!target || !token || !agents) {
    return Response.json(
      { error: "Missing required fields: target, token, agents" },
      { status: 400 },
    );
  }

  const shards = body.shards ?? Math.max(1, Math.ceil(agents / 5000));
  const perShard = Math.ceil(agents / shards);

  // Store run config
  currentRun = { target, token, agents, shards };

  // Fan out to shard DOs
  const results = await Promise.allSettled(
    Array.from({ length: shards }, (_, i) => {
      const stub = env.LOAD_GEN_DO.get(env.LOAD_GEN_DO.idFromName(`shard-${i}`));
      const count = i === shards - 1 ? agents - perShard * (shards - 1) : perShard;
      return stub.fetch(
        new Request("https://do/start", {
          method: "POST",
          body: JSON.stringify({
            shard: i,
            target,
            token,
            count: Math.max(0, count),
          }),
        }),
      );
    }),
  );

  const started = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return Response.json({
    ok: true,
    agents,
    shards,
    per_shard: perShard,
    started,
    failed,
  });
}

async function handleStatus(_request: Request, env: Env): Promise<Response> {
  // If we don't know the run config, try to reconstruct from query params
  const shardCount = currentRun?.shards ?? 10;

  const shardStats: ShardStats[] = [];
  let totalTarget = 0;
  let totalConnected = 0;
  let totalEnrolled = 0;
  let totalDropped = 0;

  const results = await Promise.allSettled(
    Array.from({ length: shardCount }, (_, i) => {
      const stub = env.LOAD_GEN_DO.get(env.LOAD_GEN_DO.idFromName(`shard-${i}`));
      return stub.fetch(new Request("https://do/status"));
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      const stats = (await result.value.json()) as ShardStats;
      if (stats.target_count > 0) {
        shardStats.push(stats);
        totalTarget += stats.target_count;
        totalConnected += stats.connected;
        totalEnrolled += stats.enrolled;
        totalDropped += stats.dropped;
      }
    }
  }

  const status: AggregatedStatus = {
    running: totalTarget > 0,
    total_target: totalTarget,
    connected: totalConnected,
    enrolled: totalEnrolled,
    dropped: totalDropped,
    shards: shardStats,
  };

  return Response.json(status);
}

async function handleStop(_request: Request, env: Env): Promise<Response> {
  const shardCount = currentRun?.shards ?? 10;

  const finalStats: ShardStats[] = [];

  const results = await Promise.allSettled(
    Array.from({ length: shardCount }, (_, i) => {
      const stub = env.LOAD_GEN_DO.get(env.LOAD_GEN_DO.idFromName(`shard-${i}`));
      return stub.fetch(new Request("https://do/stop", { method: "POST" }));
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      const stats = (await result.value.json()) as ShardStats;
      if (stats.target_count > 0) {
        finalStats.push(stats);
      }
    }
  }

  currentRun = null;

  return Response.json({ ok: true, final_stats: finalStats });
}
