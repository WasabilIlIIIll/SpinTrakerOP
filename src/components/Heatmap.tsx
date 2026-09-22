import { useMemo, useState } from "react";
import type { DayCount } from "../lib/api";
import { cls, date, money, num } from "../lib/format";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const DAYS = ["lun.", "", "mer.", "", "ven.", "", "dim."];

function civil(day: number) {
  const d = new Date(day * 86400 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

export function Heatmap({ data, metric = "spins" }: { data: DayCount[]; metric?: "spins" | "profit" | "ev" }) {
  const years = useMemo(() => Array.from(new Set(data.map((d) => civil(d.day).y))).sort((a, b) => b - a), [data]);
  const [year, setYear] = useState(years[0] ?? new Date().getUTCFullYear());
  const y = years.includes(year) ? year : (years[0] ?? year);
  const map = useMemo(() => new Map(data.map((d) => [d.day, d])), [data]);
  const start = Date.UTC(y, 0, 1) / 86400000;
  const end = Date.UTC(y, 11, 31) / 86400000;
  const firstCol = start - ((((start + 3) % 7) + 7) % 7); // aligner sur lundi
  const weeks = Math.ceil((end - firstCol + 1) / 7);
  const max = useMemo(() => Math.max(1, ...data.filter((d) => civil(d.day).y === y).map((d) => (metric === "spins" ? d.spins : Math.abs(metric === "profit" ? d.profit : d.ev)))), [data, y, metric]);
  const total = data.filter((d) => civil(d.day).y === y).reduce((a, d) => a + (metric === "spins" ? d.spins : metric === "profit" ? d.profit : d.ev), 0);
  const cell = 13;
  const gap = 3;
  const w = weeks * (cell + gap) + 34;
  return (
    <div className="hm-year">
      <div className="row gap8">
        <b>
          {metric === "spins" ? `${num(total)} Spins joués` : `${money(total)} ${metric === "profit" ? "gagnés" : "d'EV"}`} en {y}
        </b>
        <div className="grow" />
        {years.map((yy) => (
          <button key={yy} className={cls("fchip", yy === y && "on")} onClick={() => setYear(yy)}>
            {yy}
          </button>
        ))}
      </div>
      <div className="hm-scroll">
        <svg width={w} height={7 * (cell + gap) + 26}>
          {MONTHS.map((mn, i) => {
            const d0 = Date.UTC(y, i, 1) / 86400000;
            const col = Math.floor((d0 - firstCol) / 7);
            return (
              <text key={mn} x={30 + col * (cell + gap)} y={10} className="hm-lbl">
                {mn}
              </text>
            );
          })}
          {DAYS.map((dn, i) =>
            dn ? (
              <text key={i} x={0} y={26 + i * (cell + gap)} className="hm-lbl">
                {dn}
              </text>
            ) : null,
          )}
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const day = firstCol + i;
            if (day < start || day > end) return null;
            const col = Math.floor(i / 7);
            const row = i % 7;
            const d = map.get(day);
            const v = d ? (metric === "spins" ? d.spins : metric === "profit" ? d.profit : d.ev) : 0;
            const lvl = v === 0 ? 0 : Math.min(4, Math.ceil((Math.abs(v) / max) * 4));
            return (
              <rect
                key={day}
                x={30 + col * (cell + gap)}
                y={18 + row * (cell + gap)}
                width={cell}
                height={cell}
                rx={3}
                className={cls("hm-d", `l${lvl}`, v < 0 && "negv")}
              >
                <title>
                  {date(day * 86400)} : {d ? `${d.spins} spins · ${money(d.profit)}` : "aucun spin"}
                </title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="hm-scale">
        Moins
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`hm-d l${l}`} />
        ))}
        Plus
      </div>
    </div>
  );
}
