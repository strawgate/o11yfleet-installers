import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  EnrollmentDialogBody,
  enrollmentTokenFailureMessage,
} from "../src/pages/portal/EnrollmentDialogBody";

void React;

test("enrollment dialog renders inline token creation failures", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <EnrollmentDialogBody
        enrollmentToken={null}
        enrollmentTokenError="HTTP 400: configuration cannot accept enrollment tokens"
      />
    </MemoryRouter>,
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Could not create enrollment token/);
  assert.match(html, /HTTP 400: configuration cannot accept enrollment tokens/);
  assert.match(html, /Connect a collector/);
});

test("enrollment dialog prioritizes the created token state", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <EnrollmentDialogBody enrollmentToken="oft_enroll_test" enrollmentTokenError="HTTP 400" />
    </MemoryRouter>,
  );

  assert.match(html, /Enrollment token created/);
  assert.match(html, /oft_enroll_test/);
  assert.doesNotMatch(html, /Could not create enrollment token/);
});

test("normalizes unknown enrollment token errors", () => {
  assert.equal(enrollmentTokenFailureMessage(new Error("bad request")), "bad request");
  // Plain string rejections should surface verbatim, not collapse to "Unknown error".
  assert.equal(enrollmentTokenFailureMessage("bad request"), "bad request");
  // `{ message }` shapes (e.g. structured fetch error bodies) should also surface.
  assert.equal(enrollmentTokenFailureMessage({ message: "rate limited" }), "rate limited");
  // Empty/blank values fall back to the generic label.
  assert.equal(enrollmentTokenFailureMessage(""), "Unknown error");
  assert.equal(enrollmentTokenFailureMessage(null), "Unknown error");
  assert.equal(enrollmentTokenFailureMessage(undefined), "Unknown error");
  assert.equal(enrollmentTokenFailureMessage({}), "Unknown error");
});
