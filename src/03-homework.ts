/**
 * Lesson 3: Homework — reference solution.
 *
 * Three tools bound to an LLM. The model picks the right one based on
 * the user's question.
 *
 *   1. solve_quadratic(a, b, c)     real + complex roots
 *   2. fibonacci(n)                 first n numbers, BigInt for large n
 *   3. convert_currency(amount, from, to)   live FX rates
 */
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";

const solveQuadratic = tool(
  async ({ a, b, c }) => {
    if (a === 0) {
      return { error: "Coefficient 'a' must be non-zero for a quadratic." };
    }
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return {
        root1: (-b + s) / (2 * a),
        root2: (-b - s) / (2 * a),
      };
    }
    const re = -b / (2 * a);
    const im = Math.sqrt(-disc) / (2 * a);
    return {
      root1: `${re} + ${im}i`,
      root2: `${re} - ${im}i`,
    };
  },
  {
    name: "solve_quadratic",
    description:
      "Solve a quadratic ax^2 + bx + c = 0. Handles real and complex roots.",
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
    description:
      "Return the first n Fibonacci numbers. Works for large n (uses BigInt).",
    schema: z.object({ n: z.number().int() }),
  }
);

const convertCurrency = tool(
  async ({ amount, from, to }) => {
    const url = `https://open.er-api.com/v6/latest/${from.toUpperCase()}`;
    const res = await fetch(url);
    if (!res.ok) return { error: `HTTP ${res.status} from ${url}` };
    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };
    const rate = data.rates?.[to.toUpperCase()];
    if (rate === undefined) {
      return { error: `Unknown currency code: ${to}` };
    }
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

const tools = [solveQuadratic, fibonacci, convertCurrency];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
const llmWithTools = llm.bindTools(tools);

async function run(userQuery: string, maxSteps = 5) {
  const messages: BaseMessage[] = [new HumanMessage(userQuery)];

  for (let step = 0; step < maxSteps; step++) {
    const aiMsg = await llmWithTools.invoke(messages);
    messages.push(aiMsg);

    if (!aiMsg.tool_calls?.length) {
      return aiMsg.content;
    }

    for (const call of aiMsg.tool_calls) {
      const t = toolsByName[call.name];
      const result = await t.invoke(call.args as any);
      messages.push(
        new ToolMessage({
          content:
            typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: call.id!,
        })
      );
    }
  }

  return "Hit max steps without a final answer.";
}

const prompts = [
  "Solve x^2 - 5x + 6 = 0.",
  "Give me the first 10 Fibonacci numbers.",
  "Convert 100 USD to EUR.",
];

for (const q of prompts) {
  console.log(`\nQ: ${q}`);
  console.log(`A: ${await run(q)}`);
}
