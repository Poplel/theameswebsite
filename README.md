# theameswebsite

Source html for **[theames.poplel.xyz](https://theames.poplel.xyz)**

Styled with [98.css](https://jdan.github.io/98.css/), same as the Nudibranch site.

- `/` home and downloads, `/marketplace/`, `/docs/` (the .theame format), `404.html`.
- `sidebar.html` is shared by every page (loaded by `sidebar.js`), including the "Made a theame?" box.
- `downloads/` holds the release files the home page links to.
- `_server/` is the nginx config and compose file the site runs with. It isn't served.

## Publishing

Push to `main`. The server pulls this repo every 10 minutes.

## Caching

Cloudflare tells browsers to keep `.js`, `.css` and image files for 4 hours, whatever nginx says. Pages
(HTML) aren't cached. So the pages load the CSS and scripts with a version number (`/style.css?v=...`).
**When you change `style.css`, `sidebar.js` or `marketplace.js`, bump the version** in every page, or
visitors keep the old file for up to 4 hours:

    V=$(date +%Y%m%d%H%M); sed -i '' -E "s#\?v=[0-9a-z]+\"#?v=$V\"#g" index.html marketplace/index.html docs/index.html 404.html

## Marketplace

`marketplace.js` lists the `.theame` files in
`https://media.pophosting.xyz/assets/Theames/Themes/` and reads each one's `manifest.json` and icon
in the browser. To add a theme to the marketplace, upload it to that folder. The site doesn't need to change.

## New app release

1. Put the new `.dmg`, `.zip` and `SHA256SUMS.txt` in `downloads/` and remove the old ones.
2. In `index.html`, update the two download links, sizes, SHA-256 lines and the version in the status bar.
3. Push.
