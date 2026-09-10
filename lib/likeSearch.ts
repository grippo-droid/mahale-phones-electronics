/**
 * Building SQL `LIKE` searches — the one place the escape character appears.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 *
 * The correct code looks wrong, which is why it has now been broken twice.
 *
 * The escape character is a single backslash. Written in TypeScript it is
 * `'\\'` — two characters in the source, one at runtime — so the correct SQL is
 * `ESCAPE '${ESCAPE_CHARACTER}'`, which reads as though it emits one backslash
 * inside quotes and looks under-escaped. Both times, the "fix" was to double it.
 * That emits TWO characters, and SQLite rejects the entire statement with
 * "ESCAPE expression must be a single character".
 *
 * The failure is quiet in the worst way: it only happens when a search term is
 * present. Every other query against the table works, so it ships green and
 * breaks the first time somebody types in a search box. `db/bills.ts` shipped
 * that way from T1.4 and nothing noticed until the History screen finally
 * passed `listBills` a search term; `db/quotations.ts` reintroduced it in T5.7
 * and only a test caught it.
 *
 * So callers no longer write the clause. They say which expressions to search
 * and hand over the term; the escape character occurs exactly once in the
 * codebase, and there is no per-module constant left to double. An ESLint rule
 * (`no-restricted-syntax` in `eslint.config.js`) refuses `ESCAPE '` anywhere
 * outside this file, so a new repository cannot quietly grow its own copy.
 * ---------------------------------------------------------------------------
 */

/**
 * A single backslash. The TypeScript literal is two characters; the value is
 * one, which is what SQLite requires. Do not "fix" this by doubling it.
 */
const ESCAPE_CHARACTER = '\\';

/**
 * The parenthesised OR of `LIKE` tests, with one `?` per expression.
 *
 * Takes SQL expressions rather than bare column names, so a nullable column can
 * be searched as `IFNULL(brand, '')` — a NULL column never matches a LIKE, and
 * a product with no brand would otherwise be unfindable by its name.
 *
 * The caller must push one copy of the term per expression, in the same order.
 */
export function likeClause(expressions: string[]): string {
  if (expressions.length === 0) {
    throw new Error('likeClause needs at least one expression to search.');
  }

  const tests = expressions.map(
    (expression) => `${expression} LIKE ? ESCAPE '${ESCAPE_CHARACTER}'`
  );
  return `(${tests.join(' OR ')})`;
}

/**
 * The bound parameter: the search term, wildcard-escaped and wrapped in `%`.
 *
 * The escaping is not cosmetic. `%` and `_` are LIKE wildcards, so a customer
 * called "100% Traders" would otherwise match every row in the table, and a
 * search for `MDL_1` would match `MDL-1` and `MDL21` too.
 */
/**
 * The bare `ESCAPE` clause, for `LIKE` patterns written as SQL literals.
 *
 * `app_settings` is queried by key prefix — `invoice\_seq:%`, `business\_%` —
 * where the pattern is a constant in the query rather than a user's search
 * term, so `likeClause` does not fit. The fragile half is the same though: the
 * clause has to emit exactly one character. Interpolating this keeps the escape
 * character defined once, and keeps `ESCAPE '` out of every other file so the
 * lint rule can be absolute.
 *
 * The `\_` inside such a pattern is the other half of the agreement: an
 * unescaped `_` is a single-character wildcard, so `invoice_seq:%` would also
 * match a key like `invoiceXseq:`.
 */
export const LIKE_ESCAPE_SQL = `ESCAPE '${ESCAPE_CHARACTER}'`;

export function likeTerm(search: string): string {
  const escaped = search
    .trim()
    .replace(/[\\%_]/g, (match) => `${ESCAPE_CHARACTER}${match}`);
  return `%${escaped}%`;
}
