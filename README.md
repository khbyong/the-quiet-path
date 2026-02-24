# the quiet path

A tiny Game Boy–ish web game (wholesome, bittersweet) about a little journey of kai & june.

## run

### option 1: just open
Open `index.html` in a browser.

### option 2 (recommended): local server
Some browsers are picky about local file access. Use a simple server:

```bash
cd "/Users/phry/test game"
python3 -m http.server 8080
```

Then visit:
- http://localhost:8080

## controls
- arrow keys: move
- space: talk / continue
- z: run
- m: mute
- r: restart

## notes
- no network, no external assets
- renders pixel art directly on canvas
