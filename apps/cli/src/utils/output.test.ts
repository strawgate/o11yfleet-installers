import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Output } from "./output.js";

describe("Output", () => {
  let output: Output;
  let writeCalls: string[] = [];
  let mockStdout: any;
  let mockStderr: any;

  beforeEach(() => {
    writeCalls = [];
    mockStdout = {
      write: (msg: string) => {
        writeCalls.push(msg);
        return true;
      },
    };
    mockStderr = {
      write: (msg: string) => {
        writeCalls.push(msg);
        return true;
      },
    };
    output = new Output(mockStdout as any, mockStderr as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("log", () => {
    it("writes to stream with prefix", () => {
      output.log("hello");
      expect(writeCalls[0]).toBe("> hello\n");
    });

    it("applies color", () => {
      output.log("hello", "red");
      expect(writeCalls[0]).toContain("hello");
    });

    it("suppresses output in JSON mode", () => {
      output.setJsonMode(true);
      output.log("hello");
      expect(writeCalls.length).toBe(0);
    });
  });

  describe("success", () => {
    it("writes success message", () => {
      output.success("Done!");
      expect(writeCalls[0]).toContain("Done!");
    });
  });

  describe("error", () => {
    it("writes error message", () => {
      output.error("Something went wrong");
      expect(writeCalls[0]).toContain("Error:");
      expect(writeCalls[0]).toContain("Something went wrong");
    });

    it("writes error with details", () => {
      output.error("Failed", "extra info");
      expect(writeCalls[0]).toContain("Error:");
      expect(writeCalls[1]).toContain("extra info");
    });

    it("outputs JSON in JSON mode", () => {
      output.setJsonMode(true);
      output.error("Failed", "details");
      expect(writeCalls[0]).toBe('{"error":"Failed","details":"details"}\n');
    });
  });

  describe("warn", () => {
    it("writes warning message", () => {
      output.warn("Be careful");
      expect(writeCalls[0]).toContain("Warning:");
    });
  });

  describe("info", () => {
    it("writes info message", () => {
      output.info("FYI");
      expect(writeCalls[0]).toContain("i");
    });
  });

  describe("printJson", () => {
    it("prints JSON with message prefix", () => {
      output.printJson({ id: "123" }, "Result:");
      expect(writeCalls[0]).toContain("Result:");
      expect(writeCalls[1]).toContain('"id": "123"');
    });

    it("prints JSON without message", () => {
      output.printJson({ id: "123" });
      expect(writeCalls[0]).toContain('"id": "123"');
    });
  });

  describe("exitJson", () => {
    it("writes JSON and exits", () => {
      const exitMock = vi.spyOn(process, "exit").mockImplementation(vi.fn());
      output.exitJson({ id: "123" });
      expect(writeCalls[0]).toContain('"id": "123"');
      expect(exitMock).toHaveBeenCalledWith(0);
    });
  });

  describe("jsonMode", () => {
    it("defaults to false", () => {
      expect(output.jsonMode).toBe(false);
    });

    it("can be set to true", () => {
      output.setJsonMode(true);
      expect(output.jsonMode).toBe(true);
    });
  });
});
