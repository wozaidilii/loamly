# Design

## Overview
Loamly is a restrained cyberpunk company site and project hub. The page uses a near-black architectural surface, oxblood red as the brand anchor, cold cyan as the signal accent, and a cinematic CEO portrait to make the company feel premium and deliberate. The reference direction is a high-claim AI company landing page with long narrative sections, but Loamly should keep its own quieter future-media identity.

## Color
Use OKLCH tokens only.

```css
:root {
  --bg: oklch(0.085 0 0);
  --surface: oklch(0.135 0.018 355);
  --surface-2: oklch(0.18 0.025 355);
  --ink: oklch(0.94 0.01 250);
  --muted: oklch(0.72 0.025 250);
  --subtle: oklch(0.52 0.025 250);
  --primary: oklch(0.45 0.145 2);
  --primary-strong: oklch(0.57 0.17 5);
  --accent: oklch(0.78 0.14 205);
  --accent-dim: oklch(0.54 0.09 205);
  --line: oklch(0.29 0.035 250);
}
```

Primary color carries identity through rules, project labels, and small surface highlights. Accent color is reserved for active links, language state, focus states, and the animated signal field.

## Typography
Use system UI for the main voice with Japanese system fallbacks. Monospace is reserved only for compact domain labels, numerical markers, and operational labels. Display headings use tight but readable spacing, never below `-0.04em`. Body copy stays below 75ch.

## Layout
The first viewport communicates company ambition, not only project access. It pairs a large thesis headline with the CEO portrait. Lower sections follow a one-page company-site structure: doctrine, capabilities, projects, founder, career, contact. Cards are used only for project and contact affordances; capability sections use rule-based columns.

## Components
- Header: compact brand mark, anchor navigation, English/Japanese language switch.
- Hero: strong thesis, primary Anime CTA, CEO contact CTA, cinematic portrait.
- Doctrine: long-form narrative blocks inspired by high-claim company sites.
- Capabilities: four operational layers for Loamly's company story.
- Project launch: one active Anime anchor and non-clickable reserved slots.
- Founder: CEO image, quote, direct email.
- Career: invitation for like-minded collaborators.
- Contact: CEO, support, and live project routes.

## Motion
Canvas motion should be subtle and non-blocking. Page-load movement is limited to hero copy and visual entrance. `prefers-reduced-motion: reduce` freezes animated canvas drift and disables decorative transitions.

## Accessibility
Keep link labels explicit, preserve visible focus rings, use semantic regions, and ensure reserved project slots are not keyboard-focusable. The language switch uses buttons with `aria-pressed`; JavaScript updates `document.documentElement.lang`, title, and meta description.
