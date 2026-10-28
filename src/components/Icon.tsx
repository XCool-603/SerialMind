import React from "react";

/** Remixicon 图标：直接使用设计稿里的私有区码点，保证 1:1 */
export function Icon({
  cp,
  size = 13,
  color,
  style,
}: {
  cp: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <i
      className="icon"
      style={{ fontSize: size, color, ...style }}
      aria-hidden="true"
    >
      {cp}
    </i>
  );
}

/** 常用图标码点（取自 Calicat 设计数据） */
export const IC = {
  product: "\uF181", // 产品/套件
  chevronDown: "\uEA4E",
  chevronRight: "\uEA4E",
  arrowRight: "\uEA60",
  arrowLeft: "\uEA6C",
  rule: "\uED3D",
  ai: "\uF36D",
  play: "\uF00A",
  palette: "\uEFC5",
  settings: "\uF0E6",
  terminal: "\uF1F6",
  protocol: "\uECD1",
  case: "\uECEF",
  report: "\uEA98",
  link: "\uF019",
  split: "\uEE8D",
  undo: "\uEA58",
  plus: "\uEA13",
  protocolDoc: "\uF309",
  heartbeat: "\uF215",
  handshake: "\uEEB2",
  warn: "\uEA1D",
  trash: "\uEC26",
  export: "\uF437",
  manual: "\uEE75",
  useCase: "\uEF81",
  reply: "\uF07A",
  pause: "\uEFD8",
  clear: "\uEC2A",
  download: "\uEC54",
  branch: "\uF309",
  search: "\uEA5B",
  check: "\uEB7B",
  close: "\uEB99",
  copy: "\uEC7A",
  history: "\uEEB5",
  code: "\uEB0C",
  save: "\uE9CD",
  list: "\uECEF",
  warning: "\uEA1D",
  error: "\uEB96",
  edit: "\uEC39",
  more: "\uEA3B",
  eye: "\uEC36",
  refresh: "\uEB37",
} as const;
