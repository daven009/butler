# Butler.ai Tour Planner Design System

## 1. Visual Theme & Atmosphere

Butler.ai Tour Planner feels like a focused mobile command center for Singapore property agents. The interface mixes warm editorial typography with crisp operational UI, creating a product that is both polished and highly practical. It should feel premium without drifting into luxury-for-luxury's-sake: every visual decision needs to support trust, speed, and clarity during a busy coordination workflow.

The visual personality comes from a contrast between two worlds. The first is the **agent-facing workspace**: soft warm backgrounds, clean white cards, fast feedback states, and compact data. The second is the **iOS presentation shell**: a highly realistic device frame with dynamic island, system status bar, and subtle liquid-glass treatments. Together, they make the product feel like a believable, near-production mobile app rather than a loose concept board.

Key characteristics:
- Warm off-white page stage around a centered iPhone frame
- White card surfaces with restrained borders and soft shadows
- Playfair Display headlines paired with Inter for UI and body copy
- Bright semantic accents to communicate progress, risk, and action
- Realistic iOS chrome that gives every screen a premium native context
- Dense but breathable layouts optimized for operational decision-making
- Conversational, modern, human-centered product tone

## 2. Color Palette & Roles

### Primary Brand and Semantic Colors
- **Rausch Red** (`#FF385C`): primary action, active state, alerts, brand highlight
- **Babu Green** (`#00A699`): confirmed states, progress, positive system status
- **Hack Orange** (`#FC642D`): listing/tour type accent, energetic highlight
- **Beach Yellow** (`#FFB400`): planning state, caution, pending attention
- **Arches Plum** (`#914669`): secondary accent for differentiated tour types

### Text and Neutral Scale
- **Ink** (`#222222`): primary text, dark buttons, strong contrast moments
- **Gray** (`#717171`): secondary text, descriptions, metadata
- **Gray 2** (`#B0B0B0`): tertiary text and low-emphasis labeling
- **Border** (`#EBEBEB`): dividers, outlines, separators

### Surfaces
- **App Background** (`#F7F7F7`): interior screen background for utility-heavy views
- **Card White** (`#FFFFFF`): primary surface for content blocks and cards
- **Stage Background** (`#F5F3EF`): outside-the-device presentation canvas

### Semantic Usage Rules
- Use **Rausch Red** for the main CTA, active tab, notification badge, and urgent attention moments
- Use **Babu Green** for confirmed progress, successful updates, and safe resolution states
- Use **Beach Yellow** only for cautionary or waiting states, never as the main accent
- Keep most large surfaces neutral so operational color remains meaningful
- Avoid introducing extra decorative colors outside this system

## 3. Typography Rules

### Font Stack
- **Primary UI font**: `Inter`, weights `400`, `500`, `600`, `700`
- **Display font**: `Playfair Display`, weights `500`, `600`, `700`
- **System/iOS font**: `-apple-system`, `system-ui`, and SF-style fallback usage for device chrome

### Hierarchy

| Role | Font | Size | Weight | Notes |
|------|------|------|--------|-------|
| App hero heading | Playfair Display | 30px | 600 | Home and top-level screen titles |
| Large screen title | Playfair Display | 24–28px | 600 | Onboarding and itinerary headers |
| Card title | Inter / Playfair Display | 17–22px | 600 | High-importance content blocks |
| Standard UI heading | Inter | 14–16px | 600 | Section labels and action rows |
| Body copy | Inter | 13–14px | 400–500 | Descriptions, helper text, chat |
| Metadata | Inter | 10.5–12px | 500–700 | Labels, timestamps, microcopy |
| iOS nav title | System | 34px | 700 | Used only in native-frame contexts |

### Principles
- Use **Playfair Display** when the screen needs emotional presence or a high-level narrative anchor
- Use **Inter** for all operational text, controls, and dense information display
- Keep letter-spacing slightly tight on display titles for an editorial feel
- Keep metadata compact but readable; the UI frequently displays progress, time, and agent context together
- Use uppercase micro-labels sparingly for system states such as `AI WORKING`, `READY`, or section headers

## 4. Component Stylings

### iOS Device Frame
- Device size: approximately `390 × 844`
- Outer radius: `48px`
- Dynamic island: `126 × 37`, black, centered at the top
- Home indicator: `139 × 5` rounded bar at bottom
- Device shadow: `0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.12)`

### Glass and Native Chrome
- Liquid-glass pill uses `backdrop-filter: blur(12px) saturate(180%)`
- Light and dark variants adjust border and inset highlights subtly
- Native-feeling status bar and optional top navigation reinforce platform realism

### Buttons
- **Primary button**: dark ink background, white text, `12px` radius, medium/semibold label
- **Accent button**: Rausch Red background for forward action like sending or searching
- **Outline button**: white fill, thin border, dark text
- **Icon button**: `40 × 40`, circular, white background, `1px` border

### Cards and Containers
- Standard card radius: `16px–18px`
- Standard border: `1px solid #EBEBEB`
- Standard shadow: soft and restrained, usually `0 2px 12px rgba(0,0,0,0.04)`
- Interior padding is generous enough to separate metadata from primary content

