import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import "../src"; // Currently required to automatically rerun tests when `main` changes

describe("Echo worker", () => {
	it("responds with 200 OK", async () => {
		const response = await SELF.fetch("https://example.com/health");
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("OK");
	});
});
