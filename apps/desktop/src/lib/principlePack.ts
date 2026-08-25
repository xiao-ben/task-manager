import type { Lens } from "@task-manager/shared";

/** User-facing name. Storage key remains `lenses`. */
export const PRINCIPLE_LABEL = "原则";

export type PrincipleSeed = {
  title: string;
  domain: string;
  what: string;
  when: string;
  whenNot: string;
  questions: string[];
};

export const PRINCIPLE_PACK_FORMAT = "task-manager-principles" as const;

export const STARTER_PRINCIPLES: PrincipleSeed[] = [
  {
    title: "能力圈",
    domain: "决策 / 学习",
    what: "只在自己真正懂的范围内做重决策。圈外可以参与，但要降仓、放慢、或交给懂的人。",
    when: "投资、选项目、答应别人、做技术判断。",
    whenNot: "探索和学习本身。能力圈是用来决策的，不是用来拒绝新事物的。",
    questions: [
      "这件事我是真懂，还是听起来懂？",
      "如果必须用自己的话讲给外行，我讲得清吗？",
      "圈外的部分，我能不能缩小承诺？",
    ],
  },
  {
    title: "逆向",
    domain: "决策",
    what: "先想怎样会搞砸，再倒推现在不做什么。",
    when: "规划、复盘、设计流程、评估方案。",
    whenNot: "已经明显该推进、再逆向只会空转的小事。",
    questions: [
      "怎样做，这件事几乎一定会失败？",
      "我现在是不是正在做其中一件？",
      "如果避免失败，最小要改的是什么？",
    ],
  },
  {
    title: "机会成本",
    domain: "取舍",
    what: "选 A 就是放弃 B。成本不是付出的钱或时间，是你因此没做成的那件更好的事。",
    when: "加仓、接活、开会、开始一个新项目。",
    whenNot: "没有真实替代项的必做事项（吃饭、睡觉、已承诺的交付）。",
    questions: [
      "不做这件事，时间和钱会去哪？",
      "那个替代项的预期，是不是比这个更好？",
      "我是在选择，还是在逃避选择？",
    ],
  },
  {
    title: "安全边际",
    domain: "风险",
    what: "判断可能错。留下犯错空间：更便宜、更慢、更小、可退出。",
    when: "买资产、压工期、依赖单一路径、对人做强承诺。",
    whenNot: "胜率极高且损失可忽略的日常决定。",
    questions: [
      "我错了会怎样？伤得起吗？",
      "有没有更便宜 / 更小 / 可逆的下法？",
      "我是不是把最好情况当成了基准情况？",
    ],
  },
  {
    title: "可逆决策",
    domain: "节奏",
    what: "容易改的决定要快；改了代价大的决定要慢。不要用同一套仪式对待两种决定。",
    when: "要不要启动、选工具、定流程、对外承诺。",
    whenNot: "已经可逆却还在分析的拖延。",
    questions: [
      "这件事做错了，改回来要花多大代价？",
      "能不能先做一版小的、可退出的？",
      "我是在谨慎，还是在害怕？",
    ],
  },
  {
    title: "复利",
    domain: "长期",
    what: "真正值钱的是能重复、能积累的事。偶尔爆发不如稳定的小优势叠久。",
    when: "习惯、写作、代码质量、关系、学习和投资。",
    whenNot: "一次性危机、必须当场拍板的窗口。",
    questions: [
      "这件事做完，明天会不会更容易再做？",
      "我是在积累资产，还是在消耗注意力？",
      "一年后回头，今天这小时还在吗？",
    ],
  },
  {
    title: "第一性原理",
    domain: "思考",
    what: "把问题拆到不能再拆的事实，再往上组。少用「别人都这么做」当理由。",
    when: "设计产品、争论方案、看行业叙事、被类比带着走的时候。",
    whenNot: "时间极紧、沿用已知好方案就够的执行阶段。",
    questions: [
      "哪些是事实，哪些只是习惯说法？",
      "如果从零开始，我还会这样做吗？",
      "类比在哪一点其实不像？",
    ],
  },
  {
    title: "二阶后果",
    domain: "系统",
    what: "看完「然后呢」。短期舒服的选择，经常把成本推到后面或别人身上。",
    when: "激励设计、借债、加功能、给人开特例、用捷径交差。",
    whenNot: "没有后续链条的纯执行动作。",
    questions: [
      "三个月后，这件事会逼我做什么？",
      "谁会因此改变行为？是我想要的吗？",
      "有没有我现在图省事、以后更贵的部分？",
    ],
  },
];

export function serializePrinciples(lenses: Lens[]): string {
  return JSON.stringify(
    {
      format: PRINCIPLE_PACK_FORMAT,
      version: 1,
      principles: lenses.map((lens) => ({
        title: lens.title,
        domain: lens.domain,
        what: lens.what,
        when: lens.when,
        whenNot: lens.whenNot,
        questions: lens.questions,
      })),
    },
    null,
    2,
  );
}

export function parsePrinciplePack(raw: string): PrincipleSeed[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("不是有效的 JSON");
  }
  if (Array.isArray(parsed)) {
    return parsed.map(asSeed);
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as { format?: string; principles?: unknown; lenses?: unknown };
    const list = o.principles ?? o.lenses;
    if (Array.isArray(list)) return list.map(asSeed);
  }
  throw new Error("无法识别的原则文件（需要 principles 数组）");
}

function asSeed(raw: unknown): PrincipleSeed {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = String(o.title ?? "").trim();
  if (!title) throw new Error("有一条原则没有标题");
  const questions = Array.isArray(o.questions)
    ? o.questions.map((q) => String(q).trim()).filter(Boolean)
    : [];
  return {
    title: title.slice(0, 80),
    domain: String(o.domain ?? "").slice(0, 80),
    what: String(o.what ?? ""),
    when: String(o.when ?? ""),
    whenNot: String(o.whenNot ?? ""),
    questions,
  };
}
