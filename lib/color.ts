export function darken(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const r = Math.max(0, parseInt(value.substring(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(value.substring(2, 4), 16) - amount);
  const b = Math.max(0, parseInt(value.substring(4, 6), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function mix(hexA: string, hexB: string, t: number): string {
  const a = hexA.replace("#", "");
  const b = hexB.replace("#", "");
  const channel = (i: number) => {
    const av = parseInt(a.substring(i, i + 2), 16);
    const bv = parseInt(b.substring(i, i + 2), 16);
    return Math.round(av + (bv - av) * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}
