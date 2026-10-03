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

/**
 * The readable text of an HTML-only email. Stripping the tags alone keeps the contents of
 * <style> blocks — Study Group's notices put pages of CSS in front of the message, so the
 * AI read ".ExternalClass { width: 100% } …" instead of "Application received".
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim();
}

/** An email's body as text: the plain-text part, else its HTML made readable. */
export function emailBodyText(parsed: { text?: string; html?: string | false }): string {
  return parsed.text ?? (parsed.html ? htmlToText(String(parsed.html)) : '');
}
