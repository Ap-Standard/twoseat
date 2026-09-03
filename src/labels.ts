/**
 * Keeping the unreviewed label in step with the current run.
 *
 * Split out from the entry point for the same reason run-review.ts was: the
 * degrade path is where this goes wrong, and a module that only runs inside
 * main cannot be tested at all.
 *
 * Nothing here throws. Labeling needs a permission the calling workflow may not
 * have granted, and a gate that fails because it could not annotate itself is
 * blocking on its own malfunction through a side door. Every failure comes back
 * as a warning string for the caller to log, and the summary comment carries
 * the same fact regardless.
 */
import { UNREVIEWED_LABEL } from './policy.js';

export interface LabelClient {
  add(name: string): Promise<void>;
  remove(name: string): Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether an error means the label was already absent.
 *
 * The status carries this, not the message. Octokit surfaces the API's own
 * wording, which does not contain the code, so matching on text would miss
 * every one of these and warn on almost every clean pull request.
 */
function isAlreadyAbsent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 404
  );
}

/**
 * Applies the label when the run did not review, and clears it when it did.
 *
 * @returns a warning to log, or null when there is nothing worth saying.
 */
export async function syncUnreviewedLabel(
  client: LabelClient,
  wanted: boolean,
): Promise<string | null> {
  try {
    if (wanted) {
      await client.add(UNREVIEWED_LABEL);
      return null;
    }

    await client.remove(UNREVIEWED_LABEL);
    return null;
  } catch (error: unknown) {
    // Removing a label a pull request never carried answers 404, which is the
    // ordinary case on every run that reviewed cleanly.
    if (!wanted && isAlreadyAbsent(error)) {
      return null;
    }

    return (
      `Could not update the ${UNREVIEWED_LABEL} label: ${describeError(error)}. ` +
      'The summary comment still carries the outcome.'
    );
  }
}
