/**
 * Hand-off markers in the gate docs (13 to 21): a code block that does NOT check anything but tells the person (or the runner) what to do next returns a string that starts with
 * `HANDOFF:`, so the pipeline can tell "go do the next step" from a FAIL. Anything that is a genuine check (it prints PASS/FAIL lines, or returns ALL PASS / FAILED) must NEVER be marked.
 * The list of hand-offs is pinned: adding a marker to a check, or leaving an instruction unmarked, fails here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const HANDOFFS = ["17:28"];     // "<gate>:<step>": the only steps that hand off today
export function blocksOf(dir = "docs") {
  const out = [];
  for (const file of readdirSync(dir).filter(f => /^(13|14|15|16|17|18|19|20|21)-.*gate\.md$/.test(f))) {
    const text = readFileSync(`${dir}/${file}`, "utf8");
    for (const m of text.matchAll(/^## Step (\d+) [^\n]*\n([\s\S]*?)(?=^## Step |^## Group |(?![\s\S]))/gm)) {
      const code = m[2].match(/```js\n([\s\S]*?)```/)?.[1];
      if (code) out.push({ id: `${file.slice(0, 2)}:${m[1]}`, code });
    }
  }
  return out;
}
const body = code => code.replace(/^\s*\/\/[^\n]*$/gm, "");
export const isHandoff = code => /return\s+["'`]HANDOFF: /.test(body(code));
export const isInstruction = code => /return\s+["'`][^"'`\n]*(now do step|then run step|do step \d+ (in|first)|run step \d+ (here|first))/i.test(body(code));
export const isCheck = code => /\.(check|done)\(|ALL PASS|FAILED/.test(body(code));

test("hand-off markers: exactly the listed steps are marked, every instruction return is marked, and no genuine check is", () => {
  const blocks = blocksOf();
  assert.ok(blocks.length > 100, "the scan found the gate blocks");
  const marked = blocks.filter(b => isHandoff(b.code)).map(b => b.id);
  assert.deepEqual(marked, HANDOFFS, "the marked steps are exactly the pinned hand-offs");
  for (const b of blocks) {
    if (isInstruction(b.code)) assert.ok(isHandoff(b.code), `${b.id} returns an instruction, so it must start with HANDOFF:`);
    if (isHandoff(b.code)) assert.ok(!isCheck(b.code), `${b.id} is marked HANDOFF: but it contains a check (PASS/FAIL, ALL PASS or FAILED)`);
  }
  for (const b of blocks.filter(b => isCheck(b.code))) assert.ok(!isHandoff(b.code), `${b.id} is a genuine check and must not be marked`);
});

test("hand-off markers: the detector catches a marked check and an unmarked instruction (mutation check)", () => {
  const genuine = blocksOf().find(b => b.id === "17:30").code;
  assert.ok(isCheck(genuine) && !isHandoff(genuine));
  const mutantMarked = genuine.replace("console.log(`redraws counted: ${n}`);", 'console.log(`redraws counted: ${n}`); return "HANDOFF: ok";');
  assert.ok(isHandoff(mutantMarked) && isCheck(mutantMarked), "a check that was given a HANDOFF: return is seen as both, which the scan above rejects");
  const handoff = blocksOf().find(b => b.id === "17:28").code;
  assert.ok(isHandoff(handoff) && !isCheck(handoff) && isInstruction(handoff));
  const unmarked = handoff.replace("HANDOFF: ", "");
  assert.ok(isInstruction(unmarked) && !isHandoff(unmarked), "an instruction with the prefix removed is caught as unmarked");
});
