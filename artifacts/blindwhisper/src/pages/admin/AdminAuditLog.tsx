import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useAdminListAuditLog, getAdminListAuditLogQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, ScrollText, Code2 } from "lucide-react";

const PAGE_SIZE = 25;

function actionLabel(action: string): string {
  return action.replace(/[._]/g, " ");
}

export function AdminAuditLog() {
  const [adminUserId, setAdminUserId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [page, setPage] = useState(1);

  const params = {
    ...(adminUserId.trim() ? { adminUserId: adminUserId.trim() } : {}),
    ...(targetType.trim() ? { targetType: targetType.trim() } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading } = useAdminListAuditLog(params, {
    query: { queryKey: getAdminListAuditLogQueryKey(params) },
  });

  const hasMore = (data?.items.length ?? 0) === PAGE_SIZE;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <ScrollText className="w-7 h-7 text-primary" /> Audit Log
          </h1>
          <p className="text-muted-foreground mt-1">Every sensitive admin action — who took it, on what, and when.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Filter by admin user ID..."
            value={adminUserId}
            onChange={(e) => { setAdminUserId(e.target.value); setPage(1); }}
            className="bg-card border-border/50 rounded-full"
            data-testid="input-audit-filter-admin"
          />
          <Input
            placeholder="Filter by target type (e.g. user, whisp)..."
            value={targetType}
            onChange={(e) => { setTargetType(e.target.value); setPage(1); }}
            className="bg-card border-border/50 rounded-full"
            data-testid="input-audit-filter-target-type"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
          </div>
        ) : data?.items.length ? (
          <div className="space-y-2">
            {data.items.map((entry) => (
              <Card key={entry.id} className="bg-card border-border/50" data-testid={`audit-log-row-${entry.id}`}>
                <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                  <Badge variant="outline" className="capitalize shrink-0">{actionLabel(entry.action)}</Badge>
                  <div className="flex-1 min-w-[160px] text-sm">
                    <span className="text-foreground">
                      {entry.targetType ? `${entry.targetType}${entry.targetId ? ` · ${entry.targetId}` : ""}` : "—"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground w-40 truncate" title={entry.adminUserId}>
                    by {entry.adminUserId}
                  </span>
                  <span className="text-xs text-muted-foreground w-36 shrink-0">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  {entry.metadata != null && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground shrink-0" data-testid={`button-audit-metadata-${entry.id}`}>
                          <Code2 className="w-3.5 h-3.5 mr-1" /> Details
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-96 max-w-[90vw]">
                        <pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                          {JSON.stringify(entry.metadata, null, 2)}
                        </pre>
                      </PopoverContent>
                    </Popover>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">No audit log entries match those filters.</p>
          </Card>
        )}

        {(page > 1 || hasMore) && (
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" className="rounded-full" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
            </Button>
            <span className="text-sm text-muted-foreground">Page {page}</span>
            <Button variant="outline" size="sm" className="rounded-full" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
