# AI Tooling — Tool Calling with OpenAI, LangChain, and LangSmith

Classroom companion repo for the "Tool Calling" lecture. TypeScript, no build step (run with `tsx`).

## Branches

| Branch  | What's in it                                                          |
| ------- | --------------------------------------------------------------------- |
| `start` | Lessons 1–3 are complete and runnable. Lesson 4 (homework) is stubs.  |
| `end`   | Everything, including the homework solutions.                         |

Students should check out `start`, walk through lessons 1–3 with the instructor, then complete the homework in `src/04-homework.ts`. Compare your solution against `end` when you're done.

## Prerequisites

- Node.js 18 or newer (`node --version`)
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A [LangSmith API key](https://smith.langchain.com) (free tier is plenty)

## Setup

```bash
git clone https://github.com/jacobmaxplumb/ai-tooling.git
cd ai-tooling
git checkout start

cp .env.sample .env
# open .env in your editor and paste your keys

npm install
```

## Running each lesson

```bash
npm run lesson:1    # OpenAI native tool calling (weather)
npm run lesson:2    # Same thing, rewritten in LangChain
npm run lesson:3    # Multi-tool agent traced in LangSmith
npm run homework    # The four exercises in src/04-homework.ts
```

After running lesson 3, open [smith.langchain.com](https://smith.langchain.com), select the project named in `LANGSMITH_PROJECT` (default: `ai-tooling-class`), and inspect the trace.

## What's in each file

```
src/
├── 01-openai-tool-calling.ts      OpenAI SDK, hand-written JSON schema
├── 02-langchain-tool-calling.ts   LangChain tool() + Zod schema + bindTools
├── 03-langsmith-observability.ts  Multi-tool agent loop; traces auto-sent
└── 04-homework.ts                 Build: quadratic solver, Fibonacci, FX
```

## The lecture itself

Read [`LECTURE.md`](./LECTURE.md) for the full instructor script — concepts, code walkthroughs, LangSmith deep dive, and homework framing.
