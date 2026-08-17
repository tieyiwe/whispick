import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type TrendPoint = { day: string; count: number };

const chartConfig = {
  count: { label: "Count", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

export function TrendAreaChart({ data, valueLabel = "Count" }: { data: TrendPoint[]; valueLabel?: string }) {
  if (!data.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No activity in this period yet.</p>;
  }

  return (
    <ChartContainer config={{ count: { ...chartConfig.count, label: valueLabel } }} className="w-full aspect-auto h-40">
      <AreaChart data={data} margin={{ left: 0, right: 0, top: 8 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.3} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v.slice(5)}
          tick={{ fontSize: 11 }}
          minTickGap={24}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area type="monotone" dataKey="count" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#trendFill)" />
      </AreaChart>
    </ChartContainer>
  );
}
