# Tool Calling — Lecture Notes

> Instructor script for the ~35-minute class. Times are suggestions; adjust for Q&A.
> Students should be on the `start` branch with `npm install` already run and `.env` filled in.

---

## Opening (2 min)

> "Today we stop talking *to* models and start having them do things.
> By the end of class you'll know how the LLM tells your program to run a function,
> how to wire that up in both vanilla OpenAI and LangChain, and you'll have built
> three working tools yourself."

**Why this matters.** Tool calling is the single feature that turns an LLM from a chat window into something you can build real products on. Every agent, every AI IDE, every "AI that books your flight" — it's all this one pattern repeated.

### The three things you'll walk away with

1. A mental model of the tool-calling control loop (it's a loop, not a single call).
2. Two working implementations — one in OpenAI's SDK, one in LangChain.
3. Hands-on practice writing your own tools and seeing the model pick the right one.

---

## Part 1 — What is tool calling? (10 min)

### The one-sentence definition

> The LLM returns a *structured request* saying "please call this function with these arguments." Your code runs the function. You feed the result back. The LLM writes the final answer.

### Two words people use interchangeably

**Tool calling** and **function calling** are basically the same thing. OpenAI originally shipped it as "function calling." They've since renamed to "tools" because a tool can be more than a single function — it can represent any capability (code interpreter, retrieval, etc.). The mechanics are identical. Use whichever word the docs you're reading use.

### The shape of a tool call

Every tool call has three parts:

```
name:      "fetch_weather"
arguments: { "city": "Austin" }
id:        "call_abc123"     # so you can match request ↔ response
```

That's it. No magic. The model is just producing a JSON-shaped message that says *I want this named function run with these named arguments.*

### The control loop (draw this on the board)

```
  User question
       │
       ▼
     ┌────┐      tool_call       ┌──────┐
     │LLM │ ───────────────────► │ TOOL │
     └────┘                      └──────┘
       ▲                            │
       │   tool result              │
       └────────────────────────────┘
       │
       ▼
  Final answer (to user)
```

Three important facts about this loop:

1. **The LLM does not run your code.** Ever. It only tells you what to run.
2. **You can loop.** The model can request another tool *after* seeing the first result.
3. **The model can refuse to call a tool.** If the question doesn't need one, it just answers directly.

### Why this design instead of "model runs code"?

Because letting a hosted model execute arbitrary code against your systems is a security, correctness, and ops nightmare. Keeping the model in "advisor" mode and your application in "executor" mode is what makes this pattern production-safe.

---

## Part 2 — Hands-on: OpenAI's native SDK (12 min)

Open [`src/01-openai-tool-calling.ts`](./src/01-openai-tool-calling.ts). Walk through it top to bottom with the class. The file is structured as five clearly labeled steps matching the loop above.

### Walkthrough script

**Step 1 — the real function** ([src/01-openai-tool-calling.ts:22-30](./src/01-openai-tool-calling.ts#L22-L30)).

> "This is just a normal TypeScript function. The LLM doesn't know it exists yet — it's on our side of the wall. Notice the fake DB. In production this would hit a weather API; today we just want a predictable return value so we can see the pattern."

**Step 2 — describe the function in JSON Schema** ([src/01-openai-tool-calling.ts:33-52](./src/01-openai-tool-calling.ts#L33-L52)).

> "This is the contract we hand to the model. The `description` is what it reads to decide *when* to call us. The `parameters` block is what it reads to decide *what arguments* to send. Write these like you're writing docs for another engineer — because you basically are."

**Step 3 — first API call** ([src/01-openai-tool-calling.ts:60-64](./src/01-openai-tool-calling.ts#L60-L64)).

> "We send the user's question plus the list of tools. Notice we do NOT send the implementation — just the schema. The model never sees our code."

Pause here and ask: *"What do you think comes back?"*

Let students guess. Then reveal: it's a chat message with no `content` but with a `tool_calls` array. That's the model saying "I want to call one (or more) of your tools."

**Step 4 — execute the tool and append the result** ([src/01-openai-tool-calling.ts:75-83](./src/01-openai-tool-calling.ts#L75-L83)).

> "Critical detail: the result goes back as a message with `role: 'tool'`, and we have to include the `tool_call_id`. That's how the model knows *which* of its requests this response is for. If you forget the id, you'll get a cryptic error."

**Step 5 — second API call** ([src/01-openai-tool-calling.ts:86-90](./src/01-openai-tool-calling.ts#L86-L90)).

> "Same conversation history, now with the tool result in it. This time the model has everything it needs — no more tool calls, just a final text answer."

### Run it live

```bash
npm run lesson:1
```

Expected output (roughly):

> The weather in Austin is currently sunny with a temperature of 88°F.

**Ask the class:** *"How many round-trips did we make to the OpenAI API?"* (Answer: **2** — one for the tool-call decision, one for the final answer. This becomes important when thinking about latency and cost.)

### Common gotchas to mention

- If `tool_calls` is empty, the model decided not to use a tool. Handle that branch.
- `arguments` comes back as a **JSON string**, not a parsed object. You must `JSON.parse` it.
- The second call does NOT need to include `tools` again. Some people include it anyway — it's not harmful, just redundant.
- `gpt-4o-mini` is plenty capable for this — don't reach for the biggest model on reflex. Cost matters.

---

## Part 3 — Same thing in LangChain (8 min)

Open [`src/02-langchain-tool-calling.ts`](./src/02-langchain-tool-calling.ts).

### The pitch

> "LangChain is doing nothing magical. It's the same five steps. What it buys you is no JSON-schema boilerplate and a cleaner tool-binding API."

### The three things that got easier

1. **Tool definition** ([src/02-langchain-tool-calling.ts:27-45](./src/02-langchain-tool-calling.ts#L27-L45)) — `tool(fn, { name, description, schema })` with a Zod schema. No hand-written JSON Schema.
2. **Attaching tools to the model** ([src/02-langchain-tool-calling.ts:50](./src/02-langchain-tool-calling.ts#L50)) — one call: `llm.bindTools([...])`. The returned object acts like the original LLM but knows about the tools.
3. **Message shapes** — `HumanMessage`, `AIMessage`, `ToolMessage`. More structure than raw OpenAI message dicts, but also fewer ways to mess up the wire format.

### What stays the same

The loop. Look at [src/02-langchain-tool-calling.ts:53-77](./src/02-langchain-tool-calling.ts#L53-L77) side-by-side with lesson 1 — it's *the exact same shape*. Invoke, check for tool_calls, run them, append results, invoke again.

> "Don't let frameworks trick you into thinking you don't know what's happening. If you can write lesson 1 by hand, you understand LangChain. If you can't, you'll get stuck the first time the framework does something unexpected."

### Run it

```bash
npm run lesson:2
```

### Why the Zod schema matters

The `.describe()` strings on each field flow through to the JSON schema the model sees. Good field descriptions → fewer argument mistakes from the model. It's the most impactful, lowest-effort place to improve accuracy.

---

## Part 4 — Hands-on Homework (3 min framing)

Open [`src/03-homework.ts`](./src/03-homework.ts). The loop is already written; students only fill in the three tool bodies.

### The three tools

1. **`solve_quadratic(a, b, c)`** — `ax² + bx + c = 0`. Must handle complex roots.
   - *Tip:* if `a === 0`, return an error. If discriminant < 0, return roots as strings like `"1 + 2i"`.
2. **`fibonacci(n)`** — first n Fibonacci numbers. Must handle large n.
   - *Tip:* use `BigInt`. Return stringified numbers so they serialize cleanly.
3. **`convert_currency(amount, from, to)`** — live exchange rates from `open.er-api.com`. No API key needed.
   - *Tip:* `fetch` is globally available in Node 18+. Return a typed object, handle unknown currency codes.

### How to test

Each test prompt at the bottom of the file exercises one tool:

```bash
npm run homework
```

### Good questions to ask afterward

- *What happens if you ask "What's the square root of 16?"* — The model won't call `solve_quadratic` (wrong shape). It'll answer directly. Good — tools should be narrowly scoped.
- *What if you change the description of `fibonacci` to say "square numbers" by mistake?* — The model will call it for the wrong prompts. Descriptions are load-bearing.
- *Could the model call two tools in one turn?* — Yes. Ask "Convert 100 USD to EUR and give me the first 5 Fibonacci numbers." That's why the loop iterates over `tool_calls`.

### Stretch goals (for the fast finishers)

- Add a `units` argument to `solve_quadratic` that returns results formatted as LaTeX.
- Add caching to `convert_currency` so repeated prompts don't hit the API twice.
- Add a fourth tool and see if the model picks the right one for ambiguous prompts.

### Try it in the chat app

Once your tools are working, run the bundled chat server and ask the same questions in the browser:

```bash
npm run server
# open http://localhost:3000
```

Same agent loop, same tools, in a UI a non-technical user could use.

---

## Part 5 — Close (1 min)

### What to remember

1. Tool calling is a **loop**: model → tool → model → answer. If your agent does anything more than one hop, you're running this loop multiple times.
2. The LLM **never runs your code**. It requests; you execute. That's a security feature, not a limitation.
3. Good **descriptions** are the single biggest lever on agent quality. Write them like docs.

### Where to go from here

- Read the [OpenAI tool calling docs](https://platform.openai.com/docs/guides/function-calling) for the full parameter set (tool_choice, parallel calls, structured outputs).
- Try [LangGraph](https://langchain-ai.github.io/langgraphjs/) once you're building agents more complex than a simple loop — it gives you explicit state and persistence.
- Build something you'd actually use. The weather example is a toy — you don't understand tool calling until you've shipped a tool *you care about*.

---

## Quick reference — the loop in code

```ts
let messages = [userMessage];
while (true) {
  const ai = await llm.bindTools(tools).invoke(messages);
  messages.push(ai);

  if (!ai.tool_calls?.length) return ai.content;  // done

  for (const call of ai.tool_calls) {
    const result = await toolsByName[call.name].invoke(call.args);
    messages.push(new ToolMessage({
      content: JSON.stringify(result),
      tool_call_id: call.id!,
    }));
  }
}
```

Memorize this shape. Every agent framework is a variation on it.
