import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createConfig } from "./create.js";
import { output } from "../../utils/output.js";
import * as apiModule from "../../utils/api.js";

describe("config create", () => {
  let mockOutput: {
    error: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    printJson: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockOutput = {
      error: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      printJson: vi.fn(),
    };
    vi.spyOn(output, "error").mockImplementation(mockOutput.error);
    vi.spyOn(output, "log").mockImplementation(mockOutput.log);
    vi.spyOn(output, "success").mockImplementation(mockOutput.success);
    vi.spyOn(output, "printJson").mockImplementation(mockOutput.printJson);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a configuration", async () => {
    const mockData = { id: "config-new", name: "My Config" };
    vi.spyOn(apiModule, "apiRequest").mockResolvedValueOnce({
      data: mockData,
      status: 201,
    });

    await createConfig({ name: "My Config" });

    expect(mockOutput.log).toHaveBeenCalledWith('Creating configuration "My Config"...');
    expect(mockOutput.success).toHaveBeenCalledWith("Configuration created: config-new");
    expect(mockOutput.printJson).toHaveBeenCalledWith(mockData);
  });

  it("creates a configuration with description", async () => {
    const mockData = { id: "config-new", name: "My Config" };
    vi.spyOn(apiModule, "apiRequest").mockResolvedValueOnce({
      data: mockData,
      status: 201,
    });

    await createConfig({ name: "My Config", description: "A test config" });

    expect(apiModule.apiRequest).toHaveBeenCalledWith("/api/v1/configurations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Config", description: "A test config" }),
    });
  });
});
