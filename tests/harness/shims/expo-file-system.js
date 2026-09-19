'use strict';

/**
 * `expo-file-system`, stubbed to throw.
 *
 * This is a DELIBERATE gap, not an omission. Backup writing, the safety copy,
 * PDF files on disk and the logo copy all touch a real filesystem through a
 * scoped, permission-checked API that cannot be modelled honestly here — see
 * the notes in CLAUDE.md about `File.move` and the Expo Go sandbox. Throwing
 * means a suite that wanders into one of those paths fails loudly instead of
 * passing against a fiction.
 *
 * What IS covered without it: every pure part — the backup format's encode and
 * decode, the WAL-header patch, the restore ordering through its injected
 * `RestoreIo`, and the PDF template as a string.
 */
const refuse = (what) => () => {
  throw new Error(
    `expo-file-system is not modelled in the harness (${what}). ` +
      'Drive this through its injected seam, or check it on a device.'
  );
};

class File {
  constructor() {
    throw new Error('expo-file-system File is not modelled in the harness.');
  }
}
File.pickFileAsync = refuse('File.pickFileAsync');

class Directory {
  constructor() {
    throw new Error('expo-file-system Directory is not modelled in the harness.');
  }
}

// Assigned one at a time rather than as one object literal: Node's CommonJS
// named-export detection reads `exports.X = ...` reliably, and misses keys
// written inside an object literal — which the .ts sources import by name.
exports.File = File;
exports.Directory = Directory;
exports.Paths = { document: '/harness/document', cache: '/harness/cache' };
