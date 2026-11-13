// Gate 25 (docs/25-tags-frozen-gate.md): the life of a frozen craft record. Every step is a plain block run in the GM window (crafts are queued and resolved with the module's own API; the use cards
// come from messages shaped like the real Strike card), except Step 11 (the Player window, a note) and the RELOAD between Steps 9 and 10.
// Target action (ctx.extras), optional:
//   reload(who)    reload that user's window (the GM's: a page reload, then wait until the world has finished loading and the user is logged in again as before). Gate 19's close-and-reopen of the GM
//                  context may serve; what matters is that it is a real reload of the page, so the module's `ready` code runs again and loads the saved store.
// Without that action Step 9 is a HAND step: it returns `HANDOFF: reload the GM window now ...`; the person reloads and runs Step 10.
// No imports, no Node, no closures over the page: only the ctx the runner hands in.

export default {
  after: {
    9: async ctx => {
      if (!ctx.extras?.reload) return;
      await ctx.extras.reload("gm");
    }
  }
};
