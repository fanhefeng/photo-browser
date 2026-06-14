// 内联 SVG 图标（Lucide 风格，stroke 2，currentColor 跟随文字色）。
// 离线桌面应用，避免引入外部图标库 / 字体 CDN。

interface IconProps {
  size?: number;
  className?: string;
}

const svgProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const SearchIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const FolderIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </svg>
);

export const RescanIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

export const ArrowDownIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </svg>
);

export const ArrowUpIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </svg>
);

// 欢迎屏图形：两张错落层叠的照片，前景一张含山与太阳（图库意象）。
// 颜色走 CSS 变量（见 .glyph-* 样式），保持暗色克制、仅太阳为品牌色。
export const GalleryGlyph = ({ size = 84 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 96 96"
    fill="none"
    aria-hidden
    className="welcome__glyph"
  >
    <rect
      className="glyph-card-back"
      x="23"
      y="28"
      width="50"
      height="42"
      rx="7"
      transform="rotate(-9 48 49)"
    />
    <rect className="glyph-card-front" x="25" y="31" width="50" height="42" rx="7" />
    <circle className="glyph-sun" cx="39" cy="45" r="5" />
    <path className="glyph-hill" d="M29 65 L43 51 L52 59 L60 52 L71 65" />
  </svg>
);
