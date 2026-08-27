/**
 * Structural checks for responsive layout.
 *
 * The mobile suite used to assert that particular Tailwind strings appeared in a
 * component — `html.includes('w-24') && html.includes('sm:w-28')`. Two things were
 * wrong with that. It broke every time the layout was rewritten even when the new
 * layout was better (those fixed widths were replaced by `flex-1`, which is more
 * robust, and the assertion read that as a regression). And it proved nothing:
 * a class string can appear anywhere in a file, including in a component that never
 * renders on mobile.
 *
 * These helpers extract the class lists a component actually declares and check
 * properties that have to hold for a layout to work on a narrow screen, whatever
 * utilities express them.
 */

const BREAKPOINTS = ['sm', 'md', 'lg', 'xl', '2xl'];

/**
 * Every class list a component declares.
 *
 * Covers `className="..."`, `className={"..."}` and the string literals inside
 * `cn(...)` calls, which is where conditional classes live.
 */
export function classLists(source: string): string[] {
  const lists: string[] = [];

  // className="..." and className='...'
  for (const m of source.matchAll(/className\s*=\s*"([^"]*)"/g)) lists.push(m[1]);
  for (const m of source.matchAll(/className\s*=\s*'([^']*)'/g)) lists.push(m[1]);

  // Any string literal inside a className={...} expression, including cn(...) args
  // and template literals, which is how conditional classes are written here.
  for (const m of source.matchAll(/className\s*=\s*\{([\s\S]*?)\}\s*(?:\n|\/?>|\s[a-zA-Z-]+=)/g)) {
    const expr = m[1];
    for (const lit of expr.matchAll(/["'`]([^"'`]*)["'`]/g)) lists.push(lit[1]);
  }

  return lists.filter(l => l.trim().length > 0);
}

/** Splits a class list into tokens. */
export function tokens(list: string): string[] {
  return list.split(/\s+/).filter(Boolean);
}

/** True when the token carries a breakpoint prefix, e.g. `sm:grid-cols-2`. */
export function isResponsive(token: string): boolean {
  return BREAKPOINTS.some(bp => token.startsWith(`${bp}:`));
}

/** The utility part of a token, with any breakpoint or state prefix removed. */
export function baseUtility(token: string): string {
  const parts = token.split(':');
  return parts[parts.length - 1];
}

/**
 * Class lists that set a grid column count.
 *
 * A grid is the commonest way to break a narrow viewport: `grid-cols-4` with no
 * mobile-first base squeezes four columns into 320px.
 */
export function gridLists(source: string): string[] {
  return classLists(source).filter(l => /(^|\s|:)grid-cols-/.test(l));
}

/**
 * A grid is mobile-first when it declares an unprefixed column count, so the
 * narrow-screen case is stated rather than inherited from a breakpoint.
 */
export function isMobileFirstGrid(list: string): boolean {
  const ts = tokens(list);
  const hasBase = ts.some(t => !isResponsive(t) && /^grid-cols-/.test(baseUtility(t)) && !t.includes(':'));
  const hasResponsive = ts.some(t => isResponsive(t) && /^grid-cols-/.test(baseUtility(t)));
  // A grid with no breakpoint variant at all is fine — it is the same everywhere.
  return hasBase || !hasResponsive;
}

/**
 * Fixed pixel widths wide enough to overflow the narrowest common viewport.
 *
 * 320px is the floor this app targets. `max-w-[...]` and `min-w-[...]` are excluded:
 * a maximum cannot overflow, and a minimum is usually a deliberate touch target.
 */
export function overflowingFixedWidths(source: string, limitPx = 320): string[] {
  const found: string[] = [];
  for (const list of classLists(source)) {
    for (const t of tokens(list)) {
      const util = baseUtility(t);
      const m = /^w-\[(\d+)px\]$/.exec(util);
      if (m && Number(m[1]) > limitPx) found.push(t);
    }
  }
  return found;
}

/**
 * Horizontal scroll containers that would show a scrollbar over content.
 *
 * A touch strip scrolls sideways; on desktop the bar is chrome nobody wants, so the
 * pattern here pairs `overflow-x-auto` with `no-scrollbar`.
 */
export function unhiddenScrollStrips(source: string): string[] {
  return classLists(source)
    .filter(l => tokens(l).some(t => baseUtility(t) === 'overflow-x-auto'))
    .filter(l => !tokens(l).some(t => baseUtility(t) === 'no-scrollbar'));
}

/**
 * Whether a component ever constrains long text.
 *
 * Sender names, subjects and snippets are arbitrary user data; without `truncate` or
 * `line-clamp-*` a single long token pushes the row past the viewport.
 */
export function truncationCount(source: string): number {
  return classLists(source)
    .filter(l => tokens(l).some(t => {
      const u = baseUtility(t);
      return u === 'truncate' || u.startsWith('line-clamp-');
    }))
    .length;
}
