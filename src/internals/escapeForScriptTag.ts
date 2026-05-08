// `JSON.stringify` doesn't escape `<`, `>`, `&`, U+2028, or U+2029,
// so untrusted content (branch names, commit messages) can break out of
// an inline `<script>` block.
export function escapeForScriptTag(json: string): string {
  // Build the regex from explicit codepoints so the source file does not
  // contain literal U+2028 / U+2029 (which would corrupt the file itself).
  const dangerous = /[<>&\u2028\u2029]/g;
  return json.replace(dangerous, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}
