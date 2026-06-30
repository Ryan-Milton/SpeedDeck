// Best-effort display name for a track. Embedded tags win; when a title is
// missing or is really a filename (underscores / no spaces), prettify it so we
// don't show "MA_WarmMusic_Soulful_Static_Relax".

function stem(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.[a-z0-9]+$/i, "");
}

function humanize(s: string): string {
  return s
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A clean title for display. */
export function prettyTitle(t: { title?: string | null; path: string }): string {
  const raw = t.title?.trim();
  // A real title usually has spaces and no underscores — keep it as-is.
  if (raw && /\s/.test(raw) && !/_/.test(raw)) return raw;
  return humanize(raw && raw.length ? raw : stem(t.path));
}
