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
export function buildTicks(rawMax: number, rawMin = 0): number[] {
  const step = niceStep(rawMax - Math.min(rawMin, 0));
  const floor = rawMin < 0 ? Math.floor(rawMin / step) * step : 0;
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
