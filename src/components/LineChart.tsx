import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { cssVar } from "../lib/themes";
import { useApp } from "../lib/state";
import { compact, date, num } from "../lib/format";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
  width?: number;
  dash?: number[];
  fill?: boolean;
}

export interface CiBar {
  lo: number;
  hi: number;
  loLabel: string;
  hiLabel: string;
  color: string;
}

interface Props {
  x: number[];
  series: LineSeries[];
  dateAxis?: boolean;
  height?: number;
  ci?: CiBar | null;
  fmtY?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  marks?: { x: number; label: string; color: string }[];
  onPick?: (x: number) => void;
}

function resolve(c: string) {
  return c.startsWith("--") ? cssVar(c) || "#888" : c;
}

export function LineChart({ x, series, dateAxis, height, ci, fmtY = compact, xLabel, yLabel, marks, onPick }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const { prefs } = useApp();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const grid = cssVar("--border");
    const muted = cssVar("--muted");
    const text = cssVar("--text");
    const font = `12px ${getComputedStyle(document.body).fontFamily}`;
    const colors = series.map((s) => resolve(s.color));
    const w = el.clientWidth || 800;
    const h = height ?? (el.clientHeight || 420);
    const opts: uPlot.Options = {
      width: w,
      height: h,
      pxAlign: false,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC"),
      scales: { x: { time: !!dateAxis } },
      legend: { show: false },
      cursor: {
        drag: { x: true, y: false, setScale: true },
        points: { size: 7, fill: (_u, i) => colors[i - 1] ?? text },
      },
      padding: [18, ci ? 70 : 14, 4, 4],
      axes: [
        {
          stroke: muted,
          grid: { stroke: grid, width: 1, dash: [2, 4] },
          ticks: { show: false },
          font,
          label: xLabel,
          labelFont: font,
          labelSize: xLabel ? 22 : 0,
          values: dateAxis ? undefined : (_u, vals) => vals.map((v) => compact(v)),
        },
        {
          stroke: muted,
          grid: { stroke: grid, width: 1, dash: [2, 4] },
          ticks: { show: false },
          font,
          size: 62,
          label: yLabel,
          labelFont: font,
          labelSize: yLabel ? 20 : 0,
          values: (_u, vals) => vals.map((v) => fmtY(v)),
        },
      ],
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.label,
          stroke: colors[i],
          width: s.width ?? 1.6,
          dash: s.dash,
          fill: s.fill ? colors[i] + "22" : undefined,
          points: { show: false },
        })),
      ],
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            // ligne zéro
            const y0 = u.valToPos(0, "y", true);
            if (y0 > u.bbox.top && y0 < u.bbox.top + u.bbox.height) {
              ctx.save();
              ctx.strokeStyle = muted;
              ctx.globalAlpha = 0.55;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, y0);
              ctx.lineTo(u.bbox.left + u.bbox.width, y0);
              ctx.stroke();
              ctx.restore();
            }
            // repères (jackpots…)
            if (marks) {
              ctx.save();
              for (const m of marks) {
                const px = u.valToPos(m.x, "x", true);
                if (px < u.bbox.left || px > u.bbox.left + u.bbox.width) continue;
                ctx.strokeStyle = resolve(m.color);
                ctx.globalAlpha = 0.6;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(px, u.bbox.top);
                ctx.lineTo(px, u.bbox.top + u.bbox.height);
                ctx.stroke();
                ctx.globalAlpha = 1;
                ctx.setLineDash([]);
                ctx.fillStyle = resolve(m.color);
                ctx.font = `bold ${11 * devicePixelRatio}px sans-serif`;
                ctx.fillText(m.label, px + 4, u.bbox.top + 12 * devicePixelRatio);
              }
              ctx.restore();
            }
            // intervalle de confiance en bout de courbe
            if (ci) {
              const xr = u.bbox.left + u.bbox.width + 18 * devicePixelRatio;
              const yl = u.valToPos(ci.lo, "y", true);
              const yh = u.valToPos(ci.hi, "y", true);
              ctx.save();
              ctx.setLineDash([]);
              ctx.globalAlpha = 1;
              ctx.strokeStyle = resolve(ci.color);
              ctx.fillStyle = resolve(ci.color);
              ctx.lineWidth = 2 * devicePixelRatio;
              ctx.beginPath();
              ctx.moveTo(xr, yl);
              ctx.lineTo(xr, yh);
              ctx.moveTo(xr - 6 * devicePixelRatio, yl);
              ctx.lineTo(xr + 6 * devicePixelRatio, yl);
              ctx.moveTo(xr - 6 * devicePixelRatio, yh);
              ctx.lineTo(xr + 6 * devicePixelRatio, yh);
              ctx.stroke();
              ctx.font = `bold ${10.5 * devicePixelRatio}px sans-serif`;
              ctx.fillText(ci.hiLabel, xr + 9 * devicePixelRatio, yh + 4 * devicePixelRatio);
              ctx.fillText(ci.loLabel, xr + 9 * devicePixelRatio, yl + 4 * devicePixelRatio);
              ctx.restore();
            }
          },
        ],
        setCursor: [
          (u) => {
            const t = tip.current;
            if (!t) return;
            const idx = u.cursor.idx;
            if (idx == null || u.cursor.left == null || u.cursor.left < 0) {
              t.style.display = "none";
              return;
            }
            const xv = u.data[0][idx];
            let html = `<div class="tt-x">${dateAxis ? date(xv, true) : `${xLabel ?? ""} ${num(xv)}`}</div>`;
            series.forEach((s, i) => {
              const v = u.data[i + 1][idx];
              if (v == null) return;
              html += `<div class="tt-r"><i style="background:${colors[i]}"></i>${s.label}<b>${fmtY(v as number)}</b></div>`;
            });
            t.innerHTML = html;
            t.style.display = "block";
            const left = u.cursor.left + u.over.offsetLeft;
            const bw = el.clientWidth;
            t.style.left = `${Math.min(left + 14, bw - t.offsetWidth - 6)}px`;
            t.style.top = `${(u.cursor.top ?? 0) + u.over.offsetTop + 12}px`;
          },
        ],
      },
    };
    const data: uPlot.AlignedData = [x, ...series.map((s) => s.values)];
    const u = new uPlot(opts, data, el);
    plot.current = u;
    u.over.addEventListener("click", () => {
      const idx = u.cursor.idx;
      if (idx != null && pickRef.current) pickRef.current(u.data[0][idx]);
    });
    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth;
      const nh = height ?? el.clientHeight;
      if (nw > 0 && nh > 0 && (nw !== u.width || nh !== u.height)) u.setSize({ width: nw, height: nh });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
  }, [x, series, dateAxis, height, ci, fmtY, xLabel, yLabel, marks, prefs.theme, prefs.accent, prefs.chartColors]);

  return (
    <div className="lc" style={height ? { height } : undefined}>
      <div ref={wrap} className="lc-in" />
      <div ref={tip} className="tt" />
    </div>
  );
}
