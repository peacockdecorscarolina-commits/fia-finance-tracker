// Picks a "clean" tick spacing (1, 2, or 5 times a power of ten) so an axis
// reads e.g. "0k / 1k / 2k / 3k" with round numbers, aiming for roughly 4-5
// gridlines. Shared by every chart that needs a y-axis.
export function niceStep(rawMax: number): number {
  if (rawMax <= 0) return 1;
  const roughStep = rawMax / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const steps = [1, 2, 5, 10];
  const step = steps.find((s) => roughStep <= s * magnitude) ?? 10;
  return step * magnitude;
}

// Builds tick values from a floor up to (and including) a ceiling that's a
// whole number of steps above the raw max, so the top gridline is never
// below the highest plotted value.
export function buildTicks(rawMax: number, rawMin = 0, floorAtZero = true): number[] {
  const effectiveMin = floorAtZero ? Math.min(rawMin, 0) : rawMin;
  const step = niceStep(rawMax - effectiveMin);
  const floor = floorAtZero ? (rawMin < 0 ? Math.floor(rawMin / step) * step : 0) : Math.floor(rawMin / step) * step;
  const topTick = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  for (let v = floor; v <= topTick; v += step) ticks.push(v);
  return ticks;
}

export function formatAxisLabel(value: number, useK: boolean): string {
  if (useK) {
    const thousands = value / 1000;
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}k`;
  }
  return `${Math.round(value)}`;
}

// Which x-axis labels to draw. Every point used to get one, so dense or
// same-month points ("Oct", "Oct") overlapped into unreadable text. This
// skips a label that repeats the one before it or would sit too close to
// it, always keeps the last point's (where the line ends), and keeps the
// tapped point's so it's clear which one the tooltip belongs to.
export function visibleLabelIndexes(
  labels: string[],
  xs: number[],
  selected: number | null,
  minSpacing: number
): Set<number> {
  const shown: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    const prev = shown[shown.length - 1];
    if (prev !== undefined && (labels[prev] === labels[i] || xs[i] - xs[prev] < minSpacing)) continue;
    shown.push(i);
  }
  const last = labels.length - 1;
  if (shown[shown.length - 1] !== last && labels[shown[shown.length - 1]] !== labels[last]) {
    // Make room for the last label by dropping whatever it would collide with.
    while (shown.length > 0 && xs[last] - xs[shown[shown.length - 1]] < minSpacing) shown.pop();
    shown.push(last);
  }
  const result = new Set(shown);
  if (selected !== null) {
    for (const i of shown) {
      if (i !== selected && Math.abs(xs[i] - xs[selected]) < minSpacing) result.delete(i);
    }
    result.add(selected);
  }
  return result;
}
