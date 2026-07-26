/**
 * Reduces a picked element to a short, structural CSS selector (spec FR-027,
 * research R7). Pure and jsdom-testable — the picker and the selection
 * reader (its range's common ancestor, FR-023c) both feed elements through
 * here on their way into `learnedSelectors.put()`.
 *
 * Postings on one host share a template but not ids or positions, so the
 * selector favors structure: `#id`, then a `[data-*]` attribute, then
 * `tag.class` filtered to human-looking classes, then `tag:nth-of-type(n)`.
 * Machine-generated classes (CSS-in-JS hashes) are never relied on. The path
 * is capped at ~4 segments, walking from the picked element upward and
 * stopping the first time a segment is stable enough to anchor the rest —
 * an #id or [data-*] match needs no further ancestor context.
 */

/** CSS-in-JS hash classes (`css-1x2y3z`, `jsx-123`) — never a stable anchor. */
const MACHINE_GENERATED_RE = /^(css|sc|jsx|emotion)-|[-_][a-z0-9]{5,}$/i;

const MAX_SEGMENTS = 4;

function humanClasses(el: Element): string[] {
  return Array.from(el.classList).filter((c) => c.length > 0 && !MACHINE_GENERATED_RE.test(c));
}

function firstDataAttribute(el: Element): string | null {
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-")) return attr.name;
  }
  return null;
}

function nthOfType(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 1;
  const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  return siblings.indexOf(el) + 1;
}

interface Segment {
  value: string;
  /** A stable enough identifier that the path need not climb any higher. */
  anchor: boolean;
}

function segmentFor(el: Element): Segment {
  const tag = el.tagName.toLowerCase();

  if (el.id && !MACHINE_GENERATED_RE.test(el.id)) {
    return { value: `#${el.id}`, anchor: true };
  }

  const dataAttr = firstDataAttribute(el);
  if (dataAttr) {
    return { value: `[${dataAttr}]`, anchor: true };
  }

  const classes = humanClasses(el);
  if (classes.length > 0) {
    return { value: `${tag}.${classes.join(".")}`, anchor: false };
  }

  return { value: `${tag}:nth-of-type(${nthOfType(el)})`, anchor: false };
}

export function selectorPath(el: Element): string {
  const segments: string[] = [];
  let node: Element | null = el;

  while (
    node &&
    node !== document.body &&
    node !== document.documentElement &&
    segments.length < MAX_SEGMENTS
  ) {
    const segment = segmentFor(node);
    segments.unshift(segment.value);
    if (segment.anchor) break;
    node = node.parentElement;
  }

  return segments.join(" > ");
}
