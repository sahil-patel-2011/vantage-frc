/**
 * One query at a time on a request's client.
 *
 * A transaction runs its statements one after another, but route code often starts several
 * reads together — `Promise.all([loadA(client), loadB(client)])` — through helpers that each
 * take the same client. node-postgres queued those internally and warned on every overlap
 * ("Calling client.query() when the client is already executing a query is deprecated and
 * will be removed in pg@9.0"); production logged it on Home, Strategy, Chat and Work.
 *
 * `serializeClientQueries` puts a first-in, first-out queue in front of `client.query`: each
 * call starts when the one before it settles, in the order they were made — exactly the order
 * the driver used — so results are unchanged and the driver never sees two at once. It
 * returns a function that takes the queue off again before the client goes back to the pool.
 *
 * Callback-style and submittable queries (cursors, streams) pass straight through; request
 * code does not use them, and they cannot be awaited in a queue.
 */
type Queryable = { query: (...args: unknown[]) => unknown };

export function serializeClientQueries(client: Queryable): () => void {
  const hadOwn = Object.prototype.hasOwnProperty.call(client, "query");
  const previous = client.query;
  const original = previous.bind(client);
  let tail: Promise<unknown> = Promise.resolve();

  client.query = (...args: unknown[]) => {
    const first = args[0] as { submit?: unknown } | null | undefined;
    const passThrough =
      typeof args[args.length - 1] === "function" ||
      (first != null && typeof first === "object" && typeof first.submit === "function");
    if (passThrough) return original(...args);
    const run = tail.then(() => original(...args));
    // The next query waits for this one to settle, success or failure; the caller still sees
    // this one's own result or error.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return () => {
    if (hadOwn) client.query = previous;
    else delete (client as Partial<Queryable>).query;
  };
}
