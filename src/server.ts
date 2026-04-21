/**
 * Chat server — a browser UI bolted onto the tool-calling agent loop.
 *
 *   POST /api/chat   { sessionId, message } -> { reply }
 *   POST /api/reset  { sessionId }          -> { ok }
 *   GET  /           serves public/index.html
 *
 * Sessions live in memory: a Map<sessionId, messages>. Restarting the
 * server clears all conversations. This is fine for a classroom demo —
 * add Redis or a DB for anything real.
 *
 * Tracing still flows to LangSmith automatically when the LANGSMITH_*
 * env vars are set.
 */
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- tools (same set as the lessons + homework) ----------

const fetchWeather = tool(
  async ({ city }) => {
    const db: Record<string, { temperature_f: number; condition: string }> = {
      austin: { temperature_f: 88, condition: "sunny" },
      seattle: { temperature_f: 54, condition: "rainy" },
      "new york": { temperature_f: 62, condition: "cloudy" },
    };
    return (
      db[city.toLowerCase()] ?? { temperature_f: 70, condition: "unknown" }
    );
  },
  {
    name: "fetch_weather",
    description: "Get the current weather for a city.",
    schema: z.object({ city: z.string() }),
  }
);

const recommendActivity = tool(
  async ({ condition }) => {
    const book: Record<string, string> = {
      sunny: "Go for a run outside.",
      rainy: "Stay in and read a book.",
      cloudy: "Visit a museum.",
    };
    return book[condition.toLowerCase()] ?? "Do whatever you want.";
  },
  {
    name: "recommend_activity",
    description:
      "Recommend an activity given a weather condition ('sunny', 'rainy', 'cloudy').",
    schema: z.object({ condition: z.string() }),
  }
);

const solveQuadratic = tool(
  async ({ a, b, c }) => {
    if (a === 0) {
      return { error: "Coefficient 'a' must be non-zero." };
    }
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return { root1: (-b + s) / (2 * a), root2: (-b - s) / (2 * a) };
    }
    const re = -b / (2 * a);
    const im = Math.sqrt(-disc) / (2 * a);
    return { root1: `${re} + ${im}i`, root2: `${re} - ${im}i` };
  },
  {
    name: "solve_quadratic",
    description:
      "Solve ax^2 + bx + c = 0. Handles real and complex roots.",
    schema: z.object({ a: z.number(), b: z.number(), c: z.number() }),
  }
);

const fibonacci = tool(
  async ({ n }) => {
    if (n <= 0) return [];
    const seq: bigint[] = [0n, 1n];
    while (seq.length < n) {
      seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
    }
    return seq.slice(0, n).map(String);
  },
  {
    name: "fibonacci",
    description: "Return the first n Fibonacci numbers (BigInt, handles large n).",
    schema: z.object({ n: z.number().int() }),
  }
);

const convertCurrency = tool(
  async ({ amount, from, to }) => {
    const res = await fetch(
      `https://open.er-api.com/v6/latest/${from.toUpperCase()}`
    );
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.[to.toUpperCase()];
    if (rate === undefined) return { error: `Unknown currency: ${to}` };
    return {
      amount,
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      converted: Math.round(amount * rate * 100) / 100,
      rate,
    };
  },
  {
    name: "convert_currency",
    description:
      "Convert between two ISO 4217 currency codes using live exchange rates.",
    schema: z.object({
      amount: z.number(),
      from: z.string().describe("ISO 4217 code, e.g. 'USD'"),
      to: z.string().describe("ISO 4217 code, e.g. 'EUR'"),
    }),
  }
);

const tools = [
  fetchWeather,
  recommendActivity,
  solveQuadratic,
  fibonacci,
  convertCurrency,
];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

// ---------- agent ----------

const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
const llmWithTools = llm.bindTools(tools);

const systemPrompt = new SystemMessage(
  "You are a helpful assistant with access to tools for weather, activity " +
    "suggestions, quadratic equations, Fibonacci numbers, and currency " +
    "conversion. Use a tool whenever it gives a more accurate answer than " +
    "your own knowledge."
);

const sessions = new Map<string, BaseMessage[]>();
const MAX_STEPS = 8;

async function chat(sessionId: string, userMessage: string): Promise<string> {
  const messages = sessions.get(sessionId) ?? [systemPrompt];
  messages.push(new HumanMessage(userMessage));

  for (let i = 0; i < MAX_STEPS; i++) {
    const aiMsg = await llmWithTools.invoke(messages);
    messages.push(aiMsg);

    if (!aiMsg.tool_calls?.length) {
      sessions.set(sessionId, messages);
      return typeof aiMsg.content === "string"
        ? aiMsg.content
        : JSON.stringify(aiMsg.content);
    }

    for (const call of aiMsg.tool_calls) {
      const t = toolsByName[call.name];
      if (!t) {
        messages.push(
          new ToolMessage({
            content: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
            tool_call_id: call.id!,
          })
        );
        continue;
      }
      try {
        const result = await t.invoke(call.args as any);
        messages.push(
          new ToolMessage({
            content:
              typeof result === "string" ? result : JSON.stringify(result),
            tool_call_id: call.id!,
          })
        );
      } catch (err) {
        messages.push(
          new ToolMessage({
            content: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            tool_call_id: call.id!,
          })
        );
      }
    }
  }

  sessions.set(sessionId, messages);
  return "I hit my step limit without reaching a final answer.";
}

// ---------- HTTP ----------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body ?? {};
  if (typeof sessionId !== "string" || typeof message !== "string") {
    return res
      .status(400)
      .json({ error: "Both `sessionId` and `message` are required strings." });
  }
  try {
    const reply = await chat(sessionId, message);
    res.json({ reply });
  } catch (err) {
    console.error("chat error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal error",
    });
  }
});

app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body ?? {};
  if (typeof sessionId === "string") sessions.delete(sessionId);
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Chat server listening on http://localhost:${port}`);
});
