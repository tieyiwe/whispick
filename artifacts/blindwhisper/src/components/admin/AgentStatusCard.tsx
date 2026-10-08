import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, Zap } from "lucide-react";

interface AgentStatus {
  lastRunAt?: string | null;
  lastRunOk: boolean;
  lastErrorMessage?: string | null;
  lowCreditSuspected: boolean;
  consecutiveFailures: number;
}

// Shared between AdminDebateAgent and AdminCircleAgent — same status-banner
// shape and copy pattern as AdminSuggestions.tsx's AgentStatusBanner (the
// Suggestions Library discovery agent), just parameterized on which agent
// it's reporting on.
export function AgentStatusCard({
  agentLabel,
  status,
  onRunNow,
  runPending,
}: {
  agentLabel: string;
  status: AgentStatus | undefined;
  onRunNow: () => void;
  runPending: boolean;
}) {
  const runNowButton = (
    <Button size="sm" variant="outline" className="rounded-full shrink-0" onClick={onRunNow} disabled={runPending} data-testid="button-run-agent-now">
      {runPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
      Run now
    </Button>
  );

  if (!status?.lastRunAt) {
    return (
      <Card className="bg-card border-border/50" data-testid="agent-status-card-never-run">
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground">
            {agentLabel} hasn't run yet — it checks automatically on schedule, or you can trigger it now.
          </p>
          {runNowButton}
        </CardContent>
      </Card>
    );
  }

  if (!status.lastRunOk) {
    return (
      <Card
        className={status.lowCreditSuspected ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"}
        data-testid="agent-status-card-error"
      >
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${status.lowCreditSuspected ? "text-destructive" : "text-amber-400"}`} />
            <div>
              <p className={`text-sm font-medium ${status.lowCreditSuspected ? "text-destructive" : "text-amber-400"}`}>
                {status.lowCreditSuspected
                  ? `${agentLabel} stopped — your Anthropic credit balance looks too low`
                  : `The last ${agentLabel} run failed`}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {status.lowCreditSuspected
                  ? "Add credits in your Anthropic Console, then run it again."
                  : status.lastErrorMessage ?? "Check the server logs for details."}
                {status.consecutiveFailures > 1 && ` · Failed ${status.consecutiveFailures} times in a row.`}
              </p>
            </div>
          </div>
          {runNowButton}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border/50" data-testid="agent-status-card-ok">
      <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {agentLabel} last ran {new Date(status.lastRunAt).toLocaleString()} — looking healthy.
        </p>
        {runNowButton}
      </CardContent>
    </Card>
  );
}
