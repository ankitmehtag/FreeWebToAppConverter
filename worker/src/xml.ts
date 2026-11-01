const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/**
 * Escapes text for an Android string resource. The outer quotes keep aapt from
 * collapsing spaces, and a leading @ or ? would otherwise read as a reference.
 */
export const androidString = (value: string) => {
  const escaped = value.replace(/[\\"']/g, '\\$&').replace(/^[@?]/, '\\$&');
  return `"${escaped.replace(/[&<>"]/g, (char) => XML_ENTITIES[char] ?? char)}"`;
};
