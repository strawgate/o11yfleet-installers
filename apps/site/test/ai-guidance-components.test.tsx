import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { GuidancePanel } from "../src/components/ai/GuidancePanel";
import { GuidanceSlot } from "../src/components/ai/GuidanceSlot";

void React;

const guidanceItem = {
  target_key: "overview.agents",
  headline: "Collectors offline",
  detail: "Three collectors are offline.",
  severity: "warning" as const,
  confidence: 0.8,
  evidence: [{ label: "Connected", value: "7" }],
};

test("GuidanceSlot renders nothing when no item is available", () => {
  const html = renderToStaticMarkup(<GuidanceSlot />);
  assert.equal(html, "");
});

test("GuidanceSlot renders nothing while loading", () => {
  const html = renderToStaticMarkup(<GuidanceSlot loading item={guidanceItem} />);
  assert.equal(html, "");
});

test("GuidancePanel hides empty guidance payloads", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <GuidancePanel
        title="Fleet overview guidance"
        guidance={{
          summary: "No non-obvious guidance found.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "fixture",
          items: [],
        }}
      />
    </MemoryRouter>,
  );

  assert.equal(html, "");
});

test("GuidancePanel renders nothing while waiting for first insight", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <GuidancePanel title="Fleet overview guidance" isLoading />
    </MemoryRouter>,
  );

  assert.equal(html, "");
});

test("GuidancePanel renders useful guidance items", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <GuidancePanel
        title="Fleet overview guidance"
        guidance={{
          summary: "Focus on offline collectors.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "fixture",
          items: [guidanceItem],
        }}
      />
    </MemoryRouter>,
  );

  assert.match(html, /AI guidance/);
  assert.match(html, /Focus on offline collectors/);
  assert.match(html, /Collectors offline/);
  assert.match(html, /Connected/);
});

test("GuidancePanel can hide items already rendered in metric slots", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <GuidancePanel
        title="Fleet overview guidance"
        excludeTargetKeys={["overview.agents"]}
        guidance={{
          summary: "Focus on offline collectors.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "fixture",
          items: [guidanceItem],
        }}
      />
    </MemoryRouter>,
  );

  assert.equal(html, "");
});
