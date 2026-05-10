/**
 * One unit of an AI message: either a tappable word/phrase (with a `native`
 * translation) or a non-tappable string (punctuation, spacing). Renderer
 * concatenates `target` fields in order to reconstruct the message.
 */
export interface Segment {
  target: string;
  native?: string;
}
