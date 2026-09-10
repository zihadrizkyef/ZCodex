/** Project store: a flat list of local workspace roots, persisted under userData. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProjectView } from "@zcodex/contracts";

interface StoreShape {
  projects: ProjectView[];
  /** threadId -> projectId for threads whose cwd is not inside the project root. */
  threadProjects: Record<string, string>;
}

export function projectIdForRoot(root: string): string {
  const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return `local-${createHash("md5").update(normalized).digest("hex")}`;
}

export class ProjectStore {
  private readonly file: string;
  private data: StoreShape = { projects: [], threadProjects: {} };

  constructor(userDataDir: string) {
    mkdirSync(userDataDir, { recursive: true });
    this.file = path.join(userDataDir, "zcodex-projects.json");
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoreShape>;
        this.data = {
          projects: parsed.projects ?? [],
          threadProjects: parsed.threadProjects ?? {},
        };
      }
    } catch {
      this.data = { projects: [], threadProjects: {} };
    }
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf8");
  }

  list(): ProjectView[] {
    return this.data.projects;
  }

  get(id: string): ProjectView | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  add(root: string): ProjectView {
    const clean = root.replace(/[\\/]+$/, "");
    const id = projectIdForRoot(clean);
    const existing = this.get(id);
    if (existing) return existing;
    const project: ProjectView = {
      id,
      name: path.basename(clean),
      roots: [clean],
      createdAt: Date.now(),
    };
    this.data.projects = [...this.data.projects, project];
    this.save();
    return project;
  }

  remove(id: string): ProjectView[] {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    for (const [threadId, projectId] of Object.entries(this.data.threadProjects)) {
      if (projectId === id) delete this.data.threadProjects[threadId];
    }
    this.save();
    return this.data.projects;
  }

  hints(): Record<string, string> {
    return this.data.threadProjects;
  }

  rememberThread(threadId: string, projectId: string): void {
    this.data.threadProjects[threadId] = projectId;
    this.save();
  }
}
