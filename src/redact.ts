/**
 * Removing what must never be published.
 *
 * Two jobs, kept together because they are only correct in combination.
 *
 * Invisible characters come out first. A secret broken by a zero-width
 * character does not match an exact-string redaction, and any later step that
 * strips invisible characters would reassemble it. Stripping before redacting
 * closes that reconstruction path.
 *
 * `core.setSecret` masks a value in the run log. It does nothing for a pull
 * request comment, so anything bound for a comment is redacted here instead.
 */

/**
 * Characters that are invisible or that reorder what a reader sees: control
 * codes, zero-width marks, and the bidirectional overrides that can display a
 * line in reverse. Tab, newline, and carriage return survive, so removing the
 * rest cannot join two words.
 */
export const INVISIBLE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\ufeff]/g;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '');
}

/**
 * Removes a secret from text bound for somewhere public.
 *
 * Call stripInvisible first when the text came from outside this process.
 */
export function redactSecret(text: string, secret: string | null): string {
  if (secret === null || secret === '') {
    return text;
  }
  return text.split(secret).join('(redacted)');
}
