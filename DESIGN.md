---
version: 1.0
name: edgetunnel-ipfilter design system
description: "Design system for every user-visible surface of edgetunnel-ipfilter (admin console, login, /ips-ui, /socks5-ui, /convert). Dark-first developer-tool aesthetic: a near-black cool canvas, a four-step surface ladder with hairline borders instead of shadows, Inter for UI text, JetBrains Mono for data, and the project teal→blue as the single accent family. The system architecture (surface ladder, hairline depth, scarce accent, compact density) is adapted from the Linear analysis in VoltAgent/awesome-design-md (MIT); every token value, the accent hue, and the brand rules are this project's own."

colors:
  primary: "#14b8a6"
  primary-hover: "#2dd4bf"
  primary-deep: "#2563eb"
  on-primary: "#ffffff"
  ink: "#eef6f5"
  ink-muted: "#c3d2d0"
  ink-subtle: "#8b9d9a"
  ink-tertiary: "#5f716e"
  canvas: "#060809"
  surface-1: "#0c1113"
  surface-2: "#11181b"
  surface-3: "#162024"
  surface-4: "#1b272c"
  hairline: "#1f2a2f"
  hairline-strong: "#31424a"
  semantic-success: "#22c55e"
  semantic-danger: "#ef4444"
  semantic-warning: "#f59e0b"
  inverse-canvas: "#ffffff"
  inverse-ink: "#0a0f10"

typography:
  display:
    fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.6px
  headline:
    fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.4px
  card-title:
    fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: -0.2px
  body:
    fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body-sm:
    fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  caption:
    fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  button:
    fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px

components:
  button-primary:
    backgroundColor: "linear-gradient(135deg, {colors.primary}, {colors.primary-deep})"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 24px
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 12px
  chip-selected:
    backgroundColor: "rgba(20, 184, 166, 0.16)"
    textColor: "{colors.primary-hover}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 12px
  status-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 8px
---

## Overview

edgetunnel-ipfilter is a self-hosted network tool. Its users open the admin console to get something done — check nodes, fix a config, copy a link — so the design serves density and clarity, not decoration. The system is **dark-first**: a near-black canvas with a faint cool (teal-leaning) tint, content lifted on a four-step surface ladder, hierarchy carried by 1px hairline borders rather than shadows.

The single accent family is the project brand: **teal `#14b8a6` → blue `#2563eb`**. Teal is the working accent (focus rings, selected states, links, live indicators). The full gradient is scarce by rule — it appears only on the brand mark and on the one primary call-to-action in a view. No other chromatic colors exist outside the three semantic states (success / warning / danger), which are reserved for node health and operation results.

