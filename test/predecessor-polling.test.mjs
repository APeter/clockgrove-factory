// Opt-in, read-only check against a real blocked-by link. Run while the
// prerequisite is pending, then again after it finishes with EXPECT_DONE=1.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHub, githubOutcome, TransientError } from "../dist/github.js";
import { predecessorsStep } from "../dist/planning/predecessors.js";
import { newObjective } from "../dist/state.js";
import { closedPort } from "./helpers.mjs";

const repository = process.env.FACTORY_PREDECESSOR_REPO;
const objectives = process.env.FACTORY_PREDECESSOR_OBJECTIVES;
const issue = Number(process.env.FACTORY_PREDECESSOR_ISSUE);

test("real predecessor waits poll every 30 seconds, then permit progression", {
  skip: !repository || !objectives || !issue,
  timeout: 90_000,
}, async () => {
  const signal = AbortSignal.timeout(80_000);
  const state = newObjective(issue, new Date());
  const step = predecessorsStep({
    github: new GitHub(repository),
    objectives,
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const outcome = await step.run({ state, signal });
    if (process.env.FACTORY_PREDECESSOR_EXPECT_DONE === "1") {
      assert.equal(outcome.kind, "done", outcome.question ?? outcome.reason);
      assert.ok(outcome.result.predecessors.length > 0);
    } else {
      assert.equal(outcome.kind, "retry", outcome.question ?? outcome.reason);
      assert.equal(outcome.wait?.kind, "gate");
      assert.equal(outcome.afterMs, 30_000, `blocked check ${attempt + 1}`);
    }
  }
});

test("a predecessor connection failure retains normal backoff", async () => {
  const originalToken = process.env.FACTORY_GITHUB_TOKEN;
  try {
    process.env.FACTORY_GITHUB_TOKEN = "local-probe-dummy-token";
    // A fresh client reads the dummy token instead of a cached real login.
    const unavailable = predecessorsStep({
      github: new GitHub(
        "drill/target",
        `http://127.0.0.1:${await closedPort()}`,
      ),
    });
    await assert.rejects(
      unavailable.run({
        state: newObjective(7, new Date()),
        signal: AbortSignal.timeout(5_000),
      }),
      (error) => {
        assert.ok(error instanceof TransientError);
        const outcome = githubOutcome(error, "drill/target");
        assert.equal(outcome.kind, "retry");
        assert.equal(outcome.afterMs, undefined);
        assert.equal(outcome.wait, undefined);
        return true;
      },
    );
  } finally {
    if (originalToken === undefined) delete process.env.FACTORY_GITHUB_TOKEN;
    else process.env.FACTORY_GITHUB_TOKEN = originalToken;
  }
});
