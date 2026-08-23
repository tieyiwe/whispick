import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminListProjects,
  useAdminCreateProject,
  useAdminUpdateProject,
  useAdminGetProject,
  useAdminCreateTask,
  useAdminUpdateTask,
  useAdminDeleteTask,
  useAdminListTaskComments,
  useAdminAddTaskComment,
  type HqTask,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  KanbanSquare,
  Plus,
  Loader2,
  ArrowLeft,
  Archive,
  MessageSquare,
  Trash2,
  CircleDashed,
  CircleDot,
  CheckCircle2,
  CalendarDays,
} from "lucide-react";

const STATUS_COLUMNS = [
  { key: "todo", label: "To do", icon: CircleDashed },
  { key: "in_progress", label: "In progress", icon: CircleDot },
  { key: "done", label: "Done", icon: CheckCircle2 },
] as const;

const NEXT_STATUS: Record<string, "in_progress" | "done" | "todo"> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

function CommentsDialog({ task, onClose }: { task: HqTask; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAdminListTaskComments(task.id);
  const addComment = useAdminAddTaskComment();
  const [body, setBody] = useState("");

  function handleAdd() {
    if (!body.trim()) return;
    addComment.mutate(
      { id: task.id, data: { body: body.trim() } },
      {
        onSuccess: () => {
          setBody("");
          void queryClient.invalidateQueries({ queryKey: [`/api/admin/tasks/${task.id}/comments`] });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't add comment", variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{task.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-16 rounded-xl" />
          ) : data?.items.length ? (
            data.items.map((c) => (
              <div key={c.id} className="rounded-xl border border-border/50 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">{c.authorEmail ?? "Staff"} · {new Date(c.createdAt).toLocaleString()}</p>
                <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">{c.body}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          )}
        </div>
        <div className="flex items-start gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 2000))}
            rows={2}
            placeholder="Write a comment..."
            className="rounded-xl resize-none"
            data-testid="input-task-comment"
          />
          <Button size="sm" className="rounded-full shrink-0" onClick={handleAdd} disabled={addComment.isPending || !body.trim()}>
            {addComment.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Send"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The HQ workspace: projects on the left of the flow, a three-column task
// board per project, assignment (with in-app notification to the assignee),
// due dates, and per-task comment threads. Every staff role preset includes
// the "projects" permission — this is where the team coordinates.
export function AdminProjects() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState<string>("none");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [commentsTask, setCommentsTask] = useState<HqTask | null>(null);

  const { data: projectsData, isLoading } = useAdminListProjects();
  const { data: project } = useAdminGetProject(selectedId ?? "", { query: { enabled: !!selectedId } } as any);
  const createProject = useAdminCreateProject();
  const updateProject = useAdminUpdateProject();
  const createTask = useAdminCreateTask();
  const updateTask = useAdminUpdateTask();
  const deleteTask = useAdminDeleteTask();

  function refreshProjects() {
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/projects"] });
  }
  function refreshProject() {
    if (selectedId) void queryClient.invalidateQueries({ queryKey: [`/api/admin/projects/${selectedId}`] });
    refreshProjects();
  }

  function handleCreateProject() {
    if (!newProjectName.trim()) return;
    createProject.mutate(
      { data: { name: newProjectName.trim() } },
      {
        onSuccess: (p) => {
          setNewProjectName("");
          refreshProjects();
          setSelectedId(p.id);
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't create project", variant: "destructive" }),
      },
    );
  }

  function handleCreateTask() {
    if (!selectedId || !newTaskTitle.trim()) return;
    createTask.mutate(
      {
        id: selectedId,
        data: {
          title: newTaskTitle.trim(),
          assigneeAdminId: newTaskAssignee !== "none" ? newTaskAssignee : null,
          dueAt: newTaskDue ? new Date(newTaskDue).toISOString() : null,
        },
      },
      {
        onSuccess: () => {
          setNewTaskTitle("");
          setNewTaskDue("");
          refreshProject();
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't add task", variant: "destructive" }),
      },
    );
  }

  const projects = projectsData?.items ?? [];
  const staff = project?.staff ?? projectsData?.staff ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <KanbanSquare className="w-7 h-7 text-primary" /> Projects
          </h1>
          <p className="text-muted-foreground mt-1">
            The team's workspace — plan the business, assign tasks to staff, track them to done. Assignees
            are notified in-app.
          </p>
        </div>

        {!selectedId ? (
          <>
            <div className="flex gap-2">
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value.slice(0, 120))}
                placeholder="New project name..."
                className="bg-input/50 border-border/50 rounded-xl max-w-sm"
                data-testid="input-new-project"
              />
              <Button className="rounded-full" onClick={handleCreateProject} disabled={!newProjectName.trim() || createProject.isPending}>
                {createProject.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Create
              </Button>
            </div>

            {isLoading ? (
              <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
            ) : projects.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    data-testid={`project-card-${p.id}`}
                    className={`text-left rounded-2xl border p-4 transition-all hover:border-primary/50 ${
                      p.status === "archived" ? "border-border/30 bg-card/40 opacity-70" : "border-border/50 bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-foreground truncate">{p.name}</p>
                      {p.status === "archived" && <Badge variant="outline" className="shrink-0">Archived</Badge>}
                    </div>
                    {p.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
                    <p className="text-xs text-muted-foreground mt-2">
                      {p.openTasks ?? 0} open · {p.doneTasks ?? 0} done
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <Card className="bg-card/50 border-dashed border-border py-16 text-center">
                <p className="text-muted-foreground">No projects yet — create the first one above.</p>
              </Card>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Button variant="ghost" size="sm" className="rounded-full -ml-2" onClick={() => setSelectedId(null)}>
                <ArrowLeft className="w-4 h-4 mr-1.5" /> All projects
              </Button>
              {project && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={updateProject.isPending}
                  onClick={() =>
                    updateProject.mutate(
                      { id: project.id, data: { status: project.status === "archived" ? "active" : "archived" } },
                      { onSuccess: refreshProject },
                    )
                  }
                >
                  <Archive className="w-3.5 h-3.5 mr-1.5" /> {project.status === "archived" ? "Unarchive" : "Archive"}
                </Button>
              )}
            </div>

            {project ? (
              <>
                <div>
                  <h2 className="text-2xl font-serif font-bold text-foreground">{project.name}</h2>
                  {project.description && <p className="text-muted-foreground mt-1">{project.description}</p>}
                </div>

                <Card className="bg-card border-border/50">
                  <CardContent className="p-4 flex flex-col sm:flex-row gap-2">
                    <Input
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value.slice(0, 200))}
                      placeholder="Add a task..."
                      className="bg-input/50 border-border/50 rounded-xl flex-1"
                      data-testid="input-new-task"
                    />
                    <Select value={newTaskAssignee} onValueChange={setNewTaskAssignee}>
                      <SelectTrigger className="bg-input/50 border-border/50 rounded-xl w-full sm:w-52"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {staff.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.email} · {s.roleTitle}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="date"
                      value={newTaskDue}
                      onChange={(e) => setNewTaskDue(e.target.value)}
                      className="bg-input/50 border-border/50 rounded-xl w-full sm:w-40"
                    />
                    <Button className="rounded-full shrink-0" onClick={handleCreateTask} disabled={!newTaskTitle.trim() || createTask.isPending}>
                      {createTask.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    </Button>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {STATUS_COLUMNS.map((col) => {
                    const Icon = col.icon;
                    const tasks = (project.tasks ?? []).filter((t) => t.status === col.key);
                    return (
                      <div key={col.key} className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5" /> {col.label} · {tasks.length}
                        </p>
                        {tasks.map((t) => (
                          <Card key={t.id} className={`border ${t.status === "done" ? "bg-card/50 border-border/30 opacity-80" : "bg-card border-border/50"}`} data-testid={`task-card-${t.id}`}>
                            <CardContent className="p-3 space-y-2">
                              <p className={`text-sm font-medium ${t.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}>{t.title}</p>
                              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                                {t.assigneeEmail && <Badge variant="outline" className="text-xs">{t.assigneeEmail}</Badge>}
                                {t.dueAt && (
                                  <span className={`inline-flex items-center gap-1 ${new Date(t.dueAt) < new Date() && t.status !== "done" ? "text-destructive" : ""}`}>
                                    <CalendarDays className="w-3 h-3" /> {new Date(t.dueAt).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full h-7 text-xs"
                                  disabled={updateTask.isPending}
                                  onClick={() => updateTask.mutate({ id: t.id, data: { status: NEXT_STATUS[t.status] } }, { onSuccess: refreshProject })}
                                  data-testid={`button-advance-${t.id}`}
                                >
                                  {t.status === "todo" ? "Start" : t.status === "in_progress" ? "Mark done" : "Reopen"}
                                </Button>
                                <Button size="sm" variant="ghost" className="rounded-full h-7 text-xs" onClick={() => setCommentsTask(t)}>
                                  <MessageSquare className="w-3 h-3 mr-1" /> {t.commentCount ?? 0}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="rounded-full h-7 text-muted-foreground hover:text-destructive ml-auto"
                                  disabled={deleteTask.isPending}
                                  onClick={() => deleteTask.mutate({ id: t.id }, { onSuccess: refreshProject })}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                        {tasks.length === 0 && (
                          <div className="rounded-xl border border-dashed border-border/50 py-6 text-center text-xs text-muted-foreground">
                            Nothing here
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <Skeleton className="h-60 rounded-2xl" />
            )}
          </>
        )}
      </div>

      {commentsTask && <CommentsDialog task={commentsTask} onClose={() => { setCommentsTask(null); refreshProject(); }} />}
    </AdminLayout>
  );
}
