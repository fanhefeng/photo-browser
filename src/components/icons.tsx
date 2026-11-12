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

export const LibraryIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
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

export const CloseIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

/** 适应窗口（四角框 + 居中矩形："收进框内"，与全屏的对角箭头区分） */
export const FitIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <rect x="8" y="9" width="8" height="6" rx="1" />
  </svg>
);

/** 进入全屏（对角向外展开，Lucide maximize-2） */
export const ExpandIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="m21 3-7 7" />
    <path d="M15 3h6v6" />
    <path d="m3 21 7-7" />
    <path d="M9 21H3v-6" />
  </svg>
);

/** 退出全屏（对角向内收拢，Lucide minimize-2） */
export const ShrinkIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="m14 10 7-7" />
    <path d="M20 10h-6V4" />
    <path d="m3 21 7-7" />
    <path d="M4 14h6v6" />
  </svg>
);

export const InfoIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

/** 设置齿轮（Lucide settings） */
export const GearIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const TrashIcon = ({ size = 15, className }: IconProps) => (
  <svg {...svgProps(size)} className={className}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);
