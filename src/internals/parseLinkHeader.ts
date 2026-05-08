// Parses RFC 5988 / RFC 8288 Link header values to find the `next` page URL.
//
// Used by GitHub (always sends Link), GitLab (sends Link), and we manually
// handle Azure DevOps which uses `$skip` query params instead.

export interface LinkHeader {
  next?: string;
  prev?: string;
  first?: string;
  last?: string;
}

const STANDARD_RELS = new Set<keyof LinkHeader>(['next', 'prev', 'first', 'last']);

export function parseLinkHeader(value: string | undefined): LinkHeader {
  if (!value) return {};
  const out: LinkHeader = {};
  // Split on commas that are NOT inside <...> brackets.
  // Simple tokenizer: walk char by char, respect bracket depth.
  const entries: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of value) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      entries.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf) entries.push(buf);

  for (const entry of entries) {
    const urlMatch = entry.match(/<([^>]+)>/);
    if (!urlMatch || !urlMatch[1]) continue;
    const url = urlMatch[1];
    const relMatch = entry.match(/rel\s*=\s*["']?([a-z]+)["']?/i);
    if (!relMatch || !relMatch[1]) continue;
    const rel = relMatch[1].toLowerCase() as keyof LinkHeader;
    if (STANDARD_RELS.has(rel)) {
      out[rel] = url;
    }
  }
  return out;
}
