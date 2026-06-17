import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { startTaskScheduler } from "~/lib/tasks/scheduler";
import {
  createTask as createTaskInStore,
  deleteTask as deleteTaskInStore,
  getTasksSnapshot,
  subscribeTasks,
  updateTask as updateTaskInStore,
} from "~/lib/tasks/tasks-store";
import type { CreateScheduledTaskInput, ScheduledTask } from "~/lib/tasks/types";

export { buildOverview } from "~/lib/tasks/scheduler";
export type {
  CreateScheduledTaskInput,
  ScheduledJobsOverview,
  ScheduledTask,
  ScheduledTaskRun,
  UpdateScheduledTaskInput,
} from "~/lib/tasks/types";

export type UseTasks = {
  /** Newest-created-first; referentially stable between mutations. */
  tasks: ScheduledTask[];
  createTask: (input: CreateScheduledTaskInput) => ScheduledTask;
  updateTask: (
    id: string,
    input: { title?: string; instruction?: string; isEnabled?: boolean },
  ) => ScheduledTask | null;
  removeTask: (id: string) => void;
};

/**
 * Live view of the localStorage scheduled-task store. Backed by
 * useSyncExternalStore so the board updates the instant the ticker mutates a
 * run. Also (idempotently) boots the client-side scheduler ticker on mount so
 * due tasks fire regardless of whether the board is open.
 */
export function useTasks(): UseTasks {
  const tasks = useSyncExternalStore(subscribeTasks, getTasksSnapshot, getTasksSnapshot);

  // Boot the scheduler exactly once per tab — fires run on a heartbeat as long
  // as the app is mounted somewhere.
  useEffect(() => {
    startTaskScheduler();
  }, []);

  const createTask = useCallback((input: CreateScheduledTaskInput) => createTaskInStore(input), []);
  const updateTask = useCallback(
    (id: string, input: { title?: string; instruction?: string; isEnabled?: boolean }) =>
      updateTaskInStore(id, input),
    [],
  );
  const removeTask = useCallback((id: string) => deleteTaskInStore(id), []);

  return { tasks, createTask, updateTask, removeTask };
}

/** Navigate to a task's home chat session (no-op when the task is standalone). */
export function useGoToTranscript() {
  const navigate = useNavigate();
  return useCallback(
    (homeSessionId: string | null) => {
      if (!homeSessionId) {
        return;
      }
      void navigate({ to: "/chat/$sessionId", params: { sessionId: homeSessionId } });
    },
    [navigate],
  );
}
