import { View } from "react-native";

type Point = { x: number; y: number };

function segmentStyle(from: Point, to: Point, color: string) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    position: "absolute" as const,
    left: from.x,
    top: from.y - 1,
    width: length,
    height: 2,
    backgroundColor: color,
    borderRadius: 1,
    transform: [{ rotate: `${angleDeg}deg` }],
    transformOrigin: "0 0" as const,
  };
}

// A bare trend line with no axis, dots, or labels -- for the small stat-box
// sparklines, distinct from the full LineChart used for hero-style charts.
export function MiniSparkline({
  points,
  color,
  width = 90,
  height = 24,
}: {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return <View style={{ width, height }} />;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords: Point[] = points.map((p, i) => ({
    x: i * stepX,
    y: height - ((p - min) / range) * height,
  }));

  return (
    <View style={{ width, height }}>
      {coords.slice(1).map((c, i) => (
        <View key={i} style={segmentStyle(coords[i], c, color)} />
      ))}
    </View>
  );
}
