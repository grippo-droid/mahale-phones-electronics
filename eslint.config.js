// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

/**
 * Writing a SQL `ESCAPE` clause by hand has been got wrong twice, and both
 * times it only surfaced when somebody typed in a search box — every other
 * query against the table works, so it ships green.
 *
 * The escape character is one backslash, written `'\\'` in TypeScript. The
 * correct clause therefore looks under-escaped, and "fixing" it emits two
 * characters, which makes SQLite reject the whole statement with "ESCAPE
 * expression must be a single character".
 *
 * So the clause is not written by hand any more. `lib/likeSearch.ts` builds it
 * (`likeClause`, `likeTerm`, `LIKE_ESCAPE_SQL`) and this rule keeps it that
 * way: a new repository cannot quietly grow its own copy.
 */
const NO_HAND_WRITTEN_ESCAPE =
  "Do not write a SQL ESCAPE clause by hand — the escape character is a single " +
  "backslash and getting it wrong breaks the query only when a search term is " +
  "present. Use likeClause/likeTerm/LIKE_ESCAPE_SQL from lib/likeSearch.ts.";

module.exports = defineConfig([
  expoConfig,
  {
    // `.expo` is generated on every build and carries its own eslint-disable.
    ignores: ["dist/*", ".expo/*"],
  },
  {
    /**
     * `db/` and `lib/` contain no React, and the hooks rules misfire there:
     * `useRollbackJournal` in `db/backup.ts` is a pure byte-manipulation
     * function whose name starts with "use" in the English sense, which the
     * rule reads as a custom hook being called outside a component.
     */
    files: ["db/**/*.ts", "lib/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        // Template literals — `... ESCAPE '\\' ...`
        {
          selector: "TemplateElement[value.raw=/ESCAPE\\s*'/]",
          message: NO_HAND_WRITTEN_ESCAPE,
        },
        // Plain string literals — "... ESCAPE '\\' ..."
        {
          selector: "Literal[value=/ESCAPE\\s*'/]",
          message: NO_HAND_WRITTEN_ESCAPE,
        },
      ],
    },
  },
  {
    // The one file allowed to spell it out; it is the definition.
    files: ["lib/likeSearch.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
]);
