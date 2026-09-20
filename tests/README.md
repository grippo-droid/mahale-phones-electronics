# Tests

```
npm test              every suite
npm test ledger       suites whose filename contains "ledger"
```

No framework and no build step. Node requires the `.ts` sources directly,
stripping the types, so the suites run against the real code rather than a
compiled copy that can go stale.

## Layout

```
tests/
  run.js                  finds the suites, runs each in its own process
  run-one.js              runs one suite, prints a JSON result
  harness/
    register.js           @/ alias → source files; shimmed modules → shims/
    check.js              the assertion helper, and readSource/tempDir
    shims/                expo-sqlite, expo-file-system, expo-print, zustand, …
  suites/*.test.js        each exports `async function run({ check, section })`
```

Each suite runs in its own process. That is not optional: `db/init.ts` memoises
the open database and hands the same one to every later caller, and every
zustand store is created once per module load. Sharing a process had the
quotations suite counting the ledger suite's bills, which looks like a bug in
the app rather than in the harness.

## What this harness can and cannot say

It is a stand-in for a device, and its gaps are where the bugs have always been.
Three have reached the owner's phone, and every one got there through a place
where the shim was kinder than the real library. **When a bug is found on the
device, fix the HARNESS first** — make the shim behave the way the real module
does, watch the suite go red for the real reason, and only then fix the code.
A green suite after a device bug means the harness is still lying.

Not covered, so a passing run says nothing about them:

- **No renderer.** Screen behaviour is checked by reading source, which catches
  wiring being removed and nothing else. Touch handling — a nested `Pressable`
  inside a row that navigates — has to be checked on a real build.
- **No filesystem.** `expo-file-system` throws. Backup writing, the safety copy,
  PDF files and the logo copy are exercised only through their pure parts.
- **No native connection cache.** The real `SQLiteModule.kt` reference-counts
  connections by path, which is what made a close-and-swap restore silently do
  nothing.
- **No WAL.** Journal mode is accepted and ignored.
- **No concurrency.** `node:sqlite` is synchronous, so races serialise. A test
  asserting "only one of two concurrent writes won" passes whether or not the
  guard exists — say so rather than implying coverage.

## Negative controls

A check that cannot fail is worse than no check, because it looks like cover.
Before trusting a new suite, break the thing it claims to protect and watch it
go red. Two real examples from this project:

- A float test used `0.1 + 0.2` and thirds of 1000. Removing the paise rounding
  left it passing — those cases happen to err *upward*. A float example is not
  automatically a float test.
- A check for the double-conversion guard searched the whole file for
  `converted_bill_id IS NULL`, which also appears in an unrelated list filter.
  Removing the guard from the `UPDATE` left it passing.

## Backup and restore

`backup-format` covers the format itself — encode, decode, every refusal, the
checksum, the hand-written UTF-8, the WAL-header patch — and round-trips a real
database through serialise, encode, decode and reopen.

`restore-safety` drives `performRestore` through a fake `RestoreIo`: the step
order, both rollback paths, the step names carried in failures, and the
verification against the manifest. That seam exists for this suite; untested
rollback code is code that has never run.

Neither says a restore works on a phone. Both of this feature's device failures
— the close-and-swap that silently did nothing, and the WAL header that could
not be honoured in memory — lived inside the real implementations of those
steps, which need a filesystem and a native connection cache that this harness
does not have. `createBackup`, `listBackups`, pruning, `findSafetyCopy`,
`inspectBackup` and `restoreBackup` are not covered at all.

## History

This harness lived in a session-scoped temp directory until September 2026, when
it was swept: twenty suites, every shim and every compiled module, gone. It is
in the repository now for that reason. The suites here are a mix of
restorations and rebuilds — the ones marked "a rebuild, not a restoration" in
their header were written afresh from the decisions in `CLAUDE.md`, cover the
same rules, and do not carry the original assertions.
