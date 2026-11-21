<script lang="ts">
  import { formatPercent, niceStep, type ChartSeries } from "./format";

  let { series, stacked }: { series: ChartSeries[]; stacked: boolean } = $props();

  const height = 320;
  const m = { top: 12, right: 8, bottom: 28, left: 52 };
  let width = $state(640);
  let hover = $state<number | null>(null);

  const xs = $derived([...new Set(series.flatMap((s) => [...s.values.keys()]))].sort((a, b) => a - b));
  const plotW = $derived(Math.max(1, width - m.left - m.right));
  const plotH = height - m.top - m.bottom;
  const band = $derived(plotW / Math.max(1, xs.length));
  const gap = $derived(band >= 6 ? 2 : 0);
  /** Too many values for one bar each: draw one shape per series instead. */
  const dense = $derived(band < 3);
  const lo = $derived(xs[0] ?? 0);
  const span = $derived((xs[xs.length - 1] ?? 0) - lo + 1);

  const columnTotal = (x: number) =>
    stacked
      ? series.reduce((sum, s) => sum + (s.values.get(x) ?? 0), 0)
      : Math.max(0, ...series.map((s) => s.values.get(x) ?? 0));

  const ticks = $derived.by(() => {
    const top = Math.max(1e-12, ...xs.map(columnTotal));
    const step = niceStep(top / 4);
    return Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => i * step);
  });
  const yMax = $derived(ticks[ticks.length - 1]!);
  const y = (p: number) => m.top + plotH - (p / yMax) * plotH;

  const xOfValue = (v: number) => m.left + ((v - lo + 0.5) / span) * plotW;
  /** Center of the value at index `i`. */
  const xAt = (i: number) => (dense ? xOfValue(xs[i]!) : m.left + (i + 0.5) * band);

  const xLabels = $derived.by(() => {
    if (!dense) {
      const every = Math.max(1, Math.ceil(44 / band));
      return xs.flatMap((v, i) => (i % every === 0 ? [{ x: xAt(i), v }] : []));
    }
    const step = niceStep(span / (plotW / 60));
    const out: { x: number; v: number }[] = [];
    for (let v = Math.ceil(lo / step) * step; v < lo + span; v += step) out.push({ x: xOfValue(v), v });
    return out;
  });

  interface Bar {
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    rounded: boolean;
  }

  const bars = $derived.by(() => {
    const out: Bar[] = [];
    if (dense) return out;
    xs.forEach((value, i) => {
      const left = m.left + i * band + gap / 2;
      if (stacked) {
        let acc = 0;
        const parts = series.filter((s) => s.values.get(value));
        parts.forEach((s, j) => {
          const p = s.values.get(value)!;
          const top = y(acc + p);
          let h = y(acc) - top;
          if (j > 0 && h > 3) h -= 2;
          out.push({ x: left, y: top, w: band - gap, h, color: s.color, rounded: j === parts.length - 1 });
          acc += p;
        });
      } else {
        const w = (band - gap) / series.length;
        series.forEach((s, j) => {
          const p = s.values.get(value) ?? 0;
          if (!p) return;
          const inner = w > 4 ? 1 : 0;
          out.push({ x: left + j * w + inner / 2, y: y(p), w: w - inner, h: y(0) - y(p), color: s.color, rounded: true });
        });
      }
    });
    return out;
  });

  function barPath(b: Bar): string {
    const r = b.rounded ? Math.min(4, b.w / 2, b.h) : 0;
    const bottom = b.y + b.h;
    return `M${b.x},${bottom}V${b.y + r}Q${b.x},${b.y} ${b.x + r},${b.y}H${b.x + b.w - r}Q${b.x + b.w},${b.y} ${b.x + b.w},${b.y + r}V${bottom}Z`;
  }

  /**
   * Dense mode: one point per pixel column, at the value with the highest
   * probability in that column. Stacked series become bands, others lines.
   */
  const shapes = $derived.by(() => {
    if (!dense) return [];
    const columns = Math.max(1, Math.floor(plotW));
    const pick: (number | undefined)[] = new Array(columns);
    const best = new Float64Array(columns);
    for (const v of xs) {
      const c = Math.min(columns - 1, Math.floor(((v - lo) / span) * columns));
      const t = columnTotal(v);
      if (pick[c] === undefined || t > best[c]!) {
        pick[c] = v;
        best[c] = t;
      }
    }
    const cx = (c: number) => (m.left + ((c + 0.5) / columns) * plotW).toFixed(1);
    const level = (c: number, upTo: number) => {
      const v = pick[c];
      if (v === undefined || upTo < 0) return 0;
      if (!stacked) return series[upTo]!.values.get(v) ?? 0;
      let sum = 0;
      for (let k = 0; k <= upTo; k++) sum += series[k]!.values.get(v) ?? 0;
      return sum;
    };
    const edge = (c: number) => (m.left + (c / columns) * plotW).toFixed(1);
    return series.map((s, k) => {
      if (!stacked) {
        const line: string[] = [];
        for (let c = 0; c < columns; c++) line.push(`${cx(c)},${y(level(c, k)).toFixed(1)}`);
        return { color: s.color, d: `M${line.join("L")}`, fill: false };
      }
      // Steps, so that a value on its own stays one column wide.
      const outline: string[] = [];
      for (let c = 0; c < columns; c++) {
        const top = y(level(c, k)).toFixed(1);
        outline.push(`${edge(c)},${top}`, `${edge(c + 1)},${top}`);
      }
      for (let c = columns - 1; c >= 0; c--) {
        const bottom = y(level(c, k - 1)).toFixed(1);
        outline.push(`${edge(c + 1)},${bottom}`, `${edge(c)},${bottom}`);
      }
      return { color: s.color, d: `M${outline.join("L")}Z`, fill: true };
    });
  });

  function onMove(e: PointerEvent) {
    const px = e.offsetX - m.left;
    if (!dense) {
      hover = Math.min(xs.length - 1, Math.max(0, Math.floor(px / band)));
      return;
    }
    const target = lo + (px / plotW) * span - 0.5;
    let a = 0;
    let b = xs.length - 1;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (xs[mid]! < target) a = mid + 1;
      else b = mid;
    }
    hover = a > 0 && target - xs[a - 1]! < xs[a]! - target ? a - 1 : a;
  }

  const atLeast = (value: number) =>
    series.reduce((sum, s) => {
      for (const [v, p] of s.values) if (v >= value) sum += p;
      return sum;
    }, 0);
