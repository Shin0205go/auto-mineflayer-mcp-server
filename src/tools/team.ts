/**
 * Agent Teams - チーム協調ツール
 *
 * Claude Code Agent Teams の概念をMinecraftエージェントに適用:
 * - チーム管理: リード/メンバーの役割分担
 * - タスクリスト: 依存関係付き共有タスク管理
 * - メールボックス: エージェント間ダイレクトメッセージ
 *
 * データは teams/ ディレクトリにJSON形式で永続化される。
 */

import * as fs from "fs";
import * as path from "path";

// ===== Types =====

export interface TeamMember {
  name: string;
  role: "lead" | "member";
  joinedAt: number;
  status: "active" | "idle" | "shutdown";
}

export interface Team {
  name: string;
  createdAt: number;
  lead: string;
  members: TeamMember[];
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface TeamTask {
  id: string;
  teamName: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  dependsOn: string[]; // task IDs
  result?: string;
}

export interface TeamMessage {
  id: string;
  teamName: string;
  from: string;
  to: string | "all"; // specific agent or broadcast
  content: string;
  timestamp: number;
  read: boolean;
}

// ===== Storage =====

const TEAMS_DIR = path.join(process.cwd(), "teams");

function ensureTeamsDir(): void {
  if (!fs.existsSync(TEAMS_DIR)) {
    fs.mkdirSync(TEAMS_DIR, { recursive: true });
  }
}

function getTeamDir(teamName: string): string {
  return path.join(TEAMS_DIR, teamName);
}

function ensureTeamDir(teamName: string): void {
  ensureTeamsDir();
  const dir = getTeamDir(teamName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ===== Team Config =====

function loadTeam(teamName: string): Team | null {
  const configPath = path.join(getTeamDir(teamName), "config.json");
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function saveTeam(team: Team): void {
  ensureTeamDir(team.name);
  const configPath = path.join(getTeamDir(team.name), "config.json");
  fs.writeFileSync(configPath, JSON.stringify(team, null, 2));
}

function listAllTeams(): string[] {
  ensureTeamsDir();
  if (!fs.existsSync(TEAMS_DIR)) return [];
  return fs.readdirSync(TEAMS_DIR).filter(name => {
    const configPath = path.join(TEAMS_DIR, name, "config.json");
    return fs.existsSync(configPath);
  });
}

// ===== Task Storage =====

function loadTasks(teamName: string): TeamTask[] {
  const tasksPath = path.join(getTeamDir(teamName), "tasks.json");
  if (!fs.existsSync(tasksPath)) return [];
  return JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
}

function saveTasks(teamName: string, tasks: TeamTask[]): void {
  ensureTeamDir(teamName);
  const tasksPath = path.join(getTeamDir(teamName), "tasks.json");
  fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
}

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ===== Message Storage =====

function loadMessages(teamName: string): TeamMessage[] {
  const msgsPath = path.join(getTeamDir(teamName), "messages.json");
  if (!fs.existsSync(msgsPath)) return [];
  return JSON.parse(fs.readFileSync(msgsPath, "utf-8"));
}

function saveMessages(teamName: string, messages: TeamMessage[]): void {
  ensureTeamDir(teamName);
  const msgsPath = path.join(getTeamDir(teamName), "messages.json");
  fs.writeFileSync(msgsPath, JSON.stringify(messages, null, 2));
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ===== Lock for task claiming (prevent race conditions) =====

const claimLocks = new Map<string, boolean>();

function acquireClaimLock(taskId: string): boolean {
  if (claimLocks.get(taskId)) return false;
  claimLocks.set(taskId, true);
  return true;
}

function releaseClaimLock(taskId: string): void {
  claimLocks.delete(taskId);
}

// ===== Tool Definitions =====

export const teamTools = {
  // --- Team Management ---
  team_create: {
    description: "新しいエージェントチームを作成する。作成者がリードになる。チームメイトは独立して作業し、タスクリストとメッセージで協調する。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "チーム名（英数字とハイフン）",
        },
        agent_name: {
          type: "string",
          description: "リードエージェント名",
        },
        description: {
          type: "string",
          description: "チームの目的・ミッション（任意）",
        },
      },
      required: ["team_name", "agent_name"],
    },
  },

  team_join: {
    description: "既存のチームにメンバーとして参加する。参加後はタスクの自己取得やメッセージの送受信が可能。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "参加するチーム名",
        },
        agent_name: {
          type: "string",
          description: "自分のエージェント名",
        },
      },
      required: ["team_name", "agent_name"],
    },
  },

  team_leave: {
    description: "チームから離脱する。担当中のタスクは未割り当てに戻る。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "離脱するチーム名",
        },
        agent_name: {
          type: "string",
          description: "自分のエージェント名",
        },
      },
      required: ["team_name", "agent_name"],
    },
  },

  team_list: {
    description: "全チームの一覧、またはチームの詳細情報（メンバー・タスク状況）を表示する。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "詳細を見るチーム名（省略で全チーム一覧）",
        },
      },
      required: [],
    },
  },

  team_dissolve: {
    description: "チームを解散する。リードのみ実行可能。全メンバーが離脱済みである必要がある。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "解散するチーム名",
        },
        agent_name: {
          type: "string",
          description: "リードエージェント名（認証用）",
        },
      },
      required: ["team_name", "agent_name"],
    },
  },

  // --- Task Management ---
  team_task_create: {
    description: "チームの共有タスクリストに新しいタスクを追加する。依存関係を設定すると、依存タスク完了まで着手不可になる。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "チーム名",
        },
        title: {
          type: "string",
          description: "タスクのタイトル",
        },
        description: {
          type: "string",
          description: "タスクの詳細説明（任意）",
        },
        created_by: {
          type: "string",
          description: "作成者のエージェント名",
        },
        depends_on: {
          type: "array",
          items: { type: "string" },
          description: "依存するタスクIDのリスト（任意）",
        },
        assignee: {
          type: "string",
          description: "担当者を指定（任意。省略で未割り当て）",
        },
      },
      required: ["team_name", "title", "created_by"],
    },
  },

  team_task_claim: {
    description: "未割り当てのタスクを自分が担当する。依存タスクが未完了のタスクは取得できない。ロックベースで競合を防止。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "チーム名",
        },
        task_id: {
          type: "string",
          description: "取得するタスクID（省略で次の未割り当てタスクを自動取得）",
        },
        agent_name: {
          type: "string",
          description: "自分のエージェント名",
        },
      },
      required: ["team_name", "agent_name"],
    },
  },

  team_task_complete: {
    description: "担当タスクを完了にする。結果メッセージを残せる。依存しているタスクが自動的にブロック解除される。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "チーム名",
        },
        task_id: {
          type: "string",
          description: "完了するタスクID",
        },
        agent_name: {
          type: "string",
          description: "自分のエージェント名",
        },
        result: {
          type: "string",
          description: "タスクの結果・成果物の説明（任意）",
        },
      },
      required: ["team_name", "task_id", "agent_name"],
    },
  },

  team_task_list: {
    description: "チームのタスクリストを表示する。状態でフィルタ可能。依存関係やブロック状態も表示。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "チーム名",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "blocked", "all"],
          description: "フィルタする状態（省略でall）",
        },
        assignee: {
          type: "string",
          description: "特定のエージェントの担当タスクだけ表示",
        },
      },
      required: ["team_name"],
    },
  },

  team_task_update: {
    description: "タスクの状態や担当者を更新する。リードは任意のタスクを更新可能。メンバーは自分の担当タスクのみ。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "チーム名",
        },
        task_id: {
          type: "string",
          description: "更新するタスクID",
        },
        agent_name: {
          type: "string",
          description: "自分のエージェント名",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "blocked"],
          description: "新しい状態",
        },
        assignee: {
          type: "string",
          description: "新しい担当者（リードのみ変更可能）",
        },
      },
      required: ["team_name", "task_id", "agent_name"],
    },
  },

  // --- Messaging ---
  team_message_send: {
    description: "チームメンバーにダイレクトメッセージを送る。掲示板と違い、特定のエージェントに直接届く。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "チーム名",
        },
        from: {
          type: "string",
          description: "送信者のエージェント名",
        },
        to: {
          type: "string",
          description: "宛先エージェント名",
        },
        content: {
          type: "string",
          description: "メッセージ内容",
        },
      },
      required: ["team_name", "from", "to", "content"],
    },
  },

  team_message_broadcast: {
    description: "チーム全員にメッセージをブロードキャストする。重要な共有情報や全体への指示に使用。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "チーム名",
        },
        from: {
          type: "string",
          description: "送信者のエージェント名",
        },
        content: {
          type: "string",
          description: "メッセージ内容",
        },
      },
      required: ["team_name", "from", "content"],
    },
  },

  team_message_read: {
    description: "自分宛のメッセージを読む。未読のみ、または全メッセージを取得可能。",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "チーム名",
        },
        agent_name: {
          type: "string",
          description: "自分のエージェント名",
        },
        unread_only: {
          type: "boolean",
          description: "未読のみ取得（デフォルト: true）",
        },
        mark_as_read: {
          type: "boolean",
          description: "取得時に既読にする（デフォルト: true）",
        },
      },
      required: ["team_name", "agent_name"],
    },
  },
};

