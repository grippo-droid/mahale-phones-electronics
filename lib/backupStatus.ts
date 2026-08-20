/**
 * How overdue a backup is, and how to say so (T6.2).
 *
 * Pure, and separate from both screens, because Settings and the Dashboard have
 * to agree: a Dashboard banner nagging about a backup while Settings reports one
 * from this morning would teach the owner to ignore both.
 *
 * ---------------------------------------------------------------------------
 * What "last backed up" honestly means
 *
 * It means a backup file was created on the phone. It does **not** mean the file
 * reached Google Drive. Android's share sheet reports that it was dismissed, not
 * whether the transfer succeeded, so the app genuinely cannot know — and a
 * timestamp claiming more than it can prove is worse than none, because it is
 * exactly the reassurance someone stops checking.
 *
 * Hence the wording throughout is "Last backup", never "Your data is safe", and
 * the Settings section says plainly that a backup left on the phone is lost with
 * the phone.
 * ---------------------------------------------------------------------------
 */

/** After this long, the Dashboard starts asking. */
export const BACKUP_OVERDUE_DAYS = 14;

export type BackupStatus = {
  /** Whole local days since the backup; null if there has never been one. */
  days: number | null;
  /** For the Settings row, e.g. "Backed up 3 days ago". */
  label: string;
  /** Whether the Dashboard should raise a nudge. */
  overdue: boolean;
  /** The nudge's own wording. Null when not overdue. */
  nudge: string | null;
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whole days between two moments, counted on the calendar rather than in
 * elapsed hours — a backup taken at 11pm last night is "yesterday" at 1am, not
 * "2 hours ago". Consistent with how bills are dated elsewhere.
 */
export function daysBetween(from: Date, to: Date): number {
  const ms = startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime();
  return Math.round(ms / 86400000);
}

export function describeBackupStatus(
  lastBackupAt: string | null,
  now: Date = new Date()
): BackupStatus {
  if (!lastBackupAt) {
    return {
      days: null,
      label: 'No backup yet',
      overdue: true,
      nudge: 'Your shop data has never been backed up',
    };
  }

  const taken = new Date(lastBackupAt);
  if (Number.isNaN(taken.getTime())) {
    // A stored value that will not parse is not evidence of a backup.
    return {
      days: null,
      label: 'No backup yet',
      overdue: true,
      nudge: 'Your shop data has never been backed up',
    };
  }

  // A timestamp in the future means the phone's clock moved, not that a backup
  // is owed from the future. Treating it as today is the reading that does not
  // nag about something that has just been done.
  const days = Math.max(daysBetween(taken, now), 0);

  const label =
    days === 0 ? 'Backed up today' : days === 1 ? 'Backed up yesterday' : `Backed up ${days} days ago`;

  const overdue = days >= BACKUP_OVERDUE_DAYS;

  return {
    days,
    label,
    overdue,
    nudge: overdue ? `It has been ${days} days since your last backup` : null,
  };
}
