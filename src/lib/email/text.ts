// Small text helpers shared by the email modules.

/**
 * Just the newest message. Replies carry the whole earlier conversation underneath, and
 * an offer quoted from three weeks ago must not be read as news. Cuts at the usual
 * quote markers: "On … wrote:", Outlook's "From: … Sent:" block, "Original Message",
 * and runs of ">" lines.
 */
export function newestMessage(text: string): string {
  const markers = [
    /^\s*On\s.{3,200}?wrote:\s*$/im,
    /^\s*في\s.{3,200}?كتب.{0,40}:\s*$/im,
    /^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/im,
    /^\s*From:\s.+\n(?:.*\n){0,3}?\s*(Sent|Date):\s/im,
    /^\s*>.*\n\s*>/m,
  ];
  let cut = text.length;
  for (const rx of markers) {
    const m = rx.exec(text);
    if (m && m.index > 0 && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut).trim();
}