### Utility Components
- **Avatar**: circular fill, white text, strong color identity
- **Chip**: pill with `999px` radius and semantic tone variants
- **Status dot**: `8px` circular indicator with soft outer glow
- **Bottom tabs**: four fixed items, white background, red active state
- **Chat bubbles**: `18px` radius with asymmetric bottom corner treatment
- **Toggle switch**: `40 × 24`, rounded track with sliding white thumb
- **Progress bars**: segmented with rounded rectangles and semantic colors

## 5. Layout Principles

### Overall Structure
The product should always read as a **single-phone experience** presented on a centered stage. Inside the device, layouts are vertical, scroll-based, and optimized for one-thumb use. Most screens follow a clear sequence:
1. top context / title area
2. primary action or summary block
3. main content list
4. persistent bottom navigation when relevant

### Spacing System
- Core spacing rhythm: `4px`, `6px`, `8px`, `10px`, `12px`, `14px`, `16px`, `18px`, `20px`, `24px`
- Dense information views should use tighter internal spacing while preserving visual separation between cards
- Long scroll screens should rely on stacked white cards on a neutral background

### Layout Behaviors
- Keep headers visually light and quick to parse
- Use cards to cluster meaningfully related operational information
- Let content scan vertically in priority order; avoid side-by-side complexity inside the phone viewport
- Reserve the bottom-most strong CTA for milestone actions like previewing or sending an itinerary

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Level 0 | Flat / neutral background | Base page and low-emphasis sections |
| Level 1 | `1px` border + soft shadow | Cards, search surfaces, highlighted containers |
| Level 2 | Stronger emphasis via color or contrast | Primary CTA and urgent decision moments |
| Level 3 | Device shell shadow | Whole phone presentation on the outer stage |

Depth should remain subtle. This is not a skeuomorphic business dashboard. The strongest sense of elevation comes from the **phone shell itself**, while internal app surfaces stay soft and disciplined. Shadows should support separation, not decoration.

## 7. Do's and Don'ts

### Do
- Use the warm editorial contrast of **Playfair Display + Inter** consistently
- Keep operational states obvious with a small, intentional semantic palette
- Let white cards sit on soft gray backgrounds for hierarchy
- Preserve the realistic iOS frame proportions and chrome details
- Use red sparingly but confidently for the most important interactive moments
- Keep dense information readable with clear spacing and strong alignment
- Design for an agent who is moving quickly between summaries, messages, and decisions

### Don't
- Don't flood the UI with too many saturated colors at once
- Don't turn every component into a heavy shadowed object
- Don't use playful illustration styles that conflict with the operational tone
- Don't replace editorial headings with generic sans-serif everywhere
- Don't hide important status changes behind low-contrast styling
- Don't overcomplicate layouts with multi-column structures inside the phone viewport
- Don't make the design feel like a generic CRM; it should feel distinctly mobile and premium

## 8. Responsive Behavior

### Primary Responsive Model
The core experience is intentionally framed as a mobile app. The most important responsive behavior is not about redesigning the internal app for many breakpoints; it is about **preserving the centered phone presentation cleanly across desktop and smaller browser widths**.

### Expected Behavior
- On larger screens, keep the phone centered with generous surrounding whitespace
- On smaller screens, scale the phone stage slightly so the full device remains visible
- Preserve touch-sized targets inside the device regardless of browser width
- Keep bottom tabs, icon buttons, and key CTAs comfortably tappable
- Maintain internal scroll behavior within the device frame

### Internal Screen Responsiveness
- Text blocks may wrap more naturally on narrow browser widths, but screen proportions should stay phone-first
- Cards and lists should remain single-column
- The bottom tab bar should always stay anchored to the bottom edge of the app viewport within the device
- Avoid breakpoint-driven redesigns that break the illusion of a native mobile shell

## 9. Agent Prompt Guide

### Quick Reference
- Use a **warm off-white outer canvas** with a **single centered iPhone frame**
- Inside the app, prefer **white cards on soft gray backgrounds**
- Headlines: **Playfair Display**, usually `24–30px`, weight `600`
- Body/UI: **Inter**, usually `13–16px`
- Primary accent: **Rausch Red** `#FF385C`
- Positive state: **Babu Green** `#00A699`
- Primary text: **Ink** `#222222`
- Border: `#EBEBEB`
- Card radius: `16px–18px`
- Device radius: `48px`

### Example Component Prompts
- "Create an agent dashboard screen inside a realistic iPhone frame. Use a warm off-white outer background, white cards, Playfair Display for the main title, and Inter for UI labels."
- "Design a scheduling conflict card with a white background, 18px radius, thin gray border, red eyebrow label, and one high-contrast primary action button."
- "Build a bottom tab bar with four items, white background, thin top border, gray inactive icons, and Rausch Red active state."
- "Create a buyer preview page with editorial heading, compact summary stats, and a stacked list of homes on rounded white cards."
- "Design a chat thread where AI messages are dark bubbles, contact replies are white bordered bubbles, and timestamps are small muted gray labels."

### Iteration Guide
1. Start from the phone frame and outer stage first
2. Establish typography contrast with Playfair Display + Inter
3. Add white cards and neutral backgrounds before introducing accent color
4. Use semantic colors only where they communicate state or action
5. Keep spacing calm and legible for fast operational scanning
6. Finish with iOS-native details, micro-labels, and interaction polish
