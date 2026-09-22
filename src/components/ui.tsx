import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { cls } from "../lib/format";
import { useApp } from "../lib/state";
import type { TagDef } from "../lib/api";

export function Panel({ title, right, children, className, help, pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; help?: string; pad?: boolean }) {
  return (
    <section className={cls("panel", className)}>
      {(title || right) && (
        <header className="panel-h">
          <h3>
            {title}
            {help && <Help text={help} />}
          </h3>
          <div className="panel-r">{right}</div>
        </header>
      )}
      <div className={pad ? "panel-b" : ""}>{children}</div>
    </section>
  );
}

export function Help({ text }: { text: string }) {
  return (
    <span className="help" data-tip={text}>
      ?
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, small }: { value: T; options: { v: T; l: ReactNode }[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={cls("seg", small && "seg-sm")}>
      {options.map((o) => (
        <button key={o.v} className={cls(o.v === value && "on")} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Btn({ children, onClick, kind = "ghost", icon, disabled, title, small }: { children?: ReactNode; onClick?: () => void; kind?: "ghost" | "primary" | "danger" | "soft"; icon?: string; disabled?: boolean; title?: string; small?: boolean }) {
  return (
    <button className={cls("btn", `btn-${kind}`, small && "btn-sm")} onClick={onClick} disabled={disabled} title={title}>
      {icon && <Icon name={icon} size={small ? 13 : 15} />}
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="toggle">
      <button className={cls("tg", on && "on")} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
        <span />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

/** Menu déroulant ancré */
export function Dropdown({ label, children, align = "left", className, closeOnClick = false }: { label: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: "left" | "right"; className?: string; closeOnClick?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className={cls("dd", className)} ref={ref}>
      <button className={cls("dd-btn", open && "on")} onClick={() => setOpen(!open)}>
        {label}
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className={cls("dd-menu", align === "right" && "right")} onClick={closeOnClick ? close : undefined}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function Modal({ children, onClose, wide, title, right }: { children: ReactNode; onClose: () => void; wide?: boolean | "xl"; title?: ReactNode; right?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cls("modal", wide === "xl" ? "modal-xl" : wide && "modal-wide")}>
        {title !== undefined && (
          <header className="modal-h">
            <div className="modal-t">{title}</div>
            <div className="row gap8">
              {right}
              <button className="icon-btn" onClick={onClose} title="Fermer (Échap)">
                <Icon name="x" />
              </button>
            </div>
          </header>
        )}
        <div className="modal-b">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Empty({ title, sub, icon = "spade", action }: { title: string; sub?: string; icon?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic">
        <Icon name={icon} size={30} />
      </div>
      <div className="empty-t">{title}</div>
      {sub && <div className="empty-s">{sub}</div>}
      {action}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" />;
}

export function Loading({ h = 200 }: { h?: number }) {
  return (
    <div className="loading" style={{ height: h }}>
      <Spinner />
    </div>
  );
}

/** Valeur floutable (mode confidentialité) */
export function Priv({ k, children }: { k?: string; children: ReactNode }) {
  const { prefs } = useApp();
  const hidden = prefs.privacy["__all"] || (k ? prefs.privacy[k] : false);
  return <span className={cls(hidden && "blurred")}>{children}</span>;
}

export function TagChip({ tag, small }: { tag: TagDef | undefined; small?: boolean }) {
  if (!tag) return null;
  return (
    <span className={cls("tag", small && "tag-sm")} style={{ ["--tc" as string]: tag.color }}>
      <Icon name={tag.icon} size={small ? 11 : 12} />
      {!small && tag.name}
    </span>
  );
}

export function Tags({ ids, small }: { ids: string[]; small?: boolean }) {
  const { settings } = useApp();
  if (!settings) return null;
  return (
    <span className="tags">
      {ids.map((id) => (
        <TagChip key={id} tag={settings.tags.find((t) => t.id === id && t.active)} small={small} />
      ))}
    </span>
  );
}

export function Stat({ label, value, sub, tone, k }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; k?: string }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}</div>
      <div className={cls("stat-v", tone)}>
        <Priv k={k}>{value}</Priv>
      </div>
      {sub && <div className="stat-s">{sub}</div>}
    </div>
  );
}

export function NumInput({ value, onChange, step = 1, min, max, width = 80, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; width?: number; suffix?: string }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  return (
    <span className="numin">
      <input
        style={{ width }}
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => {
          const v = parseFloat(txt.replace(",", "."));
          if (isFinite(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
          else setTxt(String(value));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        inputMode="decimal"
        step={step}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

export function Pager({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (o: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="pager">
      <button className="icon-btn" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>
        <Icon name="chevronl" />
      </button>
      <span>
        {page} / {pages}
      </span>
      <button className="icon-btn" disabled={page >= pages} onClick={() => onChange(offset + limit)}>
        <Icon name="chevronr" />
      </button>
    </div>
  );
}
