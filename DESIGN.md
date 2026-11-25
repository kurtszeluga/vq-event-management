# VQ Design Notes

What the app looks like, and why. Written after the November 2026 restyle.
Most of this is here to stop the next person "finishing" something that was
left undone on purpose.

## Two palettes, on purpose

**The app is teal. The guild website's event feed is green.** This looks like
an unfinished colour sweep. It is not.

The feed's cards are embedded in villagequilters.com, whose own headings and
buttons are `#6a9a38`, a yellow-green. Teal Register buttons would sit directly
under yellow-green "CLICK HERE TO REGISTER & PAY" buttons on the same page. The
app is a different context, reached in a new tab through an explicit Register
click, and it keeps its own colour.

The feed uses `#4f7a28` rather than the website's `#6a9a38` exactly: the
website's green is 3.3:1 on white, which its own buttons already fail, and
copying an accessibility failure is the wrong kind of matching. `#4f7a28` is
the same hue - 91 degrees against its 89 - carried dark enough to clear 5:1
both as white-on-green and green-on-white.

## The app palette

Taken from the guild's logo, a pieced block in two greens with a navy centre,
rather than from any photograph. An earlier draft sampled the warm studio photo
and made oak the primary, which put the one piece of real brand equity on the
page in disagreement with every button beside it.

| Token | Hex | Role |
| --- | --- | --- |
| Anchor | `#14565f` | Header band, primary buttons, links, active nav |
| Deep | `#0d3c44` | Hover and pressed states, the band's bottom edge |
| Brass | `#e8b84b` | The one warm accent - active nav rule, hero button, pending dot |
| Ink | `#17282a` | Headings and body |
| Body | `#45565a` | Secondary copy |
| Muted | `#64787b` | Labels, meta lines |
| Border | `#dce7e8` | Hairlines, card and panel borders |
| Ground | `#f5f9f9` | Page background; cards are white |
| Available | `#275c44` | Seats open, signed-in dot, class pills |

Two rules that are easy to break:

- **Green is availability, not brand.** It used to be both. A class pill or an
  "open" pill left in anchor teal reads as a house announcement rather than a
  category.
- **Brass is rationed** to three places. It stops being an accent the moment it
  appears anywhere else.

Colours written as `rgba()` are invisible to a hex grep. Four survived the first
sweep for that reason. Check both when changing the palette.

## Event type colours live in three places

The same data is colour-coded on three surfaces, and a new event type needs
adding to all three. Each carries a comment saying so.

| Surface | Selector | File |
| --- | --- | --- |
| Pill | `.event-type-pill` | `src/styles.css` |
| Card's left spine | `.public-event-card`, `.home-season-row` | `src/styles.css` |
| Website feed pill | `.vq-feed-type` | `public/godaddy-event-feed.js` |

The two class types share one green deliberately: to a reader they are the same
kind of thing at two lengths. A type with no tone of its own falls back to a
neutral rather than borrowing another type's colour.

## Layout decisions worth keeping

- **The header is a band**, and the logo sits on a white chip inside it at 44px.
  It is a detailed pieced block; at the old 34px against teal it reads as a
  smudge, and the white ground is what it was drawn on.
- **The nav stays centred with Admin Dashboard last.** Admin Dashboard is set a
  step larger and heavier than its neighbours, carried by `emphasised: true` on
  the destination rather than the stylesheet keying off the path.
- **The hero is in the shell, not the page.** `HomeHero.jsx` renders from
  `App.jsx` on `/` only, between the header and `main`. Not inside
  `.site-header`, which is sticky and would follow the reader down the page; not
  inside `.page-content`, which it would have to break out of with a `100vw`
  trick that overflows wherever a scrollbar takes width.
- **The hero photograph is unscrimmed.** Band and image are the same
  temperature. A teal wash over a warm frame of that room turns the quilts grey.
- **The home page leads with the season**, not a card grid of links the nav
  already holds. Activities group under a heading per month; a registration the
  member holds marks its own row rather than being listed again elsewhere.
- **A programs row collapses to one line** until Details is opened. Register is
  never behind the toggle - that would put a click in front of the one thing
  people come to the page to do.

## Before editing the website feed

`public/godaddy-event-feed.js` is served to the public guild site, and two
things about it bite:

1. **Run `node --check public/godaddy-event-feed.js`.** Backticks inside `//`
   comments are fine and several already exist, but a backtick inside the CSS
   template literal closes the string early and blanks the live guild site.
   Lint, the build and the client tests all miss it.
2. **It cannot be previewed locally.** `/api/public-events` is a serverless
   function that does not run under `vite dev`, so the demo page reports the
   feed as unloadable whatever you have changed. The real check is
   villagequilters.com after deploy.

Its status pills, type tones and terracotta date stack are deliberately outside
the green scheme: they carry meaning rather than brand, and a card of nothing
but green loses the distinctions.
