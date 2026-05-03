import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

void React;
import { ValidationStrip } from "../src/components/pipeline-builder/ValidationStrip";
import type { BuilderValidation } from "../src/pages/portal/useBuilderState";

test("ValidationStrip: rendering with no issues", () => {
  const validation: BuilderValidation = {
    ok: true,
    canSave: true,
    errors: [],
    warnings: [],
  };

  const html = renderToStaticMarkup(
    <ValidationStrip validation={validation} yamlPreviewError={null} />,
  );

  assert.match(html, /Validation and rollout readiness/);
  assert.match(html, /No graph issues detected/);
  assert.doesNotMatch(html, /Errors \(/);
  assert.doesNotMatch(html, /Warnings \(/);
  assert.doesNotMatch(html, /Cannot save draft/);
  assert.doesNotMatch(html, /YAML preview unavailable/);
});

test("ValidationStrip: rendering with errors only", () => {
  const validation: BuilderValidation = {
    ok: false,
    canSave: false,
    errors: [
      { code: "err_1", message: "First error message" },
      { code: "err_2", message: "Second error message" },
    ],
    warnings: [],
  };

  const html = renderToStaticMarkup(
    <ValidationStrip validation={validation} yamlPreviewError={null} />,
  );

  assert.match(html, /Validation and rollout readiness/);
  assert.match(html, /Errors \(2\)/);
  assert.match(html, /First error message/);
  assert.match(html, /Second error message/);
  assert.match(html, /Cannot save draft/);
  assert.doesNotMatch(html, /No graph issues detected/);
  assert.doesNotMatch(html, /Warnings \(/);
});

test("ValidationStrip: rendering with warnings only", () => {
  const validation: BuilderValidation = {
    ok: true,
    canSave: true,
    errors: [],
    warnings: [{ code: "warn_1", message: "First warning message" }],
  };

  const html = renderToStaticMarkup(
    <ValidationStrip validation={validation} yamlPreviewError={null} />,
  );

  assert.match(html, /Validation and rollout readiness/);
  assert.match(html, /Warnings \(1\)/);
  assert.match(html, /First warning message/);
  assert.doesNotMatch(html, /Errors \(/);
  assert.doesNotMatch(html, /Cannot save draft/);
  assert.doesNotMatch(html, /No graph issues detected/);
});

test("ValidationStrip: rendering with both errors and warnings", () => {
  const validation: BuilderValidation = {
    ok: false,
    canSave: false,
    errors: [{ code: "e1", message: "Err 1" }],
    warnings: [{ code: "w1", message: "Warn 1" }],
  };

  const html = renderToStaticMarkup(
    <ValidationStrip validation={validation} yamlPreviewError="YAML broken" />,
  );

  assert.match(html, /Validation and rollout readiness/);
  assert.match(html, /Errors \(1\)/);
  assert.match(html, /Err 1/);
  assert.match(html, /Warnings \(1\)/);
  assert.match(html, /Warn 1/);
  assert.match(html, /Cannot save draft/);
  assert.match(html, /YAML broken/);
  assert.doesNotMatch(html, /No graph issues detected/);
});
