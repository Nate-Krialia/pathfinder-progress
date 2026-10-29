/**
 * What crosses the socket. Real socketlib hides the message of anything a GM-side handler throws: the player gets only
 * "An exception occured during remote execution of handler ..." and the reason stays in the GM's console. So the
 * deliberate, plain-language refusals ("Downtime isn't open right now", "needs 2 Gate Gem but only 0 available ...")
 * travel as DATA, and only those:
 *
 *   - `refusal(message)` makes a `Refusal`: an Error whose message is meant for a player. Anything that is a Refusal is
 *     shown to the player as written. Called DIRECTLY (a GM using the api, no relay) it is an ordinary Error that
 *     throws with the same plain message.
 *   - `guard(name, fn)` wraps a socket handler (the GM side). A Refusal comes back as `{ __relay: "refused", message }`;
 *     ANY other exception is a bug: it is logged on the GM with console.error and comes back as `{ __relay: "failed" }`.
 *     A guarded handler never throws, so a message cannot be swallowed.
 *   - `unwrap(result)` is the player side: it turns those envelopes back into a thrown plain Error, and passes any other
 *     result through unchanged.
 */
import { MODULE_ID } from "../config.js";

export class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = "Refusal";
  }
}

export const refusal = message => new Refusal(message);

/** What a player sees when something unexpected broke on the GM's side. */
export const GENERIC_FAILURE = "Something went wrong; tell the GM.";

export function guard(name, handler) {
  return async function guarded(...args) {
    try {
      return await handler.apply(this, args);
    } catch (error) {
      if (error instanceof Refusal) return { __relay: "refused", message: error.message };
      console.error(`${MODULE_ID} | the "${name}" socket handler hit an unexpected error (the player was told to ask the GM)`, error);
      return { __relay: "failed" };
    }
  };
}

export function unwrap(result) {
  if (result?.__relay === "refused") throw new Error(result.message);
  if (result?.__relay === "failed") throw new Error(GENERIC_FAILURE);
  return result;
}
