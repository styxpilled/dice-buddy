<script lang="ts">
  import {
    LABELS,
    parse,
    type Distribution,
    type Label,
    type Pmf,
    type RollResult,
  } from "dice-buddy";
  import { onMount } from "svelte";
  import Chart from "./Chart.svelte";
  import {
    formatNumber,
    formatPercent,
    niceStep,
    type ChartSeries,
    type Scale,
  } from "./format";

  const MAX_EXPRESSIONS = 4;
  const MAX_TABLE_ROWS = 200;
  const EXAMPLES = [
    "d20",
    "4kh3d6",
    "adv(d20) + 5",
    "d20 + 6 DC 15",
    "d20 + 5 AC 15 ? 1d8 + 3 crit 2d8 + 3",
    "d20 + 3 DC 15 ? 8d6 / 2 : 8d6",
    "2d6ro<3 + 4",
  ];
  /** Notes use `backticks` for code, as in the README. */
  const SYNTAX: [string, string][] = [
    ["d20, 3d6, (d4)d6", "count can be a roll"],
    ["4kh3d6, 4d6kh3, 2kl1d20", "keep the highest or lowest dice"],
    ["d20ro1, 2d6ro<3", "reroll a die once when it matches"],
    ["+ - * /", "`/` rounds down"],
    [
      "AC DC >= > <= < = !=",
      "1 when true, 0 when false; `AC` and `DC` mean `>=`, but `AC` uses natural rolls",
    ],
    ["test ? a : b", "`a` when the test is not 0, else `b` (or 0 if no `: b`)"],
    [
      "test ? a crit x, crit[2] x",
      "`x` when the left side of the test rolls its highest (or 2 highest) values",
    ],
    ["adv(x), dis(x), max(a, b), min(a, b)", ""],
  ];
  const LABEL_NAMES: Record<Label, string> = {
    "": "Normal",
    fail: "Fail",
    crit: "Crit",
  };
  const LABEL_COLORS: Record<Label, string> = {
    "": "var(--series-1)",
    fail: "var(--series-3)",
    crit: "var(--series-2)",
  };

  interface Result {
    src: string;
    dist: Distribution | null;
    pmf: Pmf | null;
    error: string | null;
  }

  // The page is prerendered with these defaults; the URL state is applied on mount.
  let inputs = $state(["d20"]);
  let settled = $state(["d20"]);
  const SCALES: Scale[] = ["auto", "linear", "log"];
  const SCALE_NAMES: Record<Scale, string> = {
    auto: "Auto",
    linear: "Linear",
    log: "Log",
  };

  let natural = $state(true);
  let scale = $state<Scale>("auto");
  let urlRead = $state(false);

  onMount(() => {
    const query = new URLSearchParams(location.search);
    const list = query.getAll("e").filter(Boolean).slice(0, MAX_EXPRESSIONS);
    if (list.length) {
      inputs = list;
      settled = [...list];
    }
    natural = query.get("n") !== "0";
    scale = SCALES.find((s) => s === query.get("s")) ?? "auto";
    urlRead = true;
  });
  let tableOpen = $state(false);
  let rolls = $state<
    Record<number, { src: string; result: RollResult } | undefined>
  >({});

  $effect(() => {
    const next = [...inputs];
    const timer = setTimeout(() => (settled = next), 150);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!urlRead) return;
    const url = new URL(location.href);
    url.searchParams.delete("e");
    for (const e of settled) url.searchParams.append("e", e);
    if (natural) url.searchParams.delete("n");
    else url.searchParams.set("n", "0");
    if (scale === "auto") url.searchParams.delete("s");
    else url.searchParams.set("s", scale);
    history.replaceState(null, "", url);
  });

  const results: Result[] = $derived(
    settled.map((src) => {
      if (!src.trim()) return { src, dist: null, pmf: null, error: null };
      try {
        const dist = parse(src, { naturalRolls: natural }).distribution();
        return { src, dist, pmf: dist.pmf(), error: null };
      } catch (e) {
        return {
          src,
          dist: null,
          pmf: null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  const single = $derived(settled.length === 1);

  const series: ChartSeries[] = $derived.by(() => {
    if (single) {
      const dist = results[0]?.dist;
      if (!dist) return [];
      return LABELS.filter((l) => dist.parts.has(l)).map((l) => ({
        name: LABEL_NAMES[l],
        color: LABEL_COLORS[l],
        values: new Map(dist.parts.get(l)!),
      }));
    }
    return results.map((r, i) => ({
      name: r.src,
      color: `var(--series-${i + 1})`,
      values: new Map(r.pmf ?? []),
    }));
  });

  /** Large distributions get one row per range of values. */
  const tableRows = $derived.by(() => {
    const values = [
      ...new Set(
        results.flatMap((r) => (r.pmf ? [...r.pmf].map(([v]) => v) : [])),
      ),
    ].sort((a, b) => a - b);
    if (values.length <= MAX_TABLE_ROWS) {
      return values.map((v) => ({
        label: String(v),
        cells: results.map((r) => r.pmf?.get(v) ?? 0),
      }));
    }
    const lo = values[0]!;
    const step = niceStep(
      (values[values.length - 1]! - lo + 1) / MAX_TABLE_ROWS,
    );
    const start = Math.floor(lo / step) * step;
    const rows = new Map<number, number[]>();
    results.forEach((r, j) => {
      for (const [v, p] of r.pmf ?? []) {
        const b = Math.floor((v - start) / step);
        let row = rows.get(b);
        if (!row) rows.set(b, (row = results.map(() => 0)));
        row[j]! += p;
      }
    });
    return [...rows]
      .sort((a, b) => a[0] - b[0])
      .map(([b, cells]) => ({
        label: `${start + b * step} to ${start + (b + 1) * step - 1}`,
        cells,
      }));
  });

  function roll(i: number) {
    const src = inputs[i]!;
    try {
      rolls[i] = { src, result: parse(src, { naturalRolls: natural }).roll() };
    } catch {
      rolls[i] = undefined;
    }
  }

  /** Removes an expression, or clears it when it is the only one. */
  function remove(i: number) {
    if (inputs.length === 1) inputs[0] = "";
    else inputs.splice(i, 1);
    settled = [...inputs];
    rolls = {};
  }

  function add() {
    inputs.push(inputs[inputs.length - 1] ?? "d20");
    settled = [...inputs];
  }
</script>

<main>
  <h1>dice-buddy</h1>

  {#each inputs as _, i}
    {@const r = results[i]}
    {@const rolled = rolls[i]?.src === inputs[i] ? rolls[i]!.result : null}
    <section class="expr">
      <div class="line">
        {#if !single}
          <span class="swatch" style:background="var(--series-{i + 1})"></span>
        {/if}
        <input
          bind:value={inputs[i]}
          onkeydown={(e) => e.key === "Enter" && roll(i)}
          aria-label="Dice expression {i + 1}"
          aria-invalid={!!r?.error}
          spellcheck="false"
          autocomplete="off"
        />
        <button class="primary" onclick={() => roll(i)} disabled={!!r?.error}>
          Roll
        </button>
        <button
          class="icon"
          onclick={() => remove(i)}
          aria-label={single
            ? "Clear expression"
            : `Remove expression ${i + 1}`}
          title={single ? "Clear" : "Remove"}
        >
          ×
        </button>
      </div>
      <div class="meta" class:compare={!single}>
        {#if r?.error}
          <p class="error">{r.error}</p>
        {:else if r?.dist}
          <p class="stats">
            <span>Mean <b>{formatNumber(r.dist.mean())}</b></span>
            <span>SD <b>{formatNumber(r.dist.stdev())}</b></span>
            <span>Range <b>{r.dist.min} to {r.dist.max}</b></span>
          </p>
        {/if}
        {#if i === inputs.length - 1}
          <button
            class="add"
            onclick={add}
            aria-label="Compare another expression"
            title="Compare another expression"
            style:visibility={inputs.length < MAX_EXPRESSIONS
              ? "visible"
              : "hidden"}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M7 1.5v11M1.5 7h11"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        {/if}
      </div>
      {#if rolled}
        <p
          class="roll"
          class:compare={!single}
          class:crit={rolled.label === "crit"}
          class:fail={rolled.label === "fail"}
        >
          <b>{rolled.total}</b>
          <code>{rolled.text}</code>
        </p>
      {/if}
    </section>
  {/each}

  <div class="card">
    <div class="toolbar">
      <div class="controls">
        <label class="toggle">
          <input type="checkbox" bind:checked={natural} />
          <span class="trim">Natural rolls (AC)</span>
        </label>
        <div class="segmented" role="radiogroup" aria-label="Y axis scale">
          {#each SCALES as s}
            <button
              role="radio"
              aria-checked={scale === s}
              onclick={() => (scale = s)}
            >
              <span class="trim">{SCALE_NAMES[s]}</span>
            </button>
          {/each}
        </div>
      </div>
      {#if series.length > 1}
        <ul class="legend">
          {#each series as s}
            <li>
              <span class="swatch" style:background={s.color}></span><span
                class="trim"
              >
                {s.name}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if series.length}
      <Chart {series} stacked={single} {scale} />
    {:else}
      <div class="empty"></div>
    {/if}
  </div>

  <details bind:open={tableOpen}>
    <summary>Table</summary>
    {#if tableOpen}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Result</th>
              {#each results as r}<th>
                  {single ? "Probability" : r.src}
                </th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each tableRows as row}
              <tr>
                <td>{row.label}</td>
                {#each row.cells as p}<td>{formatPercent(p)}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </details>

  <details>
    <summary>Syntax</summary>
    <dl class="syntax">
      {#each SYNTAX as [code, text]}
        <dt><code>{code}</code></dt>
        <dd>
          {#each text.split("`") as part, j}{#if j % 2}<code>
                {part}
              </code>{:else}{part}{/if}{/each}
        </dd>
      {/each}
    </dl>
    <p class="note">
      With natural rolls, <code>AC</code> always fails when its left side rolls its
      lowest value (a natural 1) and always succeeds on its highest value (a natural
      20).
    </p>
  </details>

  <div class="examples">
    {#each EXAMPLES as ex}
      <button class="chip" onclick={() => (inputs[0] = ex)}>
        <code>{ex}</code>
      </button>
    {/each}
  </div>
</main>

<style>
  main {
    /* Lines text up with the text in the inputs. */
    --inset: 11px;
    max-width: 880px;
    margin: 0 auto;
    padding: 24px 16px 48px;
  }
  h1,
  details,
  .examples {
    padding-left: var(--inset);
  }
  h1 {
    font-size: 22px;
    margin: 0 0 16px;
  }
  .expr {
    margin-bottom: 12px;
  }
  .expr:last-of-type {
    margin-bottom: 16px;
  }
  .line {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  input {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
  }
  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  input[aria-invalid="true"] {
    border-color: var(--error);
  }
  button {
    font: inherit;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.primary {
    width: 72px;
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  button.icon {
    width: 40px;
    padding: 8px 0;
  }
  .swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex: none;
  }
  p {
    margin: 6px 0 0;
  }
  .error {
    color: var(--error);
    font-size: 14px;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 16px;
    color: var(--ink-2);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .stats b {
    color: var(--ink);
    font-weight: 600;
  }
  .roll {
    display: flex;
    gap: 10px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .roll b {
    font-size: 20px;
  }
  .roll.crit b {
    color: var(--series-2);
  }
  .roll code {
    color: var(--ink-2);
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  /* Text lines up with the text in the input; in compare mode, past the swatch too. */
  .meta {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    padding-left: var(--inset);
    /* Keeps the add button under Roll, past the remove button. */
    padding-right: 48px;
  }
  .meta.compare {
    padding-left: calc(var(--inset) + 20px);
  }
  .meta p {
    margin: 0;
  }
  .roll {
    padding-left: var(--inset);
  }
  .roll.compare {
    padding-left: calc(var(--inset) + 20px);
  }
  button.add {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 72px;
    height: 26px;
    margin-left: auto;
    padding: 0;
    border: 0;
    background: var(--axis);
    color: var(--ink);
  }
  button.add:hover {
    opacity: 0.85;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 16px 8px;
    margin-bottom: 16px;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 16px;
    min-height: 20px;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
  }
  .segmented {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .segmented button {
    border: 0;
    border-radius: 0;
    padding: 3px 8px;
    font-size: 12px;
    background: none;
    color: var(--ink-2);
  }
  .segmented button + button {
    border-left: 1px solid var(--border);
  }
  .segmented button[aria-checked="true"] {
    background: var(--grid);
    color: var(--ink);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .toggle input {
    margin: 0;
    accent-color: var(--accent);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .empty {
    height: 320px;
  }
  /* Trim the text box to the cap height, so that centering uses the visible letters. */
  .trim {
    text-box: trim-both cap alphabetic;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  details {
    margin-bottom: 12px;
  }
  summary {
    cursor: pointer;
    color: var(--ink-2);
  }
  .table-wrap {
    max-height: 360px;
    overflow: auto;
    margin-top: 8px;
  }
  table {
    border-collapse: collapse;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: right;
    padding: 2px 12px;
    border-bottom: 1px solid var(--grid);
  }
  th {
    position: sticky;
    top: 0;
    background: var(--page);
    font-weight: 600;
  }
  .note {
    margin: 8px 0;
    font-size: 14px;
    color: var(--ink-2);
  }
  .syntax {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    font-size: 14px;
  }
  .syntax dd {
    margin: 0;
    color: var(--ink-2);
  }
  @media (max-width: 560px) {
    .stats {
      flex-direction: column;
    }
    .syntax {
      grid-template-columns: 1fr;
    }
    .syntax dd {
      margin-bottom: 6px;
    }
  }
  .examples {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    padding: 4px 10px;
    font-size: 13px;
  }
</style>
