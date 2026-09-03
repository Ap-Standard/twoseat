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
 *  - fetch anything, whether through an HTML tag or through markdown image
 *    syntax, either of which would pull an external URL the moment a reviewer
 *    opened the pull request
 *
 * The transform is lossy on purpose. A defanged mention still reads correctly
 * to a person; a live one is a side effect nobody asked for.
 */
import { stripInvisible } from '../redact.js';

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
  return stripInvisible(path).replace(/[`\r\n]/g, '').trim();
}

export function neutralizeForComment(text: string): string {
  return (
    stripInvisible(text)
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
      // Ordering invariant: a step that introduces a numeric entity has to run
      // after CROSS_REFERENCE, because every such entity contains a hash
      // against a digit and would otherwise be rewritten by it. `replace` makes
      // a single pass, so a step never rewrites its own output, only an earlier
      // step's. Both `&#64;` and `&#91;` are subject to this.
      .replace(CROSS_REFERENCE, '&#35;')
      .replace(MENTION, '&#64;')
      // Escaping the opening square bracket disables markdown links and, more
      // importantly, markdown images. An image needs no angle bracket to make
      // a reviewer's browser fetch an attacker's URL on page load, so escaping
      // HTML alone leaves the beacon open.
      .replace(/\[/g, '&#91;')
  );
}
