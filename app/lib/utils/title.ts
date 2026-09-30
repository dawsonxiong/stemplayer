/** A readable song title from an uploaded filename: no extension, and
 *  underscores or dashes used as spaces become spaces. */
export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+-\s+|(?<=\S)-{2,}(?=\S)/g, " – ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
