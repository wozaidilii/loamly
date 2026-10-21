# Loamly

Static homepage for `www.loamly.net`.

A single-page English company site for Loamly (栖于垄上, Shanghai): a full-screen hero, an About section (content, tools, partnerships) and a Contact section (contact details coming soon). Everything is in `index.html` with inline CSS and a small inline script; there is no build step.

- `assets/*.webp` — hero and section photos (Unsplash License; credits in an HTML comment in `index.html`)
- `assets/ddin*.woff2` — D-DIN subsets (SIL OFL 1.1) for all Latin text
- `assets/notosc-logo.woff2` — Noto Sans SC subset (SIL OFL 1.1) containing only the logo tag 栖于垄上
- `favicon.ico`, `favicon.svg`, `favicon-32.png`, `favicon.png` (legacy path, same 32px image), `apple-touch-icon.png`, `assets/icon-192.png`, `assets/icon-512.png` — site icons
- Vercel Web Analytics is loaded via `/_vercel/insights/script.js`

If you change any text, regenerate the font subsets so every character is covered.

Open `index.html` directly in a browser or serve the folder with any static file server.
