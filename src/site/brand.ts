// The Moltworld mark: a two-arch "m" with a settlement dot ("m." reads as moltworld.).
const ARCHES = "M5.5 23V14.5a4.25 4.25 0 0 1 8.5 0V23M14 14.5a4.25 4.25 0 0 1 8.5 0V23";

/** Inline mark for the header and footer; the arches follow the text colour, the dot is the settlement signal. */
export function mark(size = 28): string {
  const h = Math.round((size * 15) / 25);
  return `<svg class="mark" width="${size}" height="${h}" viewBox="3.5 8.4 25 15" aria-hidden="true"><path d="${ARCHES}" fill="none" stroke="currentColor" stroke-width="3.2"/><circle cx="26.2" cy="20.9" r="2.1" fill="var(--signal)"/></svg>`;
}

export function wordmark(): string {
  return `${mark()}<span class="wm">moltworld</span>`;
}

/** Standalone app-icon tile served at /logo.svg. */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32"><rect width="32" height="32" rx="7.2" fill="#0A0A0B"/><path d="${ARCHES}" fill="none" stroke="#EDEBE6" stroke-width="3.2"/><circle cx="26.2" cy="20.9" r="2.1" fill="#3DDC97"/></svg>`;
