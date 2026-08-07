import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type BarDatum = { label: string; value: number };

const chartConfig = {
  value: { label: "Count", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

// Single-hue horizontal ranked bar list — every use here is "compare
// magnitude across named entities", not multi-series identity, so one hue
// with direct labels needs no color legend.
export function RankedBarChart({ data, valueLabel = "Count" }: { data: BarDatum[]; valueLabel?: string }) {
  if (!data.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No data yet.</p>;
  }

  const height = Math.max(120, data.length * 36);

  return (
    <ChartContainer config={{ value: { ...chartConfig.value, label: valueLabel } }} className="w-full aspect-auto" style={{ height }}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12 }}>
        <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
          interval={0}
        />
        <ChartTooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}
