/**
 * @fileoverview Cuts a string to a length without leaving half of a surrogate pair, which is not text and
 * which a log line or a JSON body would carry as a broken character.
 * @layer server/utils
 */

/**
 * The first `max` UTF-16 units of `text`, or one fewer when the cut would fall between the two halves of a
 * pair (so an emoji at the cut is dropped whole).
 *
 * @param text - The string to cut.
 * @param max - The most UTF-16 units to keep.
 * @returns `text` when it is no longer than `max`, else its cut.
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text
  const lastKept = text.charCodeAt(max - 1)
  const splitsPair = lastKept >= 0xd800 && lastKept <= 0xdbff
  return text.slice(0, splitsPair ? max - 1 : max)
}
