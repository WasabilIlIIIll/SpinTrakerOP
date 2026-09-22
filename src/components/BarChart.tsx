import { useEffect, useRef, useState } from "react";
import { num } from "../lib/format";

export interface BarGroup {
  label: string;
  color: string;
  values: number[];
  ci?: number[];
}

interface Props {
  categories: string[];
  groups: BarGroup[];
  height?: number;
  fmt?: (v: number) => string;
  sub?: string[];
  onPick?: (i: number) => void;
}

function niceStep(range: number) {
  const raw = range / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

export function BarChart({ categories, groups, height = 300, fmt = (v) => num(v, Math.abs(v) < 10 ? 1 : 0), sub, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  let lo = 0;
  let hi = 0;
  for (const g of groups)
    g.values.forEach((v, i) => {
      const c = g.ci?.[i] ?? 0;
      lo = Math.min(lo, v - c, v);
      hi = Math.max(hi, v + c, v);
    });
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const padL = 46;
  const padB = sub ? 44 : 30;
  const padT = 22;
  const ih = height - padB - padT;
  const iw = Math.max(50, w - padL - 8);
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * ih;
  const cw = iw / Math.max(1, categories.length);
  const bw = Math.min(46, (cw * 0.72) / Math.max(1, groups.length));
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  return (
    <div ref={ref} className="bc">
      <svg width={w} height={height}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - 4} y1={y(t)} y2={y(t)} className={Math.abs(t) < 1e-9 ? "bc-zero" : "bc-grid"} />
            <text x={padL - 8} y={y(t) + 4} className="bc-axis" textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        {categories.map((c, i) => {
          const cx = padL + cw * i + cw / 2;
          const gx = cx - (bw * groups.length) / 2;
          return (
            <g key={c} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(i)} style={{ cursor: onPick ? "pointer" : undefined }}>
              <rect x={padL + cw * i} y={padT} width={cw} height={ih} className={hover === i ? "bc-hover" : "bc-hit"} />
              {groups.map((g, k) => {
                const v = g.values[i] ?? 0;
                const x0 = gx + k * bw + 2;
                const top = y(Math.max(0, v));
                const bot = y(Math.min(0, v));
                const ci = g.ci?.[i] ?? 0;
                return (
                  <g key={k}>
                    <rect x={x0} y={top} width={bw - 4} height={Math.max(1, bot - top)} rx={3} fill={g.color} opacity={0.92} />
                    {ci > 0 && (
                      <g className="bc-err">
                        <line x1={x0 + (bw - 4) / 2} x2={x0 + (bw - 4) / 2} y1={y(v - ci)} y2={y(v + ci)} />
                        <line x1={x0 + (bw - 4) / 2 - 5} x2={x0 + (bw - 4) / 2 + 5} y1={y(v + ci)} y2={y(v + ci)} />
                        <line x1={x0 + (bw - 4) / 2 - 5} x2={x0 + (bw - 4) / 2 + 5} y1={y(v - ci)} y2={y(v - ci)} />
                      </g>
                    )}
                    <text x={x0 + (bw - 4) / 2} y={v >= 0 ? y(v + ci) - 6 : y(v - ci) + 14} textAnchor="middle" className="bc-val" fill={g.color}>
                      {fmt(v)}
                    </text>
                  </g>
                );
              })}
              <text x={cx} y={height - padB + 18} textAnchor="middle" className="bc-cat">
                {c}
              </text>
              {sub && (
                <text x={cx} y={height - padB + 33} textAnchor="middle" className="bc-sub">
                  {sub[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
