import { useMemo, useRef, useState } from 'react';

export interface Series {
  key: string;
  label: string;
  color: string;
  points: { date: string; value: number }[];
}

interface Props {
  series: Series[];
  /** Unit suffix for values, e.g. "%". */
  unit?: string;
  height?: number;
}

const PAD = { top: 14, right: 52, bottom: 26, left: 44 };
const WIDTH = 900;

interface Hover {
  x: number;
  y: number;
  date: string;
  values: { key: string; label: string; color: string; value: number | null }[];
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const start = Math.ceil(min / step) * step;

  const ticks: number[] = [];
  for (let t = start; t <= max + step / 1000; t += step) ticks.push(Number(t.toFixed(6)));
  return ticks;
}

/**
 * Two rate series over time. One y-axis by construction — both series are in the
 * same unit, which is the only case where sharing an axis is honest.
 */
export function YieldCurveChart({ series, unit = '%', height = 260 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const model = useMemo(() => {
    const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
    const values = series.flatMap((s) => s.points.map((p) => p.value));

    if (dates.length === 0 || values.length === 0) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const yMin = min - span * 0.12;
    const yMax = max + span * 0.12;

    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;

    const xFor = (i: number) =>
      PAD.left + (dates.length === 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
    const yFor = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const index = new Map(dates.map((d, i) => [d, i]));

    const paths = series.map((s) => {
      const ordered = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
      const d = ordered
        .map((p, n) => `${n === 0 ? 'M' : 'L'}${xFor(index.get(p.date) ?? 0).toFixed(2)},${yFor(p.value).toFixed(2)}`)
        .join(' ');
      const last = ordered.at(-1) ?? null;
      return { ...s, d, last };
    });

    return { dates, yMin, yMax, plotW, plotH, xFor, yFor, index, paths };
  }, [series, height]);

  if (!model) return null;

  const { dates, yMin, yMax, plotH, xFor, yFor, paths } = model;
  const yTicks = niceTicks(yMin, yMax, 4);

  // Roughly six date labels, whatever the range length.
  const xTickStep = Math.max(1, Math.floor(dates.length / 6));
  const xTicks = dates.filter((_, i) => i % xTickStep === 0);

  function handleMove(event: React.MouseEvent<SVGSVGElement>): void {
    const svg = svgRef.current;
    if (!svg || !model) return;

    const rect = svg.getBoundingClientRect();
    const scale = WIDTH / rect.width;
    const svgX = (event.clientX - rect.left) * scale;

    const ratio = (svgX - PAD.left) / model.plotW;
    const i = Math.round(ratio * (model.dates.length - 1));
    const clamped = Math.min(model.dates.length - 1, Math.max(0, i));
    const date = model.dates[clamped];
    if (!date) return;

    setHover({
      x: model.xFor(clamped),
      y: (event.clientY - rect.top) * scale,
      date,
      values: series.map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        value: s.points.find((p) => p.date === date)?.value ?? null,
      })),
    });
  }

  const tooltipLeftPct = (hover ? hover.x / WIDTH : 0) * 100;
  const flip = tooltipLeftPct > 62;

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`${series.map((s) => s.label).join(' and ')} over time. The table below carries the same figures.`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block', minWidth: 520 }}
      >
        {/* Recessive grid — it locates values, it doesn't compete with them. */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 9}
              y={yFor(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--muted)"
              fontSize={11}
              fontFamily="var(--mono)"
            >
              {t.toFixed(1)}
            </text>
          </g>
        ))}

        {xTicks.map((d) => (
          <text
            key={d}
            x={xFor(dates.indexOf(d))}
            y={PAD.top + plotH + 17}
            textAnchor="middle"
            fill="var(--muted)"
            fontSize={11}
            fontFamily="var(--mono)"
          >
            {d.slice(2, 7)}
          </text>
        ))}

        {hover && (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Direct labels at the line ends — identity never rests on color alone. */}
        {paths.map((p) =>
          p.last ? (
            <text
              key={`lbl${p.key}`}
              x={WIDTH - PAD.right + 8}
              y={yFor(p.last.value)}
              dominantBaseline="middle"
              fill="var(--ink-soft)"
              fontSize={11}
              fontFamily="var(--mono)"
            >
              {p.label}
            </text>
          ) : null,
        )}

        {hover &&
          hover.values.map((v) =>
            v.value === null ? null : (
              <circle
                key={`pt${v.key}`}
                cx={hover.x}
                cy={yFor(v.value)}
                r={4}
                fill={v.color}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ),
          )}
      </svg>

      {hover && (
        <div
          className="chart-tooltip"
          style={{
            left: `${tooltipLeftPct}%`,
            top: 8,
            transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
          }}
        >
          <div className="tt-date">{hover.date}</div>
          <dl>
            {hover.values.map((v) => (
              <div key={v.key} style={{ display: 'contents' }}>
                <dt>
                  <span className="swatch" style={{ background: v.color }} />
                  {v.label}
                </dt>
                <dd>{v.value === null ? '—' : `${v.value.toFixed(2)}${unit}`}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
