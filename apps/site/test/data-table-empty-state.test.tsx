import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { EmptyState } from "../src/components/data-table/EmptyState";
import { ErrorState } from "../src/components/data-table/ErrorState";

void React;

function withProvider(node: React.ReactElement) {
  return <MantineProvider>{node}</MantineProvider>;
}

test("EmptyState: renders default title", () => {
  const html = renderToStaticMarkup(withProvider(<EmptyState />));
  assert.match(html, /No results/);
});

test("EmptyState: renders custom title and description", () => {
  const html = renderToStaticMarkup(
    withProvider(<EmptyState title="No agents" description="Enroll one to start." />),
  );
  assert.match(html, /No agents/);
  assert.match(html, /Enroll one to start/);
});

test("ErrorState: renders message and retry hint", () => {
  const html = renderToStaticMarkup(
    withProvider(<ErrorState message="Network is down" retry={() => undefined} />),
  );
  // React server-renders the apostrophe as `&#x27;` HTML entity.
  assert.match(html, /Couldn(?:&#x27;|')t load data/);
  assert.match(html, /Network is down/);
  assert.match(html, /Retry/);
});

test("ErrorState: omits retry button when no callback", () => {
  const html = renderToStaticMarkup(withProvider(<ErrorState message="x" />));
  assert.doesNotMatch(html, /Retry/);
});
