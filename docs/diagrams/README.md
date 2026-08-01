# Diagrams

## `juniper-overview.svg` / `.png`

One slide explaining what Juniper is, for an audience with no clinical or
technical background — a board, a pilot clinic, a family open evening.

**Insert the SVG** where you can: PowerPoint 2016+, Keynote and Google Slides
all take it, and it stays sharp at any projector resolution. The PNG (3200×1800)
is there for anything older.

Deliberately absent: FHIR, Medplum, access policies, the agent architecture,
and the word "AI" doing any load-bearing work. The claim being made is about
what happens to a person and who sees what, and the privacy line at the foot is
part of the message rather than a disclaimer — it is the first thing a family
audience asks about an app that listens to their mother's phone calls.

### Regenerating the PNG

The SVG is the source; the PNG is derived. macOS `qlmanage` crops rather than
fits, so render with a browser:

```sh
cd docs/diagrams
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1600,900 --screenshot="$PWD/juniper-overview.png" \
  "file://$PWD/juniper-overview.svg"
```
