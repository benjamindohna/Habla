/**
 * One unit of an AI message: either a tappable word/phrase (with a `native`
 * translation) or a non-tappable string (punctuation, spacing). Renderer
 * concatenates `es` fields in order to reconstruct the message.
 *
 * The `es` name is historical — it holds whatever the target language is.
 * See BACKLOG.md "Per-user target language spec" for the planned rename.
 */
export interface Segment {
  es: string;
  native?: string;
}
