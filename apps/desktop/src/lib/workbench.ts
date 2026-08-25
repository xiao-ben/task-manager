import type {
  AgentRun,
  Conversation,
  ConversationSource,
  InboxItem,
  InboxSource,
  Lens,
  LibraryEntry,
  LibraryKind,
  Task,
} from "@task-manager/shared";
import { todayKey } from "@task-manager/shared";
import type { LocalDb } from "./localDb";
import type { PrincipleSeed } from "./principlePack";
import { createTaskOptimistic, mutateLocalDb } from "./sync";

function nowIso() {
  return new Date().toISOString();
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.replace(/^[-*•\d.\s]+/, "").trim())
    .filter(Boolean);
}

export function openInbox(db: LocalDb | null | undefined): InboxItem[] {
  return [...(db?.inboxItems ?? [])].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}

export function suggestLensesForTask(task: Task, lenses: Lens[]): Lens[] {
  const hay = `${task.title}\n${task.notes ?? ""}`.toLowerCase();
  return lenses.filter((lens) => {
    if (lens.draft) return false;
    const title = lens.title.trim().toLowerCase();
    return title.length >= 2 && hay.includes(title);
  });
}

export function lensesForTask(db: LocalDb | null | undefined, taskId: string): Lens[] {
  const ids = new Set(
    (db?.taskLenses ?? []).filter((l) => l.taskId === taskId).map((l) => l.lensId),
  );
  return (db?.lenses ?? []).filter((lens) => ids.has(lens.id));
}

export async function createInboxItem(input: {
  body: string;
  source?: InboxSource;
  conversationId?: string | null;
}): Promise<InboxItem> {
  const item: InboxItem = {
    id: crypto.randomUUID(),
    body: input.body.trim(),
    source: input.source ?? "manual",
    conversationId: input.conversationId ?? null,
    createdAt: nowIso(),
  };
  await mutateLocalDb((db) => ({
    ...db,
    inboxItems: [item, ...db.inboxItems],
  }));
  return item;
}

export async function deleteInboxItem(id: string): Promise<InboxItem | null> {
  let removed: InboxItem | null = null;
  await mutateLocalDb((db) => {
    removed = db.inboxItems.find((i) => i.id === id) ?? null;
    return { ...db, inboxItems: db.inboxItems.filter((i) => i.id !== id) };
  });
  return removed;
}

export async function restoreInboxItem(item: InboxItem): Promise<void> {
  await mutateLocalDb((db) => ({
    ...db,
    inboxItems: db.inboxItems.some((i) => i.id === item.id)
      ? db.inboxItems
      : [item, ...db.inboxItems],
  }));
}

export async function triageInboxToToday(item: InboxItem): Promise<Task> {
  const task = await createTaskOptimistic({
    title: item.body.slice(0, 500),
    notes: item.body.length > 500 ? item.body : null,
    day: todayKey(),
    source: "manual",
  });
  await mutateLocalDb((db) => ({
    ...db,
    inboxItems: db.inboxItems.filter((i) => i.id !== item.id),
  }));
  return task;
}