Type is **Inter** end-to-end (the documented open substitute for the reference system's proprietary sans), with CJK falling back to PingFang / Microsoft YaHei. **JetBrains Mono** is mandatory for data: IP addresses, ports, latencies, subscription URLs, tokens, and code. If a number or address is set in the UI font, that is a defect.

Surfaces covered by this spec: the admin console, the login page, `/ips-ui` (region IP filter), `/socks5-ui` (proxy checker), and `/convert` (subscription conversion). Any UI injected into a host page (integration cards, panels) must be built from these tokens and be visually indistinguishable from UI built natively with them.

## Colors

### Brand & Accent

- **Teal** (`primary`): working accent — primary actions, focus rings, selected chips, live dots.
- **Teal Hover** (`primary-hover`): hover state of teal elements; text on teal-tinted fills.
- **Deep Blue** (`primary-deep`): the far end of the brand gradient; never used as a flat fill on its own.
- **Brand gradient**: `linear-gradient(135deg, #14b8a6, #2563eb)` — brand mark and the single primary CTA per view only.

### Surfaces

- **Canvas** (`canvas`): page background, #060809 — near-black with a cool tint, never pure `#000`.
- **Surface 1–4**: the ladder. Cards sit on surface-1; nested or hovered areas step up one level; menus and popovers use surface-3/4.
- **Hairline / Hairline Strong**: 1px borders. Cards and dividers use hairline; inputs and emphasized edges use hairline-strong.

### Text

- **Ink** for headings and primary content; **Ink Muted** for secondary content; **Ink Subtle** for metadata and labels; **Ink Tertiary** for disabled and footnote text.

### Semantic

- **Success** `#22c55e` — node alive, operation succeeded. **Danger** `#ef4444` — node dead, errors, destructive actions. **Warning** `#f59e0b` — degraded, attention needed. Semantic colors never decorate; they only report state.

## Typography

One voice from display to caption: weight 600 headings with slight negative tracking, weight 400 body, weight 500 buttons. Body text is 14px (this is a dense tool, not a marketing page); nothing goes below 12px. Mono at 13px for all data. Chinese text follows the same scale — do not shrink CJK to fit.

## Layout

- 4px base unit; spacing tokens from 4 to 48px. Card padding 24px (16px on narrow screens).
- The admin console is self-built (2.2): a 236px left rail (brand block, section nav, version + theme + logout) beside the content column, max width 1460px. Tool pages (`/ips-ui`, `/socks5-ui`, `/convert`) use workbench layouts up to 1400px wide, each with its own skeleton (see Page Patterns); below 920px every layout collapses to a single column.
- Sections separate by surface lift and hairlines, not by large empty gaps. Vertical rhythm inside a card: 16px between blocks.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 | No shadow, no border | Body text, page canvas |
| 1 | Surface-1 fill + 1px hairline | Cards, panels |
| 2 | Surface-2 fill + 1px hairline-strong | Hovered cards, featured blocks |
| 3 | Surface-3 fill + soft shadow | Dropdowns, popovers |
| 4 | Surface-3 fill + stronger shadow + scrim | Modals, dialogs |

Shadows exist only at levels 3–4. On the dark canvas, a shadow without a surface lift is invisible — always pair them.

## Shapes

Radius scale: 4px chips and badges, 6px inline tags, **8px buttons and inputs**, **12px cards**, 16px large panels and dialogs, pill only for chips, toggles, and status badges. Buttons are never pill-shaped; cards are never square.

## Components

### Buttons

- **Primary**: brand gradient fill, white text, 8px radius, padding 8px 16px. At most one per view — it is the view's main action (save, generate, check).
- **Secondary**: surface-1 fill, 1px hairline-strong border, ink text. The default for all other actions.
- **Danger**: transparent fill, danger text, hairline border in a danger tint. Destructive actions only, always paired with a confirmation.
- Hover lifts the fill one surface step (or lightens the gradient); focus shows a 2px teal ring at 40% opacity. Disabled: ink-tertiary text, no pointer events.

### Inputs

Surface-1 fill, 1px hairline-strong border, 8px radius, padding 8px 12px. Focus: teal border + the focus ring. Labels are body-sm ink-subtle above the field, 4px gap. Helper and error text is caption-sized below; errors in danger color. Long values (URLs, tokens, node lists) go in mono.

### Cards & Panels

Surface-1, 1px hairline, 12px radius (16px for standalone tool panels), padding 24px. A card has one title (card-title) and one job. Card headers never use filled color bands — the title is ink text with a small (28px) gradient icon chip when an icon is needed.

### Chips

Pill, surface-2 fill, ink-muted text; selected state is a teal tint fill `rgba(20,184,166,.16)` with primary-hover text and a teal hairline. Used for region pickers and option toggles.

### Tables & Lists

No zebra striping. Rows separate with 1px hairline dividers, 8px vertical padding, mono for data columns. Status is a dot (8px, semantic color) + caption text, never a filled row. Row hover steps the fill to surface-2.

### Status & Feedback

Every operation reports in place: inline result areas over toast popups. Loading states keep the control's size and show a spinner or a progress label — layouts never jump.

### Badges & Brand Mark

The 🌏 badge and wordmark `edgetunnel-ipfilter` carry the brand gradient. The fixed corner badge on the admin/login pages keeps its gradient fill (it is the brand mark, which the gradient rule explicitly allows).

## Page Patterns

- **Admin console** (self-built since 2.2; no upstream page is proxied or re-skinned anymore): left-rail layout on the dotted canvas. Seven sections — Overview (stat cards + service info), Subscription (links masked by default with show/copy), Region Filter (chip editor writing the `ipf://` entry), Tools, Settings (schema-driven form over the full config), Advanced (raw config.json + ADD.txt editors), Logs (token-redacted table). Section titles carry a teal left bar; panels are flat surface-1 with hairline borders.
- **Login**: split wall — a deep-teal gradient brand wall (globe mark, wordmark, tagline) on the left, a flat login card on the dotted canvas on the right. The card also carries the project's contact links (repo + channel). On narrow screens the wall stacks above the card.
- **Tool pages**: each has its own workbench skeleton, deliberately unlike the others and unlike any upstream layout. `/ips-ui`: two panes — a 380px region rail (regions as a scrollable two-column row list) beside the results pane. `/socks5-ui`: ambient layers removed; slim header, a three-across status strip (former side column) above a single-column workspace. `/convert`: two columns — the main form on the left, the short-link restore card as a right rail.
- **Light mode**: the console ships its own light mapping of the same tokens (canvas #f4f7f7, white surfaces), persisted per browser; the login page follows `prefers-color-scheme`. Dark remains the canonical, fully-specified theme; a light surface must never invert the accent or the semantic colors.

## Do's and Don'ts

### Do

- Build every new element from the tokens above; if a value is not in the scale, extend the scale here first.
- Keep the accent scarce: teal for state and action, gradient for brand + one CTA.
- Set all data (IPs, ports, latency, URLs, tokens) in JetBrains Mono.
- Separate with hairlines and surface lifts; keep density comfortable at 14px body.
- Report state with the semantic colors and a text label, not color alone.

### Don't

- Don't introduce a second accent hue or decorative gradients on surfaces and cards.
- Don't use shadows to fake hierarchy on flat content (levels 0–2 have none).
- Don't pill-round buttons, and don't square-round cards below 12px.
- Don't set pure black `#000000` or pure gray neutrals; surfaces always carry the cool tint.
- Don't imitate another product's recognizable identity (wordmarks, logos, signature illustrations). This system borrows a *structure* — ladder, hairlines, density — never a brand's face.
- Don't ship a page whose injected elements look different from its native ones.

## Responsive Behavior

| Breakpoint | Change |
|---|---|
| ≥1024px | Full density; cards may sit 2-up where the host layout allows |
| 768–1023px | Single column; card padding 16px |
| <768px | Single column; buttons and inputs ≥40px tall; tables scroll horizontally inside their card |

Touch targets are at least 40px tall on coarse pointers. Nothing essential is hover-only.

## Iteration Guide

1. Name the surface level before styling an element; most mistakes are level mistakes.
2. When in doubt between accent and neutral, choose neutral — the accent stays scarce.
3. New components are added to this file first, then implemented. This file is the contract; pages follow it, not the other way round.
