import { Hono, type MiddlewareHandler } from "hono";
import { basicAuth } from "hono/basic-auth";
import type { DurableLock } from "./durableLock";

export { DurableLock } from "./durableLock";

type Bindings = {
	USERNAME: string;
	PASSWORD: string;
	TFSTATE_BUCKET: R2Bucket;
	TFSTATE_LOCK: DurableObjectNamespace<DurableLock>;
};

// LockInfo
// https://github.com/hashicorp/terraform/blob/cb340207d8840f3d2bc5dab100a5813d1ea3122b/internal/states/statemgr/locker.go#L115
export type LockInfo = {
	ID: string;
	Operation: string;
	Info: string;
	Who: string;
	Version: string;
	Created: string;
	Path: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const logger = (): MiddlewareHandler => async (c, next) => {
	await next();

	const rayId = c.req.header("cf-ray") || crypto.randomUUID();
	const url = new URL(c.req.url);

	const outgoing = {
		method: c.req.method,
		uri: url.pathname,
		query: url.searchParams.toString(),
		requestId: rayId,
		status: c.res.status,
	};

	console.log("Response", outgoing);
};

// Middleware for all routes
app.use(logger());
// LOCAL PATCH (not in upstream): constant-time credential comparison.
// `===` on the username/password leaks length information and is
// vulnerable to timing attacks. PR Rocket's no-anti-patterns check
// flagged this on first vendor; keeping the patch on top of upstream
// and tracking it in infra/tfstate-worker/README.md so we can carry
// it across re-syncs.
function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

app.use(
	"/states/*",
	basicAuth({
		verifyUser: (u, p, c) =>
			constantTimeEqual(u, c.env.USERNAME) &&
			constantTimeEqual(p, c.env.PASSWORD),
	}),
);

// The routes
app.get("/health", (c) => {
	return c.body("OK", { headers: { "content-type": "text/plain" } });
});

/**
 * Get the Terraform state for a project. Does not require a lock, as it is read-only.
 */
app.get("/states/:projectName", async (c) => {
	const projectName = c.req.param("projectName");
	const key = `${c.env.USERNAME}/${projectName}.tfstate`;

	const state = await c.env.TFSTATE_BUCKET.get(key);
	if (state === null) {
		console.log("State not found", { projectName, key });
		return c.body(null, { status: 204 });
	}

	console.log("State found", { projectName, key });

	// Return the state as JSON, always with a 200 OK
	return c.body(state.body, {
		headers: { "content-type": "application/json" },
	});
});

/**
 * Update the Terraform state for a project. If the state is locked, check the lock ID to ensure the lock is held by the requester.
 */
app.post("/states/:projectName", async (c) => {
	const projectName = c.req.param("projectName");
	const key = `${c.env.USERNAME}/${projectName}.tfstate`;

	// Get the lock ID from the query string, if present
	const url = new URL(c.req.url);
	const lockID = url.searchParams.get("ID");

	const locker = c.env.TFSTATE_LOCK.get(c.env.TFSTATE_LOCK.idFromName(key));
	const lockInfo = await locker.info();
	if (lockInfo && lockInfo.ID !== lockID) {
		console.info("State is locked", { projectName, key });
		return c.json(lockInfo, { status: 423 });
	}

	// Update the state in the bucket, lock has already been verified if present
	await c.env.TFSTATE_BUCKET.put(key, await c.req.arrayBuffer());
	console.info("State updated", { projectName, key });

	// Put state accepts 200, 201, or 204 for success. Using 204 for no content since there is no response body.
	// https://github.com/hashicorp/terraform/blob/ee5cda700060b823d319a3d9d78d6c72255273be/internal/backend/remote-state/http/client.go#L237
	return c.body(null, { status: 204 });
});

app.on(["UNLOCK", "DELETE"], "/states/:projectName/lock", async (c) => {
	const projectName = c.req.param("projectName");
	const key = `${c.env.USERNAME}/${projectName}.tfstate`;

	const locker = c.env.TFSTATE_LOCK.get(c.env.TFSTATE_LOCK.idFromName(key));

	const unlockInfo = await c.req.json();
	const lockResult = await locker.unlock(unlockInfo);
	if (lockResult.status === "error") {
		console.info("State unlock error", {
			projectName,
			key,
			error: lockResult.error,
		});
		return c.json(lockResult.lockInfo, { status: 400 });
	}

	if (lockResult.status === "wrong_id") {
		console.info("State unlock wrong ID", { projectName, key });
		return c.json(lockResult.lockInfo, { status: 423 });
	}

	console.info("State unlocked", { projectName, key });

	// Unlock only accepts 200 OK for success
	// https://github.com/hashicorp/terraform/blob/ee5cda700060b823d319a3d9d78d6c72255273be/internal/backend/remote-state/http/client.go#L128
	return c.body(null, { status: 200 }); // Accepts only 200 OK
});

app.on(["LOCK", "PUT"], "/states/:projectName/lock", async (c) => {
	const projectName = c.req.param("projectName");
	const key = `${c.env.USERNAME}/${projectName}.tfstate`;

	const locker = c.env.TFSTATE_LOCK.get(c.env.TFSTATE_LOCK.idFromName(key));

	const lockInfo = await c.req.json();
	const lockResult = await locker.lock(lockInfo);
	if (lockResult.status === "already_locked") {
		console.info("State already locked", { projectName, key });
		return c.json(lockResult.lockInfo, { status: 423 });
	}

	console.info("State locked", { projectName, key });

	// Lock only accepts 200 OK for success
	// https://github.com/hashicorp/terraform/blob/ee5cda700060b823d319a3d9d78d6c72255273be/internal/backend/remote-state/http/client.go#L93
	return c.json(lockResult.lockInfo, { status: 200 });
});

// Non-standard route to get current lock state, useful for debugging
app.get("/states/:projectName/lock", async (c) => {
	const projectName = c.req.param("projectName");
	const key = `${c.env.USERNAME}/${projectName}.tfstate`;

	const locker = c.env.TFSTATE_LOCK.get(c.env.TFSTATE_LOCK.idFromName(key));
	const lockInfo = await locker.info();
	if (!lockInfo) {
		console.info("State not locked", { projectName, key });
		return c.body(null, { status: 204 });
	}

	console.info("State locked", { projectName, key });

	return c.json(lockInfo, { status: 200 });
});

export default app;
