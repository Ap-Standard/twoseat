/**
 * The single summary comment a run maintains on a pull request.
 *
 * Re-runs update that one comment in place. A gate that appends a new comment
 * per push trains reviewers to ignore it, which defeats the point.
 */

/** Hidden marker that lets a later run recognize its own comment. */
export const COMMENT_MARKER = '<!-- twoseat:review -->';

export interface CommentLike {
  id: number;
  /** The API models a missing body as null, so both absences are accepted. */
  body?: string | null | undefined;
}

export function findReviewComment(
  comments: readonly CommentLike[],
): CommentLike | null {
  const marked = comments.filter((comment) => comment.body?.includes(COMMENT_MARKER) === true);

  if (marked.length === 0) {
    return null;
  }

  // Lowest id wins. If duplicates ever exist, successive runs must converge on
  // the same comment instead of alternating between them.
  return marked.reduce((lowest, comment) => (comment.id < lowest.id ? comment : lowest));
}
