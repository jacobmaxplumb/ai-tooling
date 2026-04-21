/**
 * Lesson 4: Homework.
 *
 * Build three tools and wire them to the LLM. The model should pick the
 * right one based on the user's question.
 *
 *   1. solve_quadratic(a, b, c)
 *        Solve ax^2 + bx + c = 0. Handle real AND complex roots.
 *
 *   2. fibonacci(n)
 *        Return the first n Fibonacci numbers. Make it efficient for
 *        large n (iterative, not naive recursion).
 *
 *   3. convert_currency(amount, from, to)
 *        Convert between two ISO 4217 currency codes using live rates.
 *        Free endpoint (no key):
 *          https://open.er-api.com/v6/latest/USD
 *
 * The run() loop at the bottom is already written — you only need to
 * fill in the three tool definitions.
 *
 * Test your work with the sample prompts at the bottom of the file.
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

// TODO 1: Implement solve_quadratic.
//   - If a === 0, return { error: "..." }.
//   - If discriminant >= 0, return { root1, root2 } as numbers.
//   - If discriminant < 0, return roots as strings like "1 + 2i".
const solveQuadratic = tool(
  async ({ a, b, c }) => {
    throw new Error("TODO: implement solve_quadratic");
  },
  {
    name: "solve_quadratic",
    description:
      "Solve a quadratic ax^2 + bx + c = 0. Handles real and complex roots.",
    schema: z.object({ a: z.number(), b: z.number(), c: z.number() }),
  }
);

// TODO 2: Implement fibonacci.
//   - Return the first n numbers as strings (use BigInt internally so
//     large n doesn't overflow).
const fibonacci = tool(
  async ({ n }) => {
    throw new Error("TODO: implement fibonacci");
  },
  {
    name: "fibonacci",
    description:
      "Return the first n Fibonacci numbers. Works for large n (uses BigInt).",
    schema: z.object({ n: z.number().int() }),
  }
);

// TODO 3: Implement convert_currency.
//   - Hit https://open.er-api.com/v6/latest/<FROM>.
//   - Look up data.rates[<TO>].
//   - Return { amount, from, to, converted, rate } or { error }.
const convertCurrency = tool(
  async ({ amount, from, to }) => {
    throw new Error("TODO: implement convert_currency");
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
