# Audio Review Companion — Design System (v2)

## Purpose

This file is the single source of truth for all visual and interaction design decisions in Audio Review Companion. Every AI Studio build prompt must reference this file. When adding new features or components, follow these rules exactly. Do not introduce new colours, fonts, shadows, or patterns not defined here.

---

## Design language

The aesthetic is **calm, paperlike, and embossed**. Surfaces sit on the same warm-grey "paper" plane. Elevation is created through a paired **inset top highlight + soft outer shadow** — never through colour contrast or heavy borders. One **high-contrast dark element** anchors each screen (the primary action — Play, Load document — or, on desktop, the sidebar). The teal accent is used sparingly and only for small status marks, active carousel segments where the dark token is already in use, and small chips.

Reference: think modern macOS-style document tools. Light, tactile, slightly tactile/relief. Nothing should feel loud or decorative.

---

## Colour palette

All colours must use CSS custom properties defined here. Never hardcode hex values elsewhere in the codebase.

```css
:root {
  /* Surfaces — warm-grey paper */
  --color-bg:              #ebe9e5;   /* Page background */
  --color-surface:         #f3f1ed;   /* Cards, embossed pills, buttons */
  --color-surface-2:       #f7f5f1;   /* Inputs, recessed wells */
  --color-sidebar:         #2a2926;   /* Dark sidebar / primary action */
  --color-sidebar-active:  #3a3936;   /* Active sidebar item / hover */

  /* Borders — paired highlight + line for the emboss */
  --color-border:          rgba(40,30,20,0.10);    /* Outer 1px line */
  --color-border-hi:       rgba(255,255,255,0.85); /* Inset top highlight */
  --color-divider:         rgba(40,30,20,0.08);

  /* Text — every value passes WCAG AA 4.5:1 on bg + surface */
  --color-text:            #1a1a1a;   /* 13:1 on bg — primary */
  --color-text-muted:      #5e5d59;   /* 5.6:1 on bg — secondary, AA */
  --color-text-faint:      #86857f;   /* 3.1:1 — large text / icons only, AA-large */
  --color-text-inverse:    #f7f5f1;   /* Text on dark — 13:1 on #2a2926 */

  /* Dark — high-contrast primary action */
  --color-dark:            #2a2926;
  --color-dark-soft:       #3a3936;

  /* Accent — teal, used sparingly */
  --color-accent:          #4ecdc4;
  --color-accent-light:    rgba(78,205,196,0.18);
  --color-accent-text:     #16615c;   /* 5.4:1 on surface, AA */

  /* Saffron — comments-count badge ONLY.
     #AA5524 passes WCAG 1.4.11 against bg (4.27:1) and surface (4.51:1).
     --color-saffron-on (= --color-text-inverse) digits hit 4.76:1
     against the chip — AA normal-text. Treat like teal: small semantic
     mark only, never a large fill, never a CTA. */
  --color-saffron:         #aa5524;
  --color-saffron-on:      #f7f5f1;

  /* Focus ring — darker, more saturated teal.
     Separate token from --color-accent because the brand teal lacks 3:1
     against the warm-grey surfaces. This value hits 3:1 on bg, surface,
     AND the dark anchor — one ring colour, all surfaces. */
  --color-focus:           #1a8a82;   /* 3.5:1 on bg, 3.7:1 on surface, 3.5:1 on dark */

  /* Status */
  --color-success:         #3a9d8c;
  --color-warning:         #a36a1f;
  --color-error:           #b03a3a;
}
```

### Colour rules

