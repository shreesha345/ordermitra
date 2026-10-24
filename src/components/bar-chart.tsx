/** Single-series column chart: one hue, rounded data ends on a zero baseline, hover tooltip, and a table for screen readers. */
export function BarChart({ data, label, format }: { data: { label: string; value: number; detail?: string }[]; label: string; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const ticks = [top, top - step, top - 2 * step, 0].filter((t) => t >= 0);

  return (
    <figure className="px-5 pb-5">
      <div className="flex gap-3" aria-hidden>
        <div className="num flex h-44 flex-col justify-between text-right text-[11px] text-faint">
          {ticks.map((t) => <span key={t} className="leading-none">{format(t)}</span>)}
        </div>
        <div className="relative flex-1">
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((t) => <div key={t} className="border-t border-line" />)}
          </div>
          <div className="relative flex h-44 items-end gap-[3px]">
            {data.map((d, i) => (
              <div key={i} className="group relative flex h-full flex-1 items-end justify-center">
                <div
                  className="w-full max-w-7 rounded-t bg-primary/85 transition-colors group-hover:bg-primary"
                  style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value ? 2 : 0 }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
                  <div className="font-medium">{d.label}</div>
                  <div className="num">{format(d.value)}{d.detail ? ` · ${d.detail}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-[3px] text-[11px] text-faint">
            {data.map((d, i) => (
              <div key={i} className="flex-1 text-center whitespace-nowrap">{(data.length - 1 - i) % 2 ? "" : d.label}</div>
            ))}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d, i) => <tr key={i}><th>{d.label}</th><td>{format(d.value)}{d.detail ? `, ${d.detail}` : ""}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars for a share-of-total breakdown, each labelled directly. */
export function BarList({ rows, format = String }: { rows: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3 px-5 pb-5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-3">
            <span className="truncate">{r.label}</span>
            <span className="num text-muted">{format(r.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-subtle">
            <div className="h-full rounded-full bg-primary/85" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
}
