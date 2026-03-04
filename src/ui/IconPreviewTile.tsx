import React from "react";
import { Tooltip, UnstyledButton } from "@mantine/core";

interface IconPreviewTileProps {
  ariaLabel?: string;
  className?: string;
  clickTarget?: "tile" | "media";
  label?: React.ReactNode;
  media: React.ReactNode;
  onClick: () => void;
  style?: React.CSSProperties;
  title?: string;
  type?: "button" | "submit" | "reset";
}

export function IconPreviewTile({
  ariaLabel,
  className,
  clickTarget = "tile",
  label,
  media,
  onClick,
  style,
  title,
  type = "button",
}: IconPreviewTileProps) {
  const rootClassName = [
    "ps-icon-preview-tile",
    clickTarget === "media" ? "ps-icon-preview-tile--media-click" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (clickTarget === "media") {
    const content = (
      <div className={rootClassName} style={style}>
        <UnstyledButton
          aria-label={ariaLabel}
          className="ps-icon-preview-media ps-icon-preview-media-button"
          onClick={onClick}
          type={type}
        >
          {media}
        </UnstyledButton>
        {label ? <div className="ps-icon-preview-label">{label}</div> : null}
      </div>
    );

    if (!title) {
      return content;
    }

    return (
      <Tooltip label={title} withArrow openDelay={120}>
        {content}
      </Tooltip>
    );
  }

  const content = (
    <UnstyledButton
      aria-label={ariaLabel}
      className={rootClassName}
      onClick={onClick}
      style={style}
      type={type}
    >
      <div className="ps-icon-preview-media">{media}</div>
      {label ? <div className="ps-icon-preview-label">{label}</div> : null}
    </UnstyledButton>
  );

  if (!title) {
    return content;
  }

  return (
    <Tooltip label={title} withArrow openDelay={120}>
      {content}
    </Tooltip>
  );
}
