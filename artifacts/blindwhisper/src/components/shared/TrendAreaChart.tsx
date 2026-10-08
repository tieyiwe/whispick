import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type TrendPoint = { day: string; count: number };

export function TrendAreaChart({ data, valueLabel }: { data: TrendPoint[]; valueLabel?: string }) {
  const { t } = useTranslation("sharedB");
  const resolvedValueLabel = valueLabel ?? t("trendAreaChart.count");
  const chartConfig = {
    count: { label: resolvedValueLabel, color: "hsl(var(--chart-1))" },
  } satisfies ChartConfig;

  if (!data.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{t("trendAreaChart.noActivityYet")}</p>;
  }

  return (
    <ChartContainer config={{ count: { ...chartConfig.count, label: resolvedValueLabel } }} className="w-full aspect-auto h-40">
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
