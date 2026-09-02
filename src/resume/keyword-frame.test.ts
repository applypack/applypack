import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshFrame,
  freshFrameNotice,
  planKeywordFrame,
  readFrameReason,
  type StoredFrame,
} from "./keyword-frame";

const stored: StoredFrame = { terms: 24, promptVersion: 6 };

test("a frame from the current prompt is carried", () => {
  assert.deepEqual(planKeywordFrame(stored, 6, false), {
    carry: true,
    reason: "carried",
  });
});

test("rebuild drops the frame the user asked to drop", () => {
  assert.deepEqual(planKeywordFrame(stored, 6, true), {
    carry: false,
    reason: "rebuild",
  });
});

test("a prompt bump never inherits the previous prompt frame", () => {
  assert.deepEqual(
    planKeywordFrame({ ...stored, promptVersion: 5 }, 6, false),
    {
      carry: false,
      reason: "prompt-bump",
    },
  );
  assert.deepEqual(
    planKeywordFrame({ ...stored, promptVersion: null }, 6, false),
    { carry: false, reason: "prompt-bump" },
    "a row from before the marker cannot say which rules it followed",
  );
  assert.deepEqual(
    planKeywordFrame({ ...stored, promptVersion: 7 }, 6, false),
    { carry: false, reason: "prompt-bump" },
    "a downgrade is just as foreign a frame",
  );
});

test("nothing stored is a first run, whatever was asked", () => {
  assert.deepEqual(planKeywordFrame(null, 6, false), {
    carry: false,
    reason: "first-run",
  });
  assert.deepEqual(planKeywordFrame(null, 6, true), {
    carry: false,
    reason: "first-run",
  });
  assert.deepEqual(
    planKeywordFrame({ terms: 0, promptVersion: 6 }, 6, false),
    { carry: false, reason: "first-run" },
    "an empty list is nothing to inherit",
  );
});

test("rebuild wins over a stale version — one reason, the one the user chose", () => {
  assert.deepEqual(planKeywordFrame({ terms: 24, promptVersion: 5 }, 6, true), {
    carry: false,
    reason: "rebuild",
  });
});

test("readFrameReason reads the marker and nothing else", () => {
  assert.equal(readFrameReason({ score: 71, frame: "rebuild" }), "rebuild");
  assert.equal(readFrameReason({ score: 71 }), null, "pre-marker rows");
  assert.equal(readFrameReason({ frame: "REBUILD" }), null);
  assert.equal(readFrameReason({ frame: true }), null);
  assert.equal(readFrameReason(null), null);
});

test("only a re-extracted frame makes a score incomparable", () => {
  assert.equal(freshFrame({ frame: "rebuild" }), "rebuild");
  assert.equal(freshFrame({ frame: "prompt-bump" }), "prompt-bump");
  assert.equal(
    freshFrame({ frame: "carried" }),
    null,
    "a carried frame is what makes it fair",
  );
  assert.equal(
    freshFrame({ frame: "first-run" }),
    null,
    "nothing to be compared with",
  );
  assert.equal(
    freshFrame({}),
    null,
    "rows written before the marker read as comparable",
  );
});

test("the notice says the terms differ, never that the score got worse", () => {
  const rebuilt = freshFrameNotice("rebuild");
  assert.match(rebuilt, /rebuilt from the posting/);
  assert.match(rebuilt, /different set of terms/);
  assert.doesNotMatch(rebuilt, /lower|worse|dropped/);
  assert.match(freshFrameNotice("prompt-bump"), /prompt changed/);
});
