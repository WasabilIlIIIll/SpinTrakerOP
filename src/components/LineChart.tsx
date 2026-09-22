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
}

export interface CiBar {
  lo: number;
  hi: number;
  loLabel: string;
  hiLabel: string;
  color: string;
}

export interface Note {
  kind: string;
  label: string;
  x: number;
  y: number;
  x2?: number | null;
  y2?: number | null;
  series: string;
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
  notes?: Note[];
  onPick?: (x: number) => void;
}

function resolve(c: string) {
  return c.startsWith("--") ? cssVar(c) || "#888" : c;
}

export function LineChart({ x, series, dateAxis, height, ci, fmtY = compact, xLabel, yLabel, notes, onPick }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const { prefs } = useApp();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const dpr = devicePixelRatio || 1;
    const line = cssVar("--line") || "#8882";
    const muted = cssVar("--muted");
    const text = cssVar("--text");
    const faint = cssVar("--faint");
    const family = getComputedStyle(document.body).fontFamily;
    const font = `12px ${family}`;
    const colors = series.map((s) => resolve(s.color));
    const w = el.clientWidth || 800;
    const h = height ?? (el.clientHeight || 420);
    const visibleNotes = (notes ?? []).filter((n) => series.some((s) => s.key === n.series));

    const opts: uPlot.Options = {
      width: w,
      height: h,
      pxAlign: false,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC"),
      scales: { x: { time: !!dateAxis } },
      legend: { show: false },
      cursor: { drag: { x: true, y: false, setScale: true }, points: { size: 7, fill: (_u, i) => colors[i - 1] ?? text } },
      padding: [26, 10, 2, 14],
      axes: [
        {
          stroke: muted,
          grid: { stroke: line, width: 1 },
          ticks: { show: false },
          font,
          label: xLabel,
          labelFont: `12px ${family}`,
          labelSize: xLabel ? 24 : 0,
          gap: 8,
          values: dateAxis ? undefined : (_u, vals) => vals.map((v) => num(v)),
        },
        {
          side: 1, // axe des valeurs à droite, comme sur les trackers de référence
          stroke: muted,
          grid: { stroke: line, width: 1 },
          ticks: { show: false },
          font,
          size: 74,
          gap: 8,
          label: yLabel,
          labelFont: `12px ${family}`,
          labelSize: yLabel ? 20 : 0,
          values: (_u, vals) => vals.map((v) => fmtY(v)),
        },
      ],
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.label,
          stroke: colors[i],
          width: s.width ?? 1.5,
          dash: s.dash,
          points: { show: false },
        })),
      ],
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            const L = u.bbox.left;
            const R = u.bbox.left + u.bbox.width;
            const T = u.bbox.top;
            const B = u.bbox.top + u.bbox.height;
            ctx.save();
            ctx.setLineDash([]);
            // ligne zéro
            const y0 = u.valToPos(0, "y", true);
            if (y0 > T && y0 < B) {
              ctx.strokeStyle = muted;
              ctx.globalAlpha = 0.4;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(L, y0);
              ctx.lineTo(R, y0);
              ctx.stroke();
              ctx.globalAlpha = 1;
            }
            // annotations
            if (visibleNotes.length) {
              const placed: [number, number, number, number][] = [];
              const fits = (bx: number, by: number, bw: number) =>
                !placed.some(([px, py, pw, ph]) => bx < px + pw + 6 && bx + bw + 6 > px && by < py + ph + 4 && by + 14 > py);
              ctx.font = `600 ${11.5 * dpr}px ${family}`;
              for (const n of visibleNotes) {
                const px = u.valToPos(n.x, "x", true);
                const py = u.valToPos(n.y, "y", true);
                if (px < L - 2 || px > R + 2) continue;
                const col = n.kind === "jackpot" ? resolve("--gold") : n.kind === "peak" ? resolve("--pos") : n.kind === "low" ? resolve("--neg") : text;
                // segment de swing / de période
                if (n.x2 != null && n.y2 != null) {
                  const px2 = u.valToPos(n.x2, "x", true);
                  const py2 = u.valToPos(n.y2, "y", true);
                  ctx.strokeStyle = muted;
                  ctx.globalAlpha = 0.65;
                  ctx.setLineDash([4 * dpr, 4 * dpr]);
                  ctx.lineWidth = 1 * dpr;
                  ctx.beginPath();
                  if (n.kind === "breakeven") {
                    ctx.moveTo(px2, py2);
                    ctx.lineTo(px, py2);
                    ctx.lineTo(px, py);
                  } else {
                    ctx.moveTo(px2, py2);
                    ctx.lineTo(px, py);
                  }
                  ctx.stroke();
                  ctx.setLineDash([]);
                  ctx.globalAlpha = 1;
                  ctx.fillStyle = text;
                  ctx.beginPath();
                  ctx.arc(px2, py2, 2.6 * dpr, 0, 7);
                  ctx.fill();
                }
                // point
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(px, py, 3.2 * dpr, 0, 7);
                ctx.fill();
                // libellé
                const tw = ctx.measureText(n.label).width;
                let lx = px - tw / 2;
                const above = n.kind !== "low" && n.kind !== "downswing";
                let ly = above ? py - 11 * dpr : py + 19 * dpr;
                lx = Math.min(Math.max(L + 2, lx), R - tw - 2);
                let tries = 0;
                while (!fits(lx, ly, tw) && tries < 6) {
                  ly += (above ? -1 : 1) * 15 * dpr;
                  tries++;
                }
                placed.push([lx, ly - 11 * dpr, tw, 13 * dpr]);
                ctx.fillStyle = col;
                ctx.globalAlpha = 0.95;
                ctx.fillText(n.label, lx, ly);
                ctx.globalAlpha = 1;
              }
            }
            // intervalle de confiance en bout de courbe
            if (ci) {
              const xr = R - 12 * dpr; // juste à l'intérieur du cadre : l'axe est à droite
              const yl = u.valToPos(ci.lo, "y", true);
              const yh = u.valToPos(ci.hi, "y", true);
              ctx.strokeStyle = resolve(ci.color);
              ctx.fillStyle = resolve(ci.color);
              ctx.lineWidth = 1.6 * dpr;
              ctx.beginPath();
              ctx.moveTo(xr, yl);
              ctx.lineTo(xr, yh);
              ctx.moveTo(xr - 5 * dpr, yl);
              ctx.lineTo(xr + 5 * dpr, yl);
              ctx.moveTo(xr - 5 * dpr, yh);
              ctx.lineTo(xr + 5 * dpr, yh);
              ctx.stroke();
              ctx.font = `600 ${10.5 * dpr}px ${family}`;
              ctx.textAlign = "right";
              ctx.fillText(ci.hiLabel, xr - 8 * dpr, yh + 4 * dpr);
              ctx.fillText(ci.loLabel, xr - 8 * dpr, yl + 4 * dpr);
              ctx.textAlign = "left";
            }
            ctx.restore();
            void faint;
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
            t.style.left = `${Math.min(left + 16, el.clientWidth - t.offsetWidth - 6)}px`;
            t.style.top = `${(u.cursor.top ?? 0) + u.over.offsetTop + 14}px`;
          },
        ],
      },
    };
    const data: uPlot.AlignedData = [x, ...series.map((s) => s.values)];
    const u = new uPlot(opts, data, el);
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
    };
  }, [x, series, dateAxis, height, ci, fmtY, xLabel, yLabel, notes, prefs.theme, prefs.accent, prefs.chartColors]);

  return (
    <div className="lc" style={height ? { height } : undefined}>
      <div ref={wrap} className="lc-in" />
      <div ref={tip} className="tt" />
    </div>
  );
}