</script>

<div class="chart" bind:clientWidth={width}>
  <svg {width} {height} role="img" aria-label="Probability of each result">
    {#each ticks as t}
      <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} class={t === 0 ? "axis" : "grid"} />
      <text x={m.left - 8} y={y(t)} dy="0.32em" text-anchor="end">{formatPercent(t)}</text>
    {/each}

    {#if hover !== null}
      {#if dense}
        <line class="cursor" x1={xAt(hover)} x2={xAt(hover)} y1={m.top} y2={m.top + plotH} />
      {:else}
        <rect class="highlight" x={m.left + hover * band} y={m.top} width={band} height={plotH} />
      {/if}
    {/if}

    {#each bars as b}
      <path d={barPath(b)} fill={b.color} />
    {/each}
    {#each shapes as s}
      <path
        d={s.d}
        fill={s.fill ? s.color : "none"}
        stroke={s.fill ? "none" : s.color}
        stroke-width="2"
        stroke-linejoin="round"
      />
    {/each}

    {#each xLabels as l}
      <text x={l.x} y={height - m.bottom + 18} text-anchor="middle">{l.v}</text>
    {/each}

    <rect
      class="hit"
      role="presentation"
      x={m.left}
      y={m.top}
      width={plotW}
      height={plotH}
      onpointermove={onMove}
      onpointerleave={() => (hover = null)}
    />
  </svg>

  {#if hover !== null}
    {@const value = xs[hover]!}
    {@const cx = xAt(hover)}
    <div class="tooltip" style:left="{cx}px" class:flip={cx > width / 2}>
      <strong>{value}</strong>
      {#each series as s}
        {#if !stacked || s.values.get(value)}
          <div class="row">
            <span class="swatch" style:background={s.color}></span>
            <span class="name">{s.name}</span>
            <span>{formatPercent(s.values.get(value) ?? 0)}</span>
          </div>
        {/if}
      {/each}
      {#if stacked}
        <div class="row muted"><span class="name">At least {value}</span><span>{formatPercent(atLeast(value))}</span></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
  }
  text {
    fill: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .grid {
    stroke: var(--grid);
  }
  .axis {
    stroke: var(--axis);
  }
  .cursor {
    stroke: var(--axis);
  }
  .highlight {
    fill: var(--grid);
    opacity: 0.6;
  }
  .hit {
    fill: transparent;
  }
  .tooltip {
    position: absolute;
    top: 0;
    transform: translateX(12px);
    pointer-events: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 13px;
    min-width: 140px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    white-space: nowrap;
  }
  .tooltip.flip {
    transform: translateX(calc(-100% - 12px));
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-variant-numeric: tabular-nums;
  }
  .name {
    flex: 1;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
  }
  .muted .name {
    color: var(--muted);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
</style>