export async function triageInboxToLibrary(item: InboxItem): Promise<LibraryEntry> {
  const entry: LibraryEntry = {
    id: crypto.randomUUID(),
    title: item.body.slice(0, 80) || "未命名笔记",
    content: item.body,
    kind: "note",
    lensIds: [],
    taskIds: [],
    conversationIds: item.conversationId ? [item.conversationId] : [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await mutateLocalDb((db) => ({
    ...db,
    inboxItems: db.inboxItems.filter((i) => i.id !== item.id),
    libraryEntries: [entry, ...db.libraryEntries],
  }));
  return entry;
}

export async function triageInboxToLens(item: InboxItem): Promise<Lens> {
  const lens: Lens = {
    id: crypto.randomUUID(),
    title: item.body.slice(0, 24).replace(/\s+/g, "") || "未命名原则",
    domain: "",
    what: item.body,
    when: "",
    whenNot: "",
    questions: [],
    draft: true,
    usedCount: 0,
    lastUsedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await mutateLocalDb((db) => ({
    ...db,
    inboxItems: db.inboxItems.filter((i) => i.id !== item.id),
    lenses: [lens, ...db.lenses],
  }));
  return lens;
}

export async function upsertLibraryEntry(
  patch: Partial<LibraryEntry> & { title: string; kind?: LibraryKind },
): Promise<LibraryEntry> {
  const now = nowIso();
  let saved: LibraryEntry | null = null;
  await mutateLocalDb((db) => {
    if (patch.id) {
      const current = db.libraryEntries.find((e) => e.id === patch.id);
      if (current) {
        saved = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: now };
        return {
          ...db,
          libraryEntries: db.libraryEntries.map((e) => (e.id === patch.id ? saved! : e)),
        };
      }
    }
    saved = {
      id: crypto.randomUUID(),
      title: patch.title,
      content: patch.content ?? "",
      kind: patch.kind ?? "note",
      lensIds: patch.lensIds ?? [],
      taskIds: patch.taskIds ?? [],
      conversationIds: patch.conversationIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    return { ...db, libraryEntries: [saved, ...db.libraryEntries] };
  });
  return saved!;
}

export async function deleteLibraryEntry(id: string): Promise<void> {
  await mutateLocalDb((db) => ({
    ...db,
    libraryEntries: db.libraryEntries.filter((e) => e.id !== id),
  }));
}

export async function upsertLens(patch: Partial<Lens> & { title: string }): Promise<Lens> {
  const now = nowIso();
  let saved: Lens | null = null;
  await mutateLocalDb((db) => {
    if (patch.id) {
      const current = db.lenses.find((e) => e.id === patch.id);
      if (current) {
        saved = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: now };
        return {
          ...db,
          lenses: db.lenses.map((e) => (e.id === patch.id ? saved! : e)),
        };
      }
    }
    saved = {
      id: crypto.randomUUID(),
      title: patch.title,
      domain: patch.domain ?? "",
      what: patch.what ?? "",
      when: patch.when ?? "",
      whenNot: patch.whenNot ?? "",
      questions: patch.questions ?? [],
      draft: patch.draft ?? false,
      usedCount: patch.usedCount ?? 0,
      lastUsedAt: patch.lastUsedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return { ...db, lenses: [saved, ...db.lenses] };
  });
  return saved!;
}

export async function confirmLens(id: string): Promise<void> {
  await mutateLocalDb((db) => ({
    ...db,
    lenses: db.lenses.map((lens) =>
      lens.id === id ? { ...lens, draft: false, updatedAt: nowIso() } : lens,
    ),
  }));
}

export async function importPrinciples(
  seeds: PrincipleSeed[],
): Promise<{ added: number; skipped: number }> {
  const now = nowIso();
  let added = 0;
  let skipped = 0;
  await mutateLocalDb((db) => {
    const existing = new Set(
      db.lenses.map((lens) => lens.title.trim().toLowerCase()),
    );
    const extra: Lens[] = [];
    for (const seed of seeds) {
      const key = seed.title.trim().toLowerCase();
      if (!key || existing.has(key)) {
        skipped += 1;
        continue;
      }
      existing.add(key);
      added += 1;
      extra.push({
        id: crypto.randomUUID(),
        title: seed.title.trim().slice(0, 80),
        domain: seed.domain ?? "",
        what: seed.what ?? "",
        when: seed.when ?? "",
        whenNot: seed.whenNot ?? "",
        questions: seed.questions ?? [],
        draft: false,
        usedCount: 0,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    return extra.length ? { ...db, lenses: [...extra, ...db.lenses] } : db;
  });
  return { added, skipped };
}

export async function deleteLens(id: string): Promise<void> {
  await mutateLocalDb((db) => ({
    ...db,
    lenses: db.lenses.filter((e) => e.id !== id),
    taskLenses: db.taskLenses.filter((l) => l.lensId !== id),
  }));
}

export async function linkTaskLens(taskId: string, lensId: string): Promise<void> {
  await mutateLocalDb((db) => {
    if (db.taskLenses.some((l) => l.taskId === taskId && l.lensId === lensId)) {
      return db;
    }
    return { ...db, taskLenses: [...db.taskLenses, { taskId, lensId }] };
  });
}

export async function unlinkTaskLens(taskId: string, lensId: string): Promise<void> {
  await mutateLocalDb((db) => ({
    ...db,
    taskLenses: db.taskLenses.filter(
      (l) => !(l.taskId === taskId && l.lensId === lensId),
    ),
  }));
}

export async function markLensesUsed(lensIds: string[]): Promise<void> {
  if (lensIds.length === 0) return;
  const now = nowIso();
  const set = new Set(lensIds);
  await mutateLocalDb((db) => ({
    ...db,
    lenses: db.lenses.map((lens) =>
      set.has(lens.id)
        ? { ...lens, usedCount: (lens.usedCount ?? 0) + 1, lastUsedAt: now, updatedAt: now }
        : lens,
    ),
  }));
}

export async function recordJudgment(input: {
  task: Task;
  lensIds: string[];
  content: string;
}): Promise<LibraryEntry> {
  const entry = await upsertLibraryEntry({
    title: `判断 · ${input.task.title}`.slice(0, 200),
    content: input.content.trim(),
    kind: "judgment",
    lensIds: input.lensIds,
    taskIds: [input.task.id],
  });
  for (const lensId of input.lensIds) {
    await linkTaskLens(input.task.id, lensId);
  }
  await markLensesUsed(input.lensIds);
  return entry;
}

export async function upsertConversation(
  patch: Partial<Conversation> & { title: string; source?: ConversationSource },
): Promise<Conversation> {
  const now = nowIso();
  let saved: Conversation | null = null;
  await mutateLocalDb((db) => {
    if (patch.id) {
      const current = db.conversations.find((e) => e.id === patch.id);
      if (current) {
        saved = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: now };
        return {
          ...db,
          conversations: db.conversations.map((e) => (e.id === patch.id ? saved! : e)),
        };
      }
    }
    saved = {
      id: crypto.randomUUID(),
      title: patch.title,
      source: patch.source ?? "other",
      body: patch.body ?? "",
      taskId: patch.taskId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return { ...db, conversations: [saved, ...db.conversations] };
  });
  return saved!;
}

export async function deleteConversation(id: string): Promise<void> {
  await mutateLocalDb((db) => ({
    ...db,
    conversations: db.conversations.filter((e) => e.id !== id),
  }));
}

export async function importAgentRunAsConversation(run: AgentRun): Promise<Conversation> {
  const title = `Cursor 运行 · ${(run.result || run.taskId).slice(0, 40)}`;
  const body = [run.result, run.transcript, run.error].filter(Boolean).join("\n\n");
  return upsertConversation({
    title,
    source: "cursor",
    body: body || "（无 transcript）",
    taskId: run.taskId,
  });
}

export async function extractConversation(
  conversation: Conversation,
  extract: {
    conclusions: string;
    todos: string;
    inspiration: string;
    lensTitle: string;
    lensWhat: string;
    lensQuestions: string;
  },
): Promise<void> {
  const conclusionLines = lines(extract.conclusions);
  const todoLines = lines(extract.todos);
  const inspirationLines = lines(extract.inspiration);
  const questionLines = lines(extract.lensQuestions);

  if (conclusionLines.length > 0) {
    await upsertLibraryEntry({
      title: `摘录 · ${conversation.title}`.slice(0, 200),
      content: conclusionLines.map((l) => `- ${l}`).join("\n"),
      kind: "excerpt",
      conversationIds: [conversation.id],
      taskIds: conversation.taskId ? [conversation.taskId] : [],
    });
  }

  for (const line of [...todoLines, ...inspirationLines]) {
    await createInboxItem({
      body: line,
      source: "conversation",
      conversationId: conversation.id,
    });
  }

  if (extract.lensTitle.trim()) {
    await upsertLens({
      title: extract.lensTitle.trim().slice(0, 80),
      what: extract.lensWhat.trim() || conclusionLines.join("\n"),
      questions: questionLines,
      draft: true,
    });
  }
}
