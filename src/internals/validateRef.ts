// Validates git refs and paths from untrusted sources (URI query params,
// webview messages). Even with `--` separators, refs starting with `-` or
// containing control chars would fail in git anyway — but catching them here
// gives a clear error instead of an opaque git failure.

// Subset of `git check-ref-format` rules. Caps at 255 chars to avoid
// pathological input.
//
// Reserved chars per git: space, ~, ^, :, ?, *, [, \\, control chars (0x00-0x1f, 0x7f)
// Plus: cannot start with -, cannot contain .., cannot contain @{, cannot end with .lock
const REF_RESERVED = /[\x00-\x1f\x7f ~^:?*[\\]/;
const PATH_CONTROL = /[\x00-\x1f\x7f]/;

export function isValidGitRef(ref: string): boolean {
  if (typeof ref !== 'string') return false;
  if (ref.length === 0 || ref.length > 255) return false;
  if (ref.startsWith('-')) return false;
  if (ref.endsWith('.lock')) return false;
  if (ref.includes('..')) return false;
  if (ref.includes('@{')) return false;
  if (REF_RESERVED.test(ref)) return false;
  return true;
}

export function isValidRepoPath(path: string): boolean {
  if (typeof path !== 'string') return false;
  if (path.length === 0) return false;
  if (PATH_CONTROL.test(path)) return false;
  return true;
}

// Throws on invalid refs — use at every trust boundary.
export function requireValidRef(ref: string, field = 'ref'): string {
  if (!isValidGitRef(ref)) {
    throw new Error(`Invalid git ref for ${field}: refused as flag-injection / control-character / over-long`);
  }
  return ref;
}
