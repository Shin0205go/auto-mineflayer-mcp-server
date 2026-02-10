/**
 * Task Management Tools for Game Agent
 * Provides TaskCreate, TaskList, TaskUpdate, TaskGet functionality via MCP
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const TASKS_FILE = path.join(process.cwd(), "learning", "tasks.json");

export interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  owner?: string;
  blockedBy?: string[];
  blocks?: string[];
}

interface TasksData {
  tasks: Task[];
  version: number;
}

// Load tasks from file
async function loadTasks(): Promise<TasksData> {
  try {
    const data = await fs.readFile(TASKS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    // File doesn't exist, return empty
    return { tasks: [], version: 1 };
  }
}

// Save tasks to file
async function saveTasks(data: TasksData): Promise<void> {
  await fs.mkdir(path.dirname(TASKS_FILE), { recursive: true });
  await fs.writeFile(TASKS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * TaskCreate - Create a new task
 */
export async function taskCreate(params: {
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, any>;
}): Promise<string> {
  const data = await loadTasks();

  const task: Task = {
    id: randomUUID().substring(0, 8),
    subject: params.subject,
    description: params.description,
    activeForm: params.activeForm,
    status: "pending",
    metadata: params.metadata,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.tasks.push(task);
  data.version++;

  await saveTasks(data);

  return JSON.stringify({
    success: true,
    taskId: task.id,
    message: `Task created: ${task.subject}`,
  });
}

/**
 * TaskList - List all tasks (filtered by status if needed)
 */
export async function taskList(params?: {
  status?: "pending" | "in_progress" | "completed";
}): Promise<string> {
  const data = await loadTasks();

  let tasks = data.tasks.filter(t => t.status !== "deleted");

  if (params?.status) {
    tasks = tasks.filter(t => t.status === params.status);
  }

  if (tasks.length === 0) {
    return "No tasks found";
  }

  const summary = tasks.map(t => ({
    id: t.id,
    subject: t.subject,
    status: t.status,
    owner: t.owner || "",
    blockedBy: t.blockedBy || [],
  }));

  return JSON.stringify(summary, null, 2);
}

/**
 * TaskGet - Get detailed info about a specific task
 */
export async function taskGet(params: { taskId: string }): Promise<string> {
  const data = await loadTasks();

  const task = data.tasks.find(t => t.id === params.taskId);

  if (!task || task.status === "deleted") {
    return JSON.stringify({ error: "Task not found" });
  }

  return JSON.stringify(task, null, 2);
}

/**
 * TaskUpdate - Update task status or metadata
 */
export async function taskUpdate(params: {
  taskId: string;
  status?: "pending" | "in_progress" | "completed" | "deleted";
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  metadata?: Record<string, any>;
  addBlocks?: string[];
  addBlockedBy?: string[];
}): Promise<string> {
  const data = await loadTasks();

  const task = data.tasks.find(t => t.id === params.taskId);

  if (!task) {
    return JSON.stringify({ error: "Task not found" });
  }

  // Update fields
  if (params.status) task.status = params.status;
  if (params.subject) task.subject = params.subject;
  if (params.description) task.description = params.description;
  if (params.activeForm) task.activeForm = params.activeForm;
  if (params.owner !== undefined) task.owner = params.owner;

  // Merge metadata
  if (params.metadata) {
    task.metadata = { ...task.metadata, ...params.metadata };
  }

  // Add blocks/blockedBy
  if (params.addBlocks) {
    task.blocks = [...(task.blocks || []), ...params.addBlocks];
  }
  if (params.addBlockedBy) {
    task.blockedBy = [...(task.blockedBy || []), ...params.addBlockedBy];
  }

  task.updatedAt = Date.now();
  data.version++;

  await saveTasks(data);

  return JSON.stringify({
    success: true,
    message: `Task updated: ${task.subject}`,
    task: {
      id: task.id,
      subject: task.subject,
      status: task.status,
    },
  });
}

// MCP Tool Definitions
export const TASK_MANAGEMENT_TOOLS = [
  {
    name: "task_create",
    description: "Create a new task. Tasks help organize and track progress toward goals.",
    inputSchema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Brief task title (e.g., 'Gather 8+ food items')",
        },
        description: {
          type: "string",
          description: "Detailed description of what needs to be done",
        },
        activeForm: {
          type: "string",
          description: "Present continuous form shown when in_progress (e.g., 'Gathering food')",
        },
        metadata: {
          type: "object",
          description: "Optional metadata (phase, priority, target, etc.)",
        },
      },
      required: ["subject", "description"],
    },
  },
  {
    name: "task_list",
    description: "List all tasks, optionally filtered by status",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed"],
          description: "Filter by task status",
        },
      },
    },
  },
  {
    name: "task_get",
    description: "Get detailed information about a specific task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID to retrieve",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "task_update",
    description: "Update a task's status, metadata, or dependencies",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID to update",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "deleted"],
          description: "New status",
        },
        subject: {
          type: "string",
          description: "New subject",
        },
        description: {
          type: "string",
          description: "New description",
        },
        activeForm: {
          type: "string",
          description: "New activeForm",
        },
        owner: {
          type: "string",
          description: "Assign task to owner",
        },
        metadata: {
          type: "object",
          description: "Metadata to merge",
        },
        addBlocks: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs that this task blocks",
        },
        addBlockedBy: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs that block this task",
        },
      },
      required: ["taskId"],
    },
  },
];