- Background is always `--color-bg`. Never use pure white (#ffffff) as a background.
- Cards and panels sit on `--color-surface` or `--color-surface-2`.
- The primary action on a screen always uses `--color-dark`. There is exactly **one** dark anchor per screen — Play button on playback, Load button on the loader. Do not multiply dark surfaces.
- Teal appears only on: the small status dot beside "Reviewing", small accent labels like "DEFAULT RESOURCE", optional thin underline on active tabs.
- The active carousel segment uses `--color-dark`, **not** teal. (Teal at small heights doesn't pass WCAG 3:1 against the warm-grey bg; the dark token does, and matches the play-button anchor.)
- Never use teal as a background fill for large areas.
- Saffron `--color-saffron` is reserved for the **comments-count badge**. Like teal, it never becomes a large fill, a CTA, or text colour on paper — it is a small semantic mark only.

### Accessibility — WCAG AA 2.2

All text and icon colours in the system meet WCAG AA 2.2 contrast minimums:
- Body and label text (`--color-text`, `--color-text-muted`) ≥ 4.5:1 on bg and surface.
- Large text and icons (`--color-text-faint`) ≥ 3:1.
- Interactive components and meaningful graphical objects ≥ 3:1 against their adjacent background.
- The active carousel segment is differentiated from inactive segments by **both** colour (dark vs translucent black) **and** size (14px vs 10px height), so users with reduced colour perception still see the active state.
- The comments-count badge uses `--color-saffron` (#AA5524), which hits **4.27:1 against bg** and **4.51:1 against surface** (passes 1.4.11). The digit inside uses `--color-saffron-on` (#F7F5F1) at **4.76:1** against the chip — passes AA normal-text.

---

## Typography

```css
:root {
  --font-body:   'Inter', 'SF Pro Text', -apple-system, sans-serif;
  --font-serif:  'Source Serif 4', 'Source Serif Pro', Georgia, serif;

  --text-xs:   11px;   /* Tiny labels, badge text, metadata */
  --text-sm:   13px;   /* Navigation items, secondary labels */
  --text-base: 15px;   /* Body text, list items */
  --text-lg:   18px;   /* Section headings */
  --text-xl:   24px;   /* Panel titles */
  --text-read: 22px;   /* Reading-body text (Source Serif) */
  --text-hero: 36px;   /* Hero title on the loader */
  --text-stat: 48px;   /* Large key statistics (desktop) */
}
```

### Typography rules

- Use **Inter** for UI text. Load via Google Fonts CDN. Weight range 400–600.
- Use **Source Serif 4** for **reading content only** — the chunk of doc text being read aloud. Never use the serif for UI chrome (labels, buttons, headings).
- Body text: 400 weight, `--text-base`.
- Labels and navigation: 400 weight, `--text-sm`.
- Section headings (within reading body): 600 weight, `--text-xs`, uppercase, letter-spacing 0.08em, in `--color-text-muted`.
- Reading body: 400 weight, `--text-read`, line-height 1.4, serif.
- Panel and page titles: 500 weight, `--text-xl`.
- Hero title (loader): 500 weight, `--text-hero`, line-height 1.05, letter-spacing -0.02em.
- Never use bold (700+) weight anywhere. Maximum is 600 (semibold) for headings, primary buttons, and counters.
- Letter spacing on all-caps labels: `0.06em` (UI) or `0.08em` (reading body section label).

---

## Spacing

All spacing uses the 4px base grid. Reference tokens only.

```css
:root {
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
}
```

### Spacing rules

- Card padding: `--space-5` or `--space-6`.
- Between list items: `--space-2` to `--space-3`.
- Between sections: `--space-6` to `--space-8`.
- Mobile screen horizontal padding: `--space-5` (20px).
- Touch targets ≥ 44×44px (controls, chevrons, menu trigger).

---

## Border radius

```css
:root {
  --radius-sm:   6px;
  --radius-md:   10px;
  --radius-lg:   12px;
  --radius-xl:   14px;
  --radius-full: 9999px;
}
```

- Cards: `--radius-xl`.
- Buttons, chips, embossed pills: `--radius-lg` (12px) — slightly larger than v1 for a softer feel.
- Inputs: `--radius-md`.
- Circular control buttons / play button: `--radius-full`.

---

## Elevation — the embossed treatment

Elevation in v2 is layered: **cards** get a subtle paired top-highlight + soft outer shadow, **secondary buttons** get only a hairline border + faint top highlight (no outer shadow), and the **single dark anchor** per screen gets a deeper embossed shadow. The result is a quiet, outlined feel for chrome with one assertive primary action.

```css
/* Card emboss — subtle layered shadow under top highlight */
--shadow-emboss:
  inset 0 1px 0 rgba(255,255,255,0.7),
  0 1px 2px rgba(40,30,20,0.04),
  0 2px 6px rgba(40,30,20,0.03);

/* Outline / hairline — SECONDARY buttons, chips, control pills.
   Just the top inset highlight against a 1px border. No outer shadow. */
--shadow-outline:
  inset 0 1px 0 rgba(255,255,255,0.6);

/* Recessed surface — inputs, search wells, "pressed" menu trigger */
--shadow-recess:
  inset 0 1px 2px rgba(40,30,20,0.07),
  inset 0 -1px 0 rgba(255,255,255,0.5);

/* Dark embossed — the primary play button & primary CTA */
--shadow-dark-emboss:
  inset 0 1px 0 rgba(255,255,255,0.18),
  inset 0 -1px 0 rgba(0,0,0,0.4),
  0 2px 4px rgba(0,0,0,0.18),
  0 10px 24px rgba(0,0,0,0.22);
```

### Elevation rules

- **Cards** use `--color-surface` background + 1px `--color-border` + `--shadow-emboss`. They're the only chrome that gets a real outer shadow.
- **Secondary buttons, chips, control pills, chevrons** use **transparent background** + 1px `--color-border` + `--shadow-outline`. They are outlined hairlines, not filled chips — read as quiet, embossed structure rather than buttons stacked on the surface.
- **The menu trigger** uses `--shadow-outline` when its menu is closed and `--shadow-recess` when open (pressed-in state).
- **Inputs and search wells** use `--shadow-recess` against `--color-surface-2`.
- **The dark anchor** (play button, primary CTA) uses `--color-dark` background + `--shadow-dark-emboss`.
- Never use coloured shadows. Never give a secondary button a filled background and an outer shadow — that double-stack is what makes them feel "busy". One layer of elevation only.

---

## Components

### Cards

Background `--color-surface`, `--radius-xl`, 1px `--color-border`, `--shadow-emboss`, padding `--space-5`.

### Buttons

- **Primary** (the one dark anchor per screen): `--color-dark` background, `--color-text-inverse` text, `--radius-lg`, `--shadow-dark-emboss`, height 44px, weight 600.
- **Secondary** (outlined / hairline): **transparent** background, `--color-text` text, 1px `--color-border`, `--shadow-outline` (just the top highlight, no outer shadow), `--radius-lg`, height 44px, weight 500. They sit quietly on the surface — outlines, not stacked chips.
- **Ghost**: transparent, `--color-text-muted` text, no border, no shadow. Use sparingly.
- Touch targets: 44×44 minimum. Round control buttons (mic, prev/next, comments) are 48×48 outlined pills (same `--shadow-outline` over transparent background).
- No gradient fills. Solid colours only.

### Inputs

`--color-surface-2` background, 1px `--color-border`, `--radius-md`, height 44px, `--shadow-recess`. Placeholder text `--color-text-muted`. Focus ring: 2px `--color-dark` (not accent) at 2px offset.

### Carousel (section progress)

- Up to 10 segments visible, windowed around the active section.
- Inactive segments: 10px tall, `rgba(40,30,20,0.10)` (or `0.22` for "done").
- Active segment: 14px tall, `--color-dark` background, inset top highlight + 1px outer drop.
- Chevrons on either side: 40×40 embossed pills (`--shadow-emboss`).

### Playback controls

Five buttons in a horizontal grid: **mic · prev · play · next · comments**.
- Outer four are 48×48 round **outlined** pills — transparent background, 1px `--color-border`, `--shadow-outline`. They read as structured chrome around the dark anchor, not as additional filled buttons.
- Mic icon: the same shape always; when muted, overlay a diagonal slash (do **not** swap to a different icon).
- Play / pause: 68×68 round, dark embossed (`--color-dark` + `--shadow-dark-emboss`), `--color-text-inverse` icon. This is the screen's anchor.
- Comments button has a **saffron** numeric badge: `--color-saffron` background, `--color-saffron-on` digit (Inter 600, 10–11px), with a 1px `--color-bg` ring so it punches out cleanly. Saffron is used here instead of dark because stacking another near-black mark adjacent to the play anchor read as noisy; saffron differentiates "unread count" from "primary action" while staying small and warm-toned, consistent with the rest of the system. Contrast: 4.27:1 chip-vs-paper, 4.76:1 digit-vs-chip — both AA.

### Header (playback)

44px tall, divider underneath. Layout: `[ARC logo]  [vertical divider]  [doc title, truncates with ellipsis]  [⋯ overflow]`. The overflow trigger is a 40×40 **outlined** pill (transparent + `--shadow-outline`); when its menu is open, it switches to `--shadow-recess` (pressed in).

### Menu (overflow)

Pops down from the trigger. `--color-surface-2` background, `--radius-lg`, `--shadow-emboss` plus a soft outer drop (`0 12px 40px rgba(0,0,0,0.14)`). Items: 13px text, left-aligned, optional leading icon (16px), optional trailing count.

---

## Interaction states

Every interactive surface has hover, pressed, and keyboard-focus states. The press state in particular should feel **tactile** — the button pushes in, the shadow flips from outer to inset, and the surface translates down half a pixel. This is the only place v2 uses motion.

Transitions: `background 120ms ease, box-shadow 120ms ease, transform 80ms ease`.

### Secondary / outlined / control pills / chevrons

| State | Treatment |
|---|---|
| Rest | Transparent bg, 1px `--color-border`, `--shadow-outline` (or no shadow on chevrons) |
| Hover | Background tints to `rgba(40,30,20,0.035)`. Border + shadow unchanged. |
| Pressed | Background `rgba(40,30,20,0.06)`, shadow flips to `inset 0 1px 2px rgba(40,30,20,0.10), inset 0 -1px 0 rgba(255,255,255,0.4)` (recessed), `transform: translateY(0.5px)`. The button *sinks in*. |
| Focus-visible | `outline: 2.5px solid var(--color-focus); outline-offset: 2px;` — the deep-teal ring (`#1A8A82`) passes WCAG 1.4.11 against bg, surface, and the dark anchor (≥3:1 everywhere). |

### Primary dark anchor (Play, Load document)

| State | Treatment |
|---|---|
| Rest | `--color-dark` bg, `--shadow-dark-emboss` |
| Hover | Background brightens to `--color-dark-soft` (#3a3936). Shadow unchanged. |
| Pressed | Background returns to `--color-dark`; shadow flips to `inset 0 2px 4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.15)` (deep inset — the dark anchor *deepens*). `transform: translateY(0.5px)`. |
| Focus-visible | `outline: 2.5px solid var(--color-focus); outline-offset: 3px;` — extra offset because the dark button has its own border. The deep-teal ring hits 3.5:1 against the dark anchor and 3.5:1 against the surrounding paper. |

### Ghost / icon-only (carousel chevrons, menu items, text links)

| State | Treatment |
|---|---|
| Rest | Transparent. No border, no shadow. |
| Hover | Background tints to `rgba(40,30,20,0.05)`. |
| Pressed | Background deepens to `rgba(40,30,20,0.09)`. `transform: translateY(0.5px)`. |
| Focus-visible | `outline: 2.5px solid var(--color-focus); outline-offset: 2px;` |

### Tactility principles

- **Press = sink**. Never scale up on press, never colour-flip. The button moves *into* the surface.
- **Hover is whisper-quiet**. A 3.5% black wash is enough — never use accent colour on hover.
- **Focus is deep teal**. All focus rings use `--color-focus` (#1A8A82) at 2.5px — a darker, more saturated sibling of the brand teal that satisfies WCAG 1.4.11 against every surface in the system (3.5:1 on bg, 3.7:1 on surface, 3.5:1 on the dark anchor). The brand teal `--color-accent` (#4ECDC4) is reserved for the logo swoosh, mic indicators, and small semantic marks where it is paired with a second cue (size, weight, motion) and contrast isn't the load-bearing signal.
- **Disabled**: opacity 0.4, `cursor: not-allowed`. No hover/press feedback.
- Mute toggle: muted state additionally dims the icon colour to `--color-text-muted`; press behaviour identical to other outlined buttons.

---

## Mobile rules

- Designed mobile-first; 360–402px viewport is the canonical width.
- No left sidebar. The dark anchor on mobile is the play button.
- All controls hug the bottom safe-area inset (above the home indicator).
- Body content (the read-aloud chunk) sits in a generous serif block with no card chrome — clarity > containment.

---

## What to never do

- Never use pure white `#ffffff` as a background.
- Never use pure black `#000000` for text or surfaces — `#2a2926` is the dark token.
- Never use gradients on backgrounds, buttons, or cards.
- Never use teal as a large fill or as the active carousel segment.
- Never use bold weight (700+) text.
- Never use coloured side borders on cards.
- Never use a different font family. Inter for UI, Source Serif 4 for reading body only.
- Never use a bare drop shadow without the paired inset highlight — it loses the embossed character.
- Never use a colour for an active state that doesn't reach WCAG 3:1 against the adjacent surface; pair it with size or weight.
