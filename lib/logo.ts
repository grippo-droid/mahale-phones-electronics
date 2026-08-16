import { Directory, File, Paths } from 'expo-file-system';

/**
 * Storing the shop's logo (T4.1).
 *
 * The one thing this module exists to get right: **the picked image must be
 * copied, not referenced.**
 *
 * `expo-image-picker` hands back a URI in the app's cache directory. Android
 * clears that directory whenever the device runs low on storage, and it is also
 * wiped by "Clear cache" in the system settings. A logo path pointing there
 * would work perfectly in testing and then quietly vanish months later, taking
 * the logo off every bill printed after that with no error to explain it.
 *
 * So the file is copied into the document directory, which is the one place
 * `expo-file-system` documents as safe from the system deleting it.
 *
 * SDK 57 note: this uses the `File`/`Directory`/`Paths` classes. The old
 * `copyAsync`/`deleteAsync` helpers still exist as names but throw at runtime —
 * they moved to `expo-file-system/legacy`.
 */

/** Where logos live, inside the document directory. */
const LOGO_DIRECTORY_NAME = 'branding';

/** Extensions worth keeping; anything else is stored as .png. */
const KNOWN_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

function logoDirectory(): Directory {
  return new Directory(Paths.document, LOGO_DIRECTORY_NAME);
}

function extensionFor(uri: string): string {
  // Strip any query string before looking at the extension — some providers
  // return content URIs with one appended.
  const clean = uri.split('?')[0].toLowerCase();
  const match = KNOWN_EXTENSIONS.find((ext) => clean.endsWith(ext));
  return match ?? '.png';
}

/**
 * Copies a picked image into permanent storage and returns its URI.
 *
 * The filename carries a timestamp rather than being fixed. A fixed name would
 * be the same URI every time, and React Native's image cache keys on the URI —
 * replacing the logo would leave the old one on screen until the app restarted.
 */
export async function saveLogo(sourceUri: string): Promise<string> {
  const directory = logoDirectory();
  if (!directory.exists) directory.create({ intermediates: true });

  const source = new File(sourceUri);
  const destination = new File(directory, `logo-${Date.now()}${extensionFor(sourceUri)}`);

  source.copy(destination);
  return destination.uri;
}

/**
 * Deletes a stored logo, ignoring one that has already gone.
 *
 * A missing file is the expected case after a restore onto a different phone —
 * the database row survives the backup, the file it points at may not — so it
 * is not treated as an error.
 */
export async function deleteLogo(uri: string | null): Promise<void> {
  if (!uri) return;

  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing useful to do: the goal was for the file not to be there.
  }
}

/**
 * Replaces the current logo with a newly picked one, removing the old file.
 *
 * The copy happens before the delete, so a failure part-way through leaves the
 * existing logo in place rather than neither.
 */
export async function replaceLogo(
  sourceUri: string,
  previousUri: string | null
): Promise<string> {
  const saved = await saveLogo(sourceUri);
  if (previousUri && previousUri !== saved) await deleteLogo(previousUri);
  return saved;
}

/**
 * Whether a stored logo path still points at a file that exists.
 *
 * Worth checking before printing: a path can outlive its file across a restore,
 * and a bill template that assumes otherwise renders a broken image.
 */
export function logoExists(uri: string | null): boolean {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}
