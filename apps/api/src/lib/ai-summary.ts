import {
  generateSummaryDraft,
  type PeriodType,
  type Task,
} from "@task-manager/shared";

function periodLabel(periodType: PeriodType, periodKey: string): string {
  if (periodType === "day") return `日总结（${periodKey}）`;
  if (periodType === "week") return `周总结（${periodKey}）`;
  return `月总结（${periodKey}）`;
}

function buildPrompt(
  periodType: PeriodType,
  periodKey: string,
  tasks: Task[],
): string {
  const base = generateSummaryDraft(periodType, periodKey, tasks);
  return [
    `请根据以下任务清单，写一份简洁的中文${periodLabel(periodType, periodKey)}。`,
    "要求：",
    "1. 用 Markdown，含「概览 / 完成亮点 / 未完成与风险 / 下一步」四段",
    "2. 基于事实，不编造未出现的工作",
    "3. 语气专业克制，总长控制在 400 字以内",
    "4. 只输出总结正文，不要前言客套",
    "",
    "任务原始数据：",
    base,
  ].join("\n");
}

type ChatChoice = {
  message?: { content?: string | null };
};

type ChatResponse = {
  choices?: ChatChoice[];
  error?: { message?: string };
};

/**
 * 通过 Vercel AI Gateway（或兼容 OpenAI Chat Completions 的端点）生成总结。
 * 优先 AI_GATEWAY_API_KEY，其次 OPENAI_API_KEY。
 */
export async function generateAiSummary(
  periodType: PeriodType,
  periodKey: string,
  tasks: Task[],
): Promise<string> {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const apiKey = gatewayKey || openaiKey;
  if (!apiKey) {
    throw new Error(
      "未配置 AI_GATEWAY_API_KEY（或 OPENAI_API_KEY），无法生成 AI 总结",
    );
  }

  const model =
    process.env.AI_SUMMARY_MODEL?.trim() ||
    (gatewayKey ? "openai/gpt-5.4-mini" : "gpt-5.4-mini");
  const endpoint =
    process.env.AI_SUMMARY_ENDPOINT?.trim() ||
    (gatewayKey
      ? "https://ai-gateway.vercel.sh/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "你是个人工作复盘助手，擅长把任务列表整理成清晰总结。",
        },
        {
          role: "user",
          content: buildPrompt(periodType, periodKey, tasks),
        },
      ],
    }),
  });

  const raw = (await res.json()) as ChatResponse;
  if (!res.ok) {
    throw new Error(raw.error?.message || `AI 请求失败（${res.status}）`);
  }
  const text = raw.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("AI 返回为空");
  }
  return text;
}