// ===== Tool Handlers =====

export async function handleTeamTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    // --- Team Management ---
    case "team_create": {
      const teamName = args.team_name as string;
      const agentName = args.agent_name as string;

      if (!teamName || !agentName) {
        throw new Error("team_name と agent_name は必須です");
      }

      // Validate team name
      if (!/^[a-zA-Z0-9_-]+$/.test(teamName)) {
        throw new Error("チーム名は英数字、ハイフン、アンダースコアのみ使用可能です");
      }

      // Check if team already exists
      if (loadTeam(teamName)) {
        throw new Error(`チーム '${teamName}' は既に存在します`);
      }

      const team: Team = {
        name: teamName,
        createdAt: Date.now(),
        lead: agentName,
        members: [
          {
            name: agentName,
            role: "lead",
            joinedAt: Date.now(),
            status: "active",
          },
        ],
      };

      saveTeam(team);
      // Initialize empty tasks and messages
      saveTasks(teamName, []);
      saveMessages(teamName, []);

      const desc = args.description ? ` ミッション: ${args.description}` : "";
      return `チーム '${teamName}' を作成しました。リード: ${agentName}${desc}\n` +
        `チームメイトは team_join で参加できます。`;
    }

    case "team_join": {
      const teamName = args.team_name as string;
      const agentName = args.agent_name as string;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      // Check if already a member
      if (team.members.some(m => m.name === agentName)) {
        // Update status to active
        const member = team.members.find(m => m.name === agentName)!;
        member.status = "active";
        saveTeam(team);
        return `${agentName} はチーム '${teamName}' に再接続しました（ステータス: active）`;
      }

      team.members.push({
        name: agentName,
        role: "member",
        joinedAt: Date.now(),
        status: "active",
      });

      saveTeam(team);

      // Send system message to mailbox
      const messages = loadMessages(teamName);
      messages.push({
        id: generateMessageId(),
        teamName,
        from: "system",
        to: "all",
        content: `${agentName} がチームに参加しました`,
        timestamp: Date.now(),
        read: false,
      });
      saveMessages(teamName, messages);

      return `${agentName} がチーム '${teamName}' に参加しました。` +
        `\nリード: ${team.lead}` +
        `\nメンバー: ${team.members.map(m => `${m.name}(${m.role})`).join(", ")}`;
    }

    case "team_leave": {
      const teamName = args.team_name as string;
      const agentName = args.agent_name as string;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      if (agentName === team.lead) {
        throw new Error("リードはチームから離脱できません。team_dissolve で解散してください。");
      }

      const memberIndex = team.members.findIndex(m => m.name === agentName);
      if (memberIndex === -1) {
        throw new Error(`${agentName} はチーム '${teamName}' のメンバーではありません`);
      }

      team.members.splice(memberIndex, 1);

      // Unassign tasks from this member
      const tasks = loadTasks(teamName);
      let unassignedCount = 0;
      for (const task of tasks) {
        if (task.assignee === agentName && task.status === "in_progress") {
          task.assignee = undefined;
          task.status = "pending";
          task.updatedAt = Date.now();
          unassignedCount++;
        }
      }
      saveTasks(teamName, tasks);
      saveTeam(team);

      // Notify team
      const messages = loadMessages(teamName);
      messages.push({
        id: generateMessageId(),
        teamName,
        from: "system",
        to: "all",
        content: `${agentName} がチームから離脱しました（${unassignedCount}件のタスクが未割り当てに）`,
        timestamp: Date.now(),
        read: false,
      });
      saveMessages(teamName, messages);

      return `${agentName} がチーム '${teamName}' から離脱しました。` +
        (unassignedCount > 0 ? `\n${unassignedCount}件の担当タスクが未割り当てに戻りました。` : "");
    }

    case "team_list": {
      const teamName = args.team_name as string | undefined;

      if (teamName) {
        const team = loadTeam(teamName);
        if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

        const tasks = loadTasks(teamName);
        const taskSummary = {
          total: tasks.length,
          pending: tasks.filter(t => t.status === "pending").length,
          in_progress: tasks.filter(t => t.status === "in_progress").length,
          completed: tasks.filter(t => t.status === "completed").length,
          blocked: tasks.filter(t => t.status === "blocked").length,
        };

        const lines: string[] = [
          `=== チーム: ${team.name} ===`,
          `作成日時: ${new Date(team.createdAt).toLocaleString("ja-JP")}`,
          `リード: ${team.lead}`,
          ``,
          `--- メンバー ---`,
          ...team.members.map(m => `  ${m.name} (${m.role}, ${m.status})`),
          ``,
          `--- タスク概要 ---`,
          `  合計: ${taskSummary.total}`,
          `  未着手: ${taskSummary.pending}`,
          `  進行中: ${taskSummary.in_progress}`,
          `  完了: ${taskSummary.completed}`,
          `  ブロック: ${taskSummary.blocked}`,
        ];

        return lines.join("\n");
      }

      // List all teams
      const teamNames = listAllTeams();
      if (teamNames.length === 0) {
        return "チームはまだありません。team_create で作成してください。";
      }

      const lines: string[] = ["=== 全チーム一覧 ==="];
      for (const name of teamNames) {
        const team = loadTeam(name);
        if (!team) continue;
        const tasks = loadTasks(name);
        const activeTasks = tasks.filter(t => t.status !== "completed").length;
        lines.push(
          `  ${name}: リード=${team.lead}, メンバー${team.members.length}名, 残タスク${activeTasks}件`
        );
      }

      return lines.join("\n");
    }

    case "team_dissolve": {
      const teamName = args.team_name as string;
      const agentName = args.agent_name as string;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      if (team.lead !== agentName) {
        throw new Error(`チームの解散はリード (${team.lead}) のみ実行可能です`);
      }

      const activeMembers = team.members.filter(
        m => m.name !== agentName && m.status === "active"
      );
      if (activeMembers.length > 0) {
        throw new Error(
          `アクティブなメンバーがいます: ${activeMembers.map(m => m.name).join(", ")}。` +
          `全員が離脱してから解散してください。`
        );
      }

      // Remove team directory
      const teamDir = getTeamDir(teamName);
      fs.rmSync(teamDir, { recursive: true, force: true });

      return `チーム '${teamName}' を解散しました。`;
    }

    // --- Task Management ---
    case "team_task_create": {
      const teamName = args.team_name as string;
      const title = args.title as string;
      const createdBy = args.created_by as string;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      const dependsOn = (args.depends_on as string[]) || [];

      // Validate dependencies exist
      if (dependsOn.length > 0) {
        const tasks = loadTasks(teamName);
        const taskIds = new Set(tasks.map(t => t.id));
        for (const depId of dependsOn) {
          if (!taskIds.has(depId)) {
            throw new Error(`依存タスク '${depId}' が見つかりません`);
          }
        }
      }

      const tasks = loadTasks(teamName);
      const task: TeamTask = {
        id: generateTaskId(),
        teamName,
        title,
        description: args.description as string | undefined,
        status: dependsOn.length > 0 ? "blocked" : "pending",
        assignee: args.assignee as string | undefined,
        createdBy,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dependsOn,
      };

      tasks.push(task);
      saveTasks(teamName, tasks);

      let result = `タスク作成: [${task.id}] ${title}`;
      if (task.status === "blocked") {
        result += `\n  状態: blocked（依存: ${dependsOn.join(", ")}）`;
      }
      if (task.assignee) {
        result += `\n  担当: ${task.assignee}`;
      }
      return result;
    }

    case "team_task_claim": {
      const teamName = args.team_name as string;
      const agentName = args.agent_name as string;
      const requestedTaskId = args.task_id as string | undefined;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      if (!team.members.some(m => m.name === agentName)) {
        throw new Error(`${agentName} はチーム '${teamName}' のメンバーではありません`);
      }

      const tasks = loadTasks(teamName);

      // Find the task to claim
      let task: TeamTask | undefined;
      if (requestedTaskId) {
        task = tasks.find(t => t.id === requestedTaskId);
        if (!task) throw new Error(`タスク '${requestedTaskId}' が見つかりません`);
        if (task.status !== "pending") {
          throw new Error(`タスク '${requestedTaskId}' は ${task.status} 状態のため取得できません`);
        }
      } else {
        // Auto-claim: find next available pending task without assignee
        task = tasks.find(t => t.status === "pending" && !t.assignee);
        if (!task) {
          const pendingCount = tasks.filter(t => t.status === "pending").length;
          const blockedCount = tasks.filter(t => t.status === "blocked").length;
          return `取得可能なタスクがありません。(pending: ${pendingCount}, blocked: ${blockedCount})`;
        }
      }

      // Lock-based claiming
      if (!acquireClaimLock(task.id)) {
        throw new Error(`タスク '${task.id}' は別のエージェントが取得中です`);
      }

      try {
        task.assignee = agentName;
        task.status = "in_progress";
        task.updatedAt = Date.now();
        saveTasks(teamName, tasks);
      } finally {
        releaseClaimLock(task.id);
      }

      return `タスクを取得しました: [${task.id}] ${task.title}\n  担当: ${agentName}\n  状態: in_progress`;
    }

    case "team_task_complete": {
      const teamName = args.team_name as string;
      const taskId = args.task_id as string;
      const agentName = args.agent_name as string;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      const tasks = loadTasks(teamName);
      const task = tasks.find(t => t.id === taskId);
      if (!task) throw new Error(`タスク '${taskId}' が見つかりません`);

      if (task.assignee !== agentName && team.lead !== agentName) {
        throw new Error(`タスク '${taskId}' の担当者は ${task.assignee} です（リードは強制完了可能）`);
      }

      task.status = "completed";
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
      task.result = args.result as string | undefined;

      // Unblock dependent tasks
      const unblockedTasks: string[] = [];
      for (const t of tasks) {
        if (t.status === "blocked" && t.dependsOn.includes(taskId)) {
          // Check if ALL dependencies are now completed
          const allDepsCompleted = t.dependsOn.every(depId => {
            const dep = tasks.find(d => d.id === depId);
            return dep?.status === "completed";
          });
          if (allDepsCompleted) {
            t.status = "pending";
            t.updatedAt = Date.now();
            unblockedTasks.push(`[${t.id}] ${t.title}`);
          }
        }
      }

      saveTasks(teamName, tasks);

      let result = `タスク完了: [${taskId}] ${task.title}`;
      if (task.result) {
        result += `\n  結果: ${task.result}`;
      }
      if (unblockedTasks.length > 0) {
        result += `\n\nブロック解除されたタスク:\n  ${unblockedTasks.join("\n  ")}`;
      }

      return result;
    }

    case "team_task_list": {
      const teamName = args.team_name as string;
      const statusFilter = (args.status as string) || "all";
      const assigneeFilter = args.assignee as string | undefined;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      let tasks = loadTasks(teamName);

      if (statusFilter !== "all") {
        tasks = tasks.filter(t => t.status === statusFilter);
      }
      if (assigneeFilter) {
        tasks = tasks.filter(t => t.assignee === assigneeFilter);
      }

      if (tasks.length === 0) {
        return `タスクはありません（フィルタ: status=${statusFilter}${assigneeFilter ? `, assignee=${assigneeFilter}` : ""}）`;
      }

      const statusEmoji: Record<string, string> = {
        pending: "[ ]",
        in_progress: "[>]",
        completed: "[x]",
        blocked: "[!]",
      };

      const lines: string[] = [`=== ${teamName} タスクリスト ===`];
      for (const task of tasks) {
        const emoji = statusEmoji[task.status] || "[ ]";
        const assignee = task.assignee ? `@${task.assignee}` : "(未割り当て)";
        lines.push(`${emoji} [${task.id}] ${task.title} ${assignee}`);
        if (task.dependsOn.length > 0) {
          lines.push(`    依存: ${task.dependsOn.join(", ")}`);
        }
        if (task.result) {
          lines.push(`    結果: ${task.result}`);
        }
      }

      return lines.join("\n");
    }

    case "team_task_update": {
      const teamName = args.team_name as string;
      const taskId = args.task_id as string;
      const agentName = args.agent_name as string;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      const tasks = loadTasks(teamName);
      const task = tasks.find(t => t.id === taskId);
      if (!task) throw new Error(`タスク '${taskId}' が見つかりません`);

      const isLead = team.lead === agentName;
      const isAssignee = task.assignee === agentName;

      if (!isLead && !isAssignee) {
        throw new Error(`タスク '${taskId}' の更新権限がありません（リードまたは担当者のみ）`);
      }

      const changes: string[] = [];

      if (args.status) {
        const newStatus = args.status as TaskStatus;
        task.status = newStatus;
        changes.push(`状態: ${newStatus}`);
        if (newStatus === "completed") {
          task.completedAt = Date.now();
        }
      }

      if (args.assignee !== undefined) {
        if (!isLead) {
          throw new Error("担当者の変更はリードのみ可能です");
        }
        task.assignee = args.assignee as string;
        changes.push(`担当: ${task.assignee}`);
      }

      task.updatedAt = Date.now();
      saveTasks(teamName, tasks);

      return `タスク更新: [${taskId}] ${task.title}\n  ${changes.join(", ")}`;
    }

    // --- Messaging ---
    case "team_message_send": {
      const teamName = args.team_name as string;
      const from = args.from as string;
      const to = args.to as string;
      const content = args.content as string;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      // Validate sender and recipient are team members
      if (!team.members.some(m => m.name === from)) {
        throw new Error(`${from} はチーム '${teamName}' のメンバーではありません`);
      }
      if (!team.members.some(m => m.name === to)) {
        throw new Error(`${to} はチーム '${teamName}' のメンバーではありません`);
      }

      const messages = loadMessages(teamName);
      messages.push({
        id: generateMessageId(),
        teamName,
        from,
        to,
        content,
        timestamp: Date.now(),
        read: false,
      });
      saveMessages(teamName, messages);

      return `メッセージ送信: ${from} -> ${to}: ${content.substring(0, 50)}${content.length > 50 ? "..." : ""}`;
    }

    case "team_message_broadcast": {
      const teamName = args.team_name as string;
      const from = args.from as string;
      const content = args.content as string;

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      if (!team.members.some(m => m.name === from)) {
        throw new Error(`${from} はチーム '${teamName}' のメンバーではありません`);
      }

      const messages = loadMessages(teamName);
      messages.push({
        id: generateMessageId(),
        teamName,
        from,
        to: "all",
        content,
        timestamp: Date.now(),
        read: false,
      });
      saveMessages(teamName, messages);

      const recipientCount = team.members.filter(m => m.name !== from).length;
      return `ブロードキャスト送信: ${from} -> 全員(${recipientCount}名): ${content.substring(0, 50)}${content.length > 50 ? "..." : ""}`;
    }

    case "team_message_read": {
      const teamName = args.team_name as string;
      const agentName = args.agent_name as string;
      const unreadOnly = args.unread_only !== false; // default true
      const markAsRead = args.mark_as_read !== false; // default true

      const team = loadTeam(teamName);
      if (!team) throw new Error(`チーム '${teamName}' が見つかりません`);

      const messages = loadMessages(teamName);

      // Filter messages for this agent (direct or broadcast, excluding own messages)
      let myMessages = messages.filter(
        m => (m.to === agentName || m.to === "all") && m.from !== agentName
      );

      if (unreadOnly) {
        myMessages = myMessages.filter(m => !m.read);
      }

      if (myMessages.length === 0) {
        return unreadOnly ? "未読メッセージはありません" : "メッセージはありません";
      }

      // Mark as read
      if (markAsRead) {
        for (const msg of myMessages) {
          const original = messages.find(m => m.id === msg.id);
          if (original) original.read = true;
        }
        saveMessages(teamName, messages);
      }

      const lines: string[] = [
        `=== ${agentName} のメッセージ (${myMessages.length}件) ===`,
      ];
      for (const msg of myMessages) {
        const time = new Date(msg.timestamp).toLocaleTimeString("ja-JP");
        const target = msg.to === "all" ? "[全体]" : "[DM]";
        lines.push(`[${time}] ${target} ${msg.from}: ${msg.content}`);
      }

      return lines.join("\n");
    }

    default:
      throw new Error(`Unknown team tool: ${name}`);
  }
}
