# Design

## Overview
Loamly is a restrained cyberpunk project hub. The page uses a near-black architectural surface, oxblood red as the brand anchor, and a cold cyan signal accent for active affordances. The design should feel premium and quiet: more private terminal gallery than arcade neon.

## Color
Use OKLCH tokens only.

```css
:root {
  --bg: oklch(0.085 0 0);
  --surface: oklch(0.135 0.018 355);
  --surface-2: oklch(0.18 0.025 355);
  --ink: oklch(0.94 0.01 250);
  --muted: oklch(0.69 0.025 250);
  --subtle: oklch(0.48 0.025 250);
  --primary: oklch(0.45 0.145 2);
  --primary-strong: oklch(0.57 0.17 5);
  --accent: oklch(0.78 0.14 205);
  --accent-dim: oklch(0.54 0.09 205);
  --line: oklch(0.28 0.035 250);
}
```

Primary color carries identity through rules, project labels, and small surface highlights. Accent color is reserved for active links, focus states, and the animated signal field.

## Typography
Use system UI for the main voice and a monospace fallback only for compact domain labels and project IDs. Display headings use tight but readable spacing, never below `-0.04em`. Body copy stays below 75ch.

## Layout
The first viewport is the product: brand, domain, short purpose statement, and project launch controls. Content uses a wide but constrained grid with asymmetry between the main project and reserved future slots. Cards are only used for project launch affordances.

## Components
- Header: compact brand mark, canonical domain, active project link.
- Hero: clear Loamly identity with a canvas signal-field visual behind the content.
- Project launch: one active Anime anchor and non-clickable reserved slots.
- Footer: minimal production metadata and destination links.

## Motion
Canvas motion should be subtle and non-blocking. Page-load movement is limited to one reveal sequence. `prefers-reduced-motion: reduce` freezes animated canvas drift and disables decorative transitions.

## Accessibility
Keep link labels explicit, preserve visible focus rings, use semantic regions, and ensure reserved project slots are not keyboard-focusable.
