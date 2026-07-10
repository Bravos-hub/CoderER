# CodeER Logo and Icon Guidelines

## Approved concept

The CodeER symbol is a geometric letter **C** forming a protective enclosure. A pulse line passes through the center and ends in a code cursor.

## Symbol meaning

- **C** — CodeER and the codebase under care
- **Protective enclosure** — controlled, isolated recovery
- **Pulse line** — active diagnosis and repository health
- **Code cursor** — executable engineering action
- **Open right edge** — movement from incident to recovery
- **Emergency red-orange** — urgency without panic

## Wordmark

The wordmark is written as:

```text
CodeER
```

Styling:

- `Code` uses neutral white on dark backgrounds or near-black on light backgrounds.
- `ER` uses the emergency red-orange brand color.
- The visual distinction between `Code` and `ER` must remain obvious.
- The name should be spoken as **Code E-R**.

## Optional descriptor

```text
AI SOFTWARE EMERGENCY RESPONSE
```

The descriptor is used only in large-format applications. It must be removed from favicons, app icons, repository avatars, and compact navigation lockups.

## Required lockups

### Primary horizontal lockup

```text
[Icon] CodeER
       AI SOFTWARE EMERGENCY RESPONSE
```

Recommended use:

- Landing page header
- Presentation cover
- Devpost gallery cover
- README banner
- Demo-video title card

### Compact horizontal lockup

```text
[Icon] CodeER
```

Recommended use:

- Product navigation
- Authentication screens
- Documentation
- Social banners

### Icon-only lockup

Recommended use:

- Browser favicon
- GitHub repository avatar
- Sidebar
- Loading indicator
- Desktop or mobile shortcut

### Monochrome lockup

A single-color version is required for documentation, watermarks, print, and constrained environments.

## Minimum-size behavior

At 16x16 and 32x32:

- Remove the descriptor.
- Remove glow, blur, and shadows.
- Use one clearly defined pulse peak.
- Use thicker geometry.
- Preserve the opening of the C.
- Keep the code cursor visible.
- Avoid small internal gaps.

## Required export sizes

- 16x16 favicon
- 32x32 sidebar and favicon
- 64x64 application navigation
- 256x256 app icon
- 512x512 Devpost and GitHub avatar
- 1024x1024 high-resolution asset
- 2048px horizontal wordmark

## Recommended asset structure

```text
brand/
├── logo/
│   ├── svg/
│   │   ├── codeer-primary-dark.svg
│   │   ├── codeer-primary-light.svg
│   │   ├── codeer-compact-dark.svg
│   │   ├── codeer-compact-light.svg
│   │   ├── codeer-icon.svg
│   │   └── codeer-monochrome.svg
│   ├── png/
│   │   ├── codeer-wordmark-2048.png
│   │   ├── codeer-wordmark-1024.png
│   │   ├── codeer-devpost-512.png
│   │   ├── codeer-github-512.png
│   │   ├── codeer-app-256.png
│   │   ├── codeer-sidebar-64.png
│   │   ├── codeer-sidebar-32.png
│   │   └── codeer-favicon-16.png
│   └── favicon/
│       ├── favicon.ico
│       ├── favicon-16x16.png
│       ├── favicon-32x32.png
│       ├── apple-touch-icon.png
│       └── site.webmanifest
```

## Clear-space rule

Maintain clear space around the logo equal to at least half the height of the icon. No text, border, image edge, or interface control should enter this area.

## Background rules

- Use the primary light logo on dark navy backgrounds.
- Use the dark wordmark on white or very light backgrounds.
- Use the monochrome version where contrast is limited.
- Do not place the logo on visually noisy imagery without a solid contrast panel.

## Prohibited treatments

Do not:

- Stretch or rotate the mark
- Change the pulse line shape between screens
- Use pure bright red across the whole icon
- Add heavy 3D bevels
- Place the descriptor under 120px wide
- Use gradients that reduce small-size clarity
- Replace the code cursor with a medical cross
- Recolor `Code` and `ER` inconsistently

## Acceptance test

The final symbol must remain recognizable at:

```text
512x512
64x64
32x32
16x16
```

The icon passes only when the protective C, pulse line, and code cursor remain visually identifiable at every size.
