// Gate 28 (docs/28-explore-sender-gate.md): the search relay, one attempt, and who is really asking.
// Every step is a plain block run in the GM window or the Player window, in order. There is NO click script and NO target action (no reload, no extras, no fake dice).
// The Player window calls the module's socket handlers directly through the real socket, and the GM window reads what it wrote.
// The runner only has to run each block in the window the doc names and show the console.log lines (every step prints REPORT lines). tests/gate28.test.js checks that this file stays empty.
// No imports, no Node, no closures over the page: only the ctx the runner hands in.

export default { before: {}, after: {} };
