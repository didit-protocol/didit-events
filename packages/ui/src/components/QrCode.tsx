import qrcode from "qrcode-generator";

export interface QrCodeProps {
  value: string;
  /** Rendered size in CSS px (square). */
  size?: number;
  /** Error correction level; M by default. */
  level?: "L" | "M" | "Q" | "H";
  /** Accessible name; omit when the URL is also shown as text next to it. */
  label?: string;
  /** Module colour; the background is transparent (put the code on a light tile). */
  color?: string;
  className?: string;
}

/** Dark-module path of a QR code, one `h1v1h-1z` square per module, on an n×n grid (no quiet zone). */
export function qrPath(value: string, level: QrCodeProps["level"] = "M"): { d: string; modules: number } {
  const qr = qrcode(0, level);
  qr.addData(value, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  return { d, modules: n };
}

/** QR code as inline SVG, rendered on the server (no client JS). */
export function QrCode({ value, size = 160, level = "M", label, color = "#1A1A1A", className }: QrCodeProps) {
  const { d, modules } = qrPath(value, level);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={d} fill={color} />
    </svg>
  );
}
