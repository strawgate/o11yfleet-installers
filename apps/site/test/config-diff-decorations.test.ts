import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { commentField, setThreads } from "../src/components/config-diff/comment-extension";
import type { CommentThread } from "../src/components/config-diff/types";

const noop = () => undefined;
const buildCallbacks = () => ({ onSubmit: noop, onDraftChange: noop });

const SAMPLE = `line one\nline two\nline three\nline four\nline five\n`;

function createState(initial: CommentThread[]) {
  return EditorState.create({
    doc: SAMPLE,
    extensions: [
      commentField({
        side: "a",
        initial,
        buildCallbacks,
      }),
    ],
  });
}

test("commentField: state builds without exception when threads include both sides", () => {
  const threads: CommentThread[] = [
    { id: "t1", side: "a", line: 2, comments: [] },
    { id: "t2", side: "b", line: 3, comments: [] },
  ];
  const state = createState(threads);
  // The "a" side field filters to side==="a"; the "b" thread is silently
  // skipped. We assert via the negative — no throw and doc stays intact.
  assert.equal(state.doc.length, SAMPLE.length);
});

test("setThreads effect: replaces the whole set without crashing", () => {
  const initial: CommentThread[] = [{ id: "t1", side: "a", line: 1, comments: [] }];
  const state = createState(initial);
  const tr = state.update({
    effects: setThreads.of([
      { id: "t1", side: "a", line: 1, comments: [] },
      { id: "t2", side: "a", line: 3, comments: [] },
    ]),
  });
  assert.equal(tr.state.doc.length, SAMPLE.length);
});

test("commentField: out-of-range line numbers don't crash decoration build", () => {
  // line 999 doesn't exist in SAMPLE; the build path catches the throw.
  const threads: CommentThread[] = [{ id: "t1", side: "a", line: 999, comments: [] }];
  const state = createState(threads);
  assert.equal(state.doc.length, SAMPLE.length);
});

test("CommentThread shape: typecheck via JSON round-trip", () => {
  const t: CommentThread = {
    id: "x",
    side: "a",
    line: 1,
    comments: [{ id: "c1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" }],
  };
  const round = JSON.parse(JSON.stringify(t)) as CommentThread;
  assert.deepEqual(round, t);
});
