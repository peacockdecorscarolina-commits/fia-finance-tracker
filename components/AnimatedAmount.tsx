import { useEffect, useRef, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

// Counts a displayed dollar amount up/down to a new target instead of
// snapping to it, so totals feel alive when a filter/month changes instead
// of just replacing one static number with another.
export function AnimatedAmount({
  value,
  style,
  prefix = "$",
  durationMs = 500,
}: {
  value: number;
  style?: StyleProp<TextStyle>;
  prefix?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const start = Date.now();
    let raf: number;
    function tick() {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Text style={style}>
      {prefix}
      {display.toFixed(2)}
    </Text>
  );
}
