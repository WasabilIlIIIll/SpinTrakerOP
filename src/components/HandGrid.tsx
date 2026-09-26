import { useEffect, useRef, useState, type ReactNode } from "react";
import { cellName, type Grid } from "../lib/solver";
import { cls } from "../lib/format";

/** Grille 13×13 générique : `render` dessine le fond de chaque case. */
export function HandGrid({
  render,
  onCell,
  onHover,
  selected,
  highlight,
  dim,
  onPaint,
}: {
  render: (cell: number) => ReactNode;
  onCell?: (cell: number) => void;
  onHover?: (cell: number | null) => void;
  selected?: number | null;
  highlight?: Set<number>;
  dim?: (cell: number) => boolean;
  /** peinture par glisser (éditeur de range) */
  onPaint?: (cell: number, first: boolean) => void;
}) {
  const painting = useRef(false);
  useEffect(() => {
    const up = () => (painting.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  return (
    <div className="hgrid" onMouseLeave={() => onHover?.(null)}>
      {Array.from({ length: 169 }, (_, c) => (
        <div
          key={c}
          className={cls("hg-c", selected === c && "sel", highlight?.has(c) && "hl", dim?.(c) && "dim", (onCell || onPaint) && "clk")}
          onMouseDown={(e) => {
            if (!onPaint) return;
            e.preventDefault();
            painting.current = true;
            onPaint(c, true);
          }}
          onMouseEnter={() => {
            onHover?.(c);
            if (painting.current && onPaint) onPaint(c, false);
          }}
          onClick={() => onCell?.(c)}
        >
          <div className="hg-bg">{render(c)}</div>
          <span className="hg-n">{cellName(c)}</span>
        </div>
      ))}
    </div>
  );
}

/** Éditeur de range : peinture au pinceau (poids réglable), texte synchronisé, top X %. */
export function RangeEditor({
  grid,
  onChange,
  order,
  color = "var(--accent)",
}: {
  grid: Grid;
  onChange: (g: Grid) => void;
  order?: number[] | null;
  color?: string;
}) {
  const [brush, setBrush] = useState(1);
  const mode = useRef<"set" | "clear">("set");
  const paint = (c: number, first: boolean) => {
    if (first) mode.current = grid[c] >= brush - 1e-6 && grid[c] > 0 ? "clear" : "set";
    const g = [...grid];
    g[c] = mode.current === "set" ? brush : 0;
    onChange(g);
  };
  const top = (p: number) => {
    if (!order) return;
    const g = Array(169).fill(0);
    // cumul en combos, pas en cases
    const total = 1326;
    let acc = 0;
    for (const c of order) {
      const n = Math.floor(c / 13) === c % 13 ? 6 : Math.floor(c / 13) < c % 13 ? 4 : 12;
      if (acc + n / 2 > (total * p) / 100) break;
      g[c] = 1;
      acc += n;
    }
    onChange(g);
  };
  return (
    <div className="col gap8">
      <HandGrid
        onPaint={paint}
        render={(c) => (grid[c] > 0 ? <div className="hg-fill" style={{ height: `${grid[c] * 100}%`, background: color }} /> : null)}
      />
      <div className="row gap8 wrap small">
        <span className="muted">Pinceau</span>
        {[1, 0.75, 0.5, 0.25].map((w) => (
          <button key={w} className={cls("fchip", brush === w && "on")} onClick={() => setBrush(w)}>
            {w * 100} %
          </button>
        ))}
        <div className="grow" />
        {order && (
          <>
            <span className="muted">Top</span>
            {[10, 20, 35, 50, 75, 100].map((p) => (
              <button key={p} className="fchip" onClick={() => top(p)}>
                {p} %
              </button>
            ))}
          </>
        )}
        <button className="fchip" onClick={() => onChange(Array(169).fill(0))}>
          Vider
        </button>
      </div>
    </div>
  );
}
