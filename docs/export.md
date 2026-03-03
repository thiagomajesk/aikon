# Export Guide

This page explains how icon export works in Aikon.

## Where to Export

1. Open an icon in the editor.
2. In the preview panel, click the export icon button.
3. Choose file name, format, and size.
4. Click **Export**.

If no icon is selected, the export action is hidden.

## Formats

### Static formats

- `SVG`
- `PNG`
- `JPEG`

These formats export a single frame.

### Animated formats

- `WebP`
- `GIF`
- `WebM`
- `MP4`

These formats can include animation when animation is configured.

## Size Presets

- `256 x 256 (small)`
- `384 x 384 (medium)`
- `512 x 512 (original)`

## Quality and FPS

- `Quality` appears for WebP export.
- `Animation FPS` appears for animated formats when the icon has animations.

## Warnings and Progress

- If the icon has animations and you pick a static format, Aikon warns that animations will be ignored.
- During export, the button shows a spinner and percentage progress.

## File Size Preview

- Aikon shows an estimated output size when preview is available.
- For some formats (for example WebP), size preview may be unavailable.

## Notes

- GIF uses a limited color palette, so gradients can look less smooth than PNG/WebP.
- For best quality gradients and animation, prefer WebP, WebM, or MP4.
