// Where each client keeps a signed-in account's local store (the sub-path it
// passes to configure()).

/**
 * The account's store, keyed by the server's user id. The id never changes;
 * the username can be renamed in Settings, and a store keyed by it was left
 * behind on every rename (the app then loaded an empty one, and the next sync
 * could push that over the cloud copy).
 */
export function accountStorePath(userId: number): string {
  return `accounts/${userId}`
}

/**
 * Where builds before the id key kept the store: by username. Each client
 * moves a store found here to accountStorePath() once, the first time that
 * account loads, and never reads it again after that.
 */
export function legacyStorePath(username: string): string {
  return `users/${username}`
}
