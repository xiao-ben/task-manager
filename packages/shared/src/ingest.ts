import { z } from "zod";

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

function toLines(value: unknown, max = 40, each = 4000): string[] {
  if (value == null || value === "") return [];
  const arr = Array.isArray(value) ? value : String(value).split(/\n+/);
  const out: string[] = [];
  for (const raw of arr) {
    const line = String(raw)
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    if (!line) continue;
    out.push(line.slice(0, each));
    if (out.length >= max) break;
  }
  return out;
}

const LineListSchema = z.preprocess(
  (v) => toLines(v),
  z.array(z.string().min(1).max(4000)).max(40),
);

export const IngestPrincipleSchema = z.object({
  title: z.string().min(1).max(80),
  what: z.string().max(2000).optional().default(""),
  when: z.string().max(2000).optional().default(""),
  whenNot: z.string().max(2000).optional().default(""),
  questions: z
    .preprocess((v) => toLines(v, 8, 300), z.array(z.string().max(300)).max(8))
    .optional()
    .default([]),
});

export const IngestDepositSchema = z
  .object({
    title: z.string().max(200).optional().default(""),
    source: z.enum(["cursor", "claude", "chatgpt", "other"]).optional().default("other"),
    agent: z.string().max(80).optional().default(""),
    body: z.string().max(100000).optional().default(""),
    conclusions: LineListSchema.optional().default([]),
    todos: LineListSchema.optional().default([]),
    inspiration: LineListSchema.optional().default([]),
    principle: IngestPrincipleSchema.nullable().optional(),
  })
  .transform((d) => {
    const title =
      d.title.trim() ||
      d.todos[0]?.slice(0, 80) ||
      d.conclusions[0]?.slice(0, 80) ||
      d.principle?.title ||
      "Agent 沉淀";
    return { ...d, title };
  })
  .refine(
    (d) =>
      Boolean(d.body.trim()) ||
      d.conclusions.length > 0 ||
      d.todos.length > 0 ||
      d.inspiration.length > 0 ||
      Boolean(d.principle?.title),
    { message: "至少提供 body / conclusions / todos / inspiration / principle 之一" },
  );

export type IngestDepositInput = z.input<typeof IngestDepositSchema>;
export type IngestDeposit = z.output<typeof IngestDepositSchema>;

export type IngestableDb = {
  inboxItems: unknown[];
  libraryEntries: unknown[];
  lenses: unknown[];
  conversations: unknown[];
  [key: string]: unknown;
};

export type IngestResult = {
  conversationId: string | null;
  libraryId: string | null;
  lensId: string | null;
  inboxIds: string[];
  counts: {
    inbox: number;
    conclusions: number;
    principles: number;
  };
};

export function ensureIngestCollections(
  db: Record<string, unknown>,
): IngestableDb {
  return {
    ...db,
    inboxItems: Array.isArray(db.inboxItems) ? db.inboxItems : [],
    libraryEntries: Array.isArray(db.libraryEntries) ? db.libraryEntries : [],
    lenses: Array.isArray(db.lenses) ? db.lenses : [],
    conversations: Array.isArray(db.conversations) ? db.conversations : [],
  };
}

export function applyIngestToDb(
  rawDb: Record<string, unknown>,
  deposit: IngestDeposit,
): { db: IngestableDb; result: IngestResult } {
  const db = ensureIngestCollections(rawDb);
  const now = nowIso();
  const result: IngestResult = {
    conversationId: null,
    libraryId: null,
    lensId: null,
    inboxIds: [],
    counts: { inbox: 0, conclusions: 0, principles: 0 },
  };

  const header = [
    deposit.agent ? `Agent：${deposit.agent}` : "",
    `来源：${deposit.source}`,
  ]
    .filter(Boolean)
    .join("\n");
  const body = [header, deposit.body.trim()].filter(Boolean).join("\n\n");

  const conversation = {
    id: newId(),
    title: deposit.title.slice(0, 200),
    source: deposit.source,
    body: body.slice(0, 100000),
    taskId: null,
    createdAt: now,
    updatedAt: now,
  };
  db.conversations = [conversation, ...db.conversations];
  result.conversationId = conversation.id;

  if (deposit.conclusions.length > 0) {
    const entry = {
      id: newId(),
      title: `摘录 · ${deposit.title}`.slice(0, 200),
      content: deposit.conclusions.map((l) => `- ${l}`).join("\n").slice(0, 20000),
      kind: "excerpt" as const,
      lensIds: [] as string[],
      taskIds: [] as string[],
      conversationIds: [conversation.id],
      createdAt: now,
      updatedAt: now,
    };
    db.libraryEntries = [entry, ...db.libraryEntries];
    result.libraryId = entry.id;
    result.counts.conclusions = deposit.conclusions.length;
  }

  for (const line of [...deposit.todos, ...deposit.inspiration]) {
    const item = {
      id: newId(),
      body: line.slice(0, 4000),
      source: "agent" as const,
      conversationId: conversation.id,
      createdAt: now,
    };
    db.inboxItems = [item, ...db.inboxItems];
    result.inboxIds.push(item.id);
  }
  result.counts.inbox = result.inboxIds.length;

  if (deposit.principle?.title.trim()) {
    const want = deposit.principle.title.trim().toLowerCase();
    const existing = (db.lenses as Array<{ title?: string }>).some(
      (lens) => String(lens.title ?? "").trim().toLowerCase() === want,
    );
    if (!existing) {
      const lens = {
        id: newId(),
        title: deposit.principle.title.trim().slice(0, 80),
        domain: "",
        what: deposit.principle.what || deposit.conclusions.join("\n"),
        when: deposit.principle.when || "",
        whenNot: deposit.principle.whenNot || "",
        questions: deposit.principle.questions,
        draft: true,
        usedCount: 0,
        lastUsedAt: null as string | null,
        createdAt: now,
        updatedAt: now,
      };
      db.lenses = [lens, ...db.lenses];
      result.lensId = lens.id;
      result.counts.principles = 1;
    }
  }

  return { db, result };
}
