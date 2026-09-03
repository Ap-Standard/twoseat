/**
 * Neutralizing seat-authored text for a pull request comment.
 *
 * A seat writes prose about a diff it was given, so its words are shaped by
 * content the pull request author chose. That prose then lands in a comment
 * real reviewers read, which makes the comment a second place untrusted content
 * can act. Three things it must not be able to do:
 *
 *  - notify anyone, by writing a mention
 *  - reach another repository, by writing an issue reference
 *  - render markup, which would let a finding fetch an external image the
 *    moment a reviewer opened the pull request
 *
 * The transform is lossy on purpose. A defanged mention still reads correctly
 * to a person; a live one is a side effect nobody asked for.
 */

/**
 * Characters that are invisible or that reorder what a reader sees: control
 * codes, zero-width marks, and the bidirectional overrides that can display
 * a line in reverse. Tab, newline, and carriage return are left for the
 * whitespace collapse below, so removing the rest cannot join two words.
 */
const INVISIBLE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\ufeff]/g;

/** Three or more backticks would open a fence and swallow the rest of the comment. */
const FENCE = /`{3,}/g;

/** A mention: an at sign directly against a word character. */
const MENTION = /@(?=\w)/g;

/** An issue or pull request reference: a hash directly against a digit. */
const CROSS_REFERENCE = /#(?=\d)/g;

/**
 * Neutralizes a file path for display inside a code span.
 *
 * A path is chosen by whoever opened the pull request. Rendered between
 * backticks, a path containing one would close the span early and leave the
 * rest of the line to be interpreted as markdown. Paths keep their slashes and
 * dots so a reviewer can still recognize the file.
 */
export function neutralizePathForComment(path: string): string {
  return path.replace(INVISIBLE, '').replace(/[`\r\n]/g, '').trim();
}

export function neutralizeForComment(text: string): string {
  return (
    text
      .replace(INVISIBLE, '')
      // Newlines let a finding add its own headings, tables, and list items to
      // a comment whose structure the action is supposed to own.
      .replace(/\s+/g, ' ')
      .trim()
      // Ampersand first. Escaping it afterwards would mangle the entities the
      // later steps introduce, and doing it first stops a finding from
      // smuggling markup through a pre-written entity.
      .replace(/&/g, '&amp;')
      // Escaping the opening angle bracket disables every tag. It also makes
      // the action's own HTML comment marker unreproducible, so a finding
      // cannot plant a decoy for a later run to latch onto.
      .replace(/</g, '&lt;')
      .replace(FENCE, '`')
      // Cross-references before mentions. The entity a mention becomes contains
      // a hash against a digit, so running these the other way round would
      // rewrite the escape this step just introduced.
      .replace(CROSS_REFERENCE, '&#35;')
      .replace(MENTION, '&#64;')
  );
}
