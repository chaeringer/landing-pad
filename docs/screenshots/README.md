# Screenshot harness

Renders the real Landing Pad `main.js` + `styles.css` in headless Chrome with a demo vault.

1. Download Lucide icons: `curl -sL https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js -o vendor/lucide.min.js`
2. `node build.js <plugin folder> page.html`
3. `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=1280,1260 --virtual-time-budget=4000 --screenshot=out.png "file://$PWD/page.html?theme=light"`

URL options: `theme=light|dark`, `mobile=1` (render at 600 px wide, crop to 780 px), `shot=menu|settings|windsock` (`stage=0-4`, `calm=1`, `skew`, `sy` for GIF frames).
