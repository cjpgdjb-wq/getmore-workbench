export function fmtMoney(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Math.round(value).toLocaleString("zh-CN");
}

export function fmtRoi(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toFixed(2);
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value.toFixed(digits)}%`;
}

export function fmtCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

export function fmtRatio(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "--";
  const arrow = ratio > 0 ? "↑" : ratio < 0 ? "↓" : "—";
  return `${arrow} ${Math.abs(ratio).toFixed(1)}%`;
}

export function fmtDateShort(key: string): string {
  const [, m, d] = key.split("-");
  return `${m}-${d}`;
}

export function fmtMonthDay(key: string): string {
  const [, m, d] = key.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

export function nowTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function fmtClock(ts: number): string {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minute = 60_000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/** 千分位 ID 展示（保留完整数字） */
export function fmtId(id: string): string {
  return id.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\r\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function hashColor(name: string): [string, string] {
  const palettes: [string, string][] = [
    ["#7aa9ff", "#4f6bff"],
    ["#ffb199", "#ff6a88"],
    ["#84fab0", "#41c7a0"],
    ["#c2a8ff", "#8957e5"],
    ["#ffd26f", "#ff9f43"],
    ["#89d6ff", "#2f8fe0"],
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palettes[hash % palettes.length];
}
