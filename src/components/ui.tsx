import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { fmtCompact, fmtMoney } from "../lib/format";

/* ------------------------------------------------------------------ */
/* Sparkline                                                          */
/* ------------------------------------------------------------------ */

export function Sparkline({
  values,
  color = "#2b6bff",
  width = 84,
  height = 24,
  fill = true,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  if (!values.length) return <svg width={width} height={height} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 1.5;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={areaPath} fill={`url(#spark-${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Trend chart with hover                                             */
/* ------------------------------------------------------------------ */

function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
}

export interface TrendSeries {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
  area?: boolean;
}

export function TrendChart({
  labels,
  series,
  height = 190,
  format = (v: number) => fmtMoney(v),
  axisFormat = (v: number) => fmtCompact(v),
  yTicks = 4,
}: {
  labels: string[];
  series: TrendSeries[];
  height?: number;
  format?: (value: number) => string;
  axisFormat?: (value: number) => string;
  yTicks?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gradientId = useId().replace(/:/g, "");

  const width = 640;
  const padding = { top: 14, right: 14, bottom: 24, left: 52 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const allValues = series.flatMap((item) => item.values);
  const maxValue = Math.max(...allValues, 1) * 1.1;
  const count = labels.length;
  const xFor = (index: number) => padding.left + (count <= 1 ? innerW / 2 : (index / (count - 1)) * innerW);
  const yFor = (value: number) => padding.top + innerH - (value / maxValue) * innerH;

  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (maxValue / yTicks) * i);

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const svgX = ratio * width;
    const innerRatio = (svgX - padding.left) / innerW;
    const index = Math.round(innerRatio * (count - 1));
    setHover(index < 0 || index >= count ? null : index);
  };

  const hoverX = hover !== null ? xFor(hover) : null;

  return (
    <div className="trend-chart" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="趋势图"
      >
        <defs>
          {series.map((item, index) => (
            <linearGradient key={item.name} id={`trend-${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.16" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              stroke="#eef0f4"
              strokeWidth="1"
            />
            <text x={padding.left - 8} y={yFor(tick) + 3.5} textAnchor="end" fontSize="9.5" fill="#a9aeb8">
              {axisFormat(tick)}
            </text>
          </g>
        ))}
        {labels.map((label, index) => {
          if (count > 10 && index % Math.ceil(count / 7) !== 0 && index !== count - 1) return null;
          return (
            <text key={label} x={xFor(index)} y={height - 6} textAnchor="middle" fontSize="9.5" fill="#a9aeb8">
              {label}
            </text>
          );
        })}
        {series.map((item, index) => {
          const points = item.values.map((value, i) => [xFor(i), yFor(value)] as [number, number]);
          const path = smoothPath(points);
          return (
            <g key={item.name}>
              {item.area && (
                <path
                  d={`${path} L${xFor(count - 1)},${padding.top + innerH} L${xFor(0)},${padding.top + innerH} Z`}
                  fill={`url(#trend-${gradientId}-${index})`}
                />
              )}
              <path
                d={path}
                fill="none"
                stroke={item.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={item.dashed ? "4 4" : undefined}
              />
            </g>
          );
        })}
        {hoverX !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding.top}
            y2={padding.top + innerH}
            stroke="#c9d3e3"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {hover !== null &&
          series.map((item) => (
            <circle
              key={item.name}
              cx={xFor(hover)}
              cy={yFor(item.values[hover] ?? 0)}
              r="3"
              fill="#fff"
              stroke={item.color}
              strokeWidth="2"
            />
          ))}
      </svg>
      {hover !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(xFor(hover) / width) * 100}%`,
            top: 4,
          }}
        >
          <div className="chart-tooltip-date">{labels[hover]}</div>
          {series.map((item) => (
            <div className="chart-tooltip-row" key={item.name}>
              <i style={{ background: item.color }} />
              <span>{item.name}</span>
              <b>{format(item.values[hover] ?? 0)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal / Drawer                                                     */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  onBack,
  title,
  desc,
  width = 640,
  className = "",
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  title: ReactNode;
  desc?: ReactNode;
  width?: number;
  className?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${className}`} style={{ width: className ? undefined : width }} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-heading">
            {onBack && (
              <button type="button" className="modal-back" onClick={onBack}>
                <ArrowLeft size={14} /> 返回
              </button>
            )}
            <div>
              <div className="modal-title">{title}</div>
              {desc && <div className="modal-desc">{desc}</div>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  sub,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className={`drawer ${className}`} role="dialog" aria-modal="true">
        <div className="drawer-header">
          <div>
            <div className="drawer-title">{title}</div>
            {sub && <div className="drawer-sub">{sub}</div>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Checkbox / Switch / Badge                                          */
/* ------------------------------------------------------------------ */

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      className={`check ${checked || indeterminate ? "is-checked" : ""} ${indeterminate && !checked ? "is-indeterminate" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      {indeterminate && !checked ? (
        <svg viewBox="0 0 10 10" fill="none">
          <path d="M2 5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        checked && (
          <svg viewBox="0 0 10 10" fill="none">
            <path d="M1.8 5.2 4 7.4l4.2-4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      )}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`switch ${checked ? "is-on" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    />
  );
}

export type StatusTone = "green" | "gray" | "orange" | "red" | "blue";

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, StatusTone> = {
    投放中: "green",
    已暂停: "gray",
    审核中: "orange",
    余额不足: "red",
    已结束: "gray",
    审核未通过: "red",
    草稿: "gray",
  };
  const cls = tone[status] ?? "gray";
  return (
    <span className={`badge badge-${cls}`}>
      <i className={`status-dot ${status === "投放中" ? "online" : status === "审核中" ? "checking" : "offline"}`} style={{ width: 5, height: 5 }} />
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Select                                                             */
/* ------------------------------------------------------------------ */

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export function Select({
  value,
  options,
  onChange,
  width,
  className = "",
  ariaLabel,
  variant = "default",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  width?: number;
  className?: string;
  ariaLabel?: string;
  variant?: "default" | "bare";
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <div className={`pos-rel ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        className={`select-trigger ${variant === "bare" ? "select-bare" : ""} ${open ? "is-open" : ""}`}
        style={width ? { width } : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{current?.label ?? value}</span>
        <svg className="chev" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 3.8 5 6.8l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="click-catcher" onClick={() => setOpen(false)} />
          <div className="popover select-popover" style={width ? { width } : undefined}>
            {options.map((option) => (
              <button
                key={option.value}
                className={`menu-item ${option.value === value ? "is-active" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={14} className="check-mark" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                              */
/* ------------------------------------------------------------------ */

type ToastTone = "info" | "success" | "warn";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    counter.current += 1;
    const id = counter.current;
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 2600);
  }, []);
  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite">
          {items.map((item) => (
            <div key={item.id} className={`toast ${item.tone}`}>
              <span className="toast-icon">
                {item.tone === "success" ? <Check size={15} /> : item.tone === "warn" ? <TriangleAlert size={15} /> : <Info size={15} />}
              </span>
              {item.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                    */
/* ------------------------------------------------------------------ */

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="spin" aria-hidden="true" style={{ animation: "spin 0.9s linear infinite" }} />;
}

export function Tag({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "blue" | "green" | "orange" | "violet" | "red" }) {
  return <span className={`tag ${tone === "blue" ? "tag-blue" : tone === "gray" ? "" : `tag-${tone}`}`}>{children}</span>;
}
