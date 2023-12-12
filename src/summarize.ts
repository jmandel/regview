import fs from "fs";
import OpenAI from "openai";

const tree = JSON.parse(fs.readFileSync("cures-final.json"));
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_API_ORG,
});


class RequestPool {
  constructor(maxParallelRequests) {
    this.maxParallelRequests = maxParallelRequests;
    this.queue = [];
    this.activeRequests = 0;
  }

  enqueue(request) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        request,
        resolve,
        reject,
      });
      this.processNext();
    });
  }

  async processNext() {
    if (this.activeRequests >= this.maxParallelRequests || this.queue.length === 0) {
      return;
    }

    this.activeRequests++;
    const { request, resolve, reject } = this.queue.shift();

    try {
      const result = await request();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.activeRequests--;
      this.processNext();
    }
  }
}

// Usage:
const pool = new RequestPool(5);
let n = 0;
function countNodes(node) {
  let count = 1; // Count the current node
  if (node?.children?.length) {
    node.children.forEach((child) => {
      count += countNodes(child); // Recursively count children
    });
  }
  return count;
}

import { CacheManager } from "./CacheManager";
const summaryCache = new CacheManager("summaryCache.json");
c
async function summarizeOneSnippet(position, text) {
    const cachedResult = summaryCache.get(text);
    if (cachedResult) {
      return cachedResult;
    }

  const messages = [
    {
      role: "system",
      content:
        "You are a Health IT technology and regulatory expert, well versed in ONC",
    },

    {
      role: "user",
      content:
        `Summarize the following regulatory text, reducing it to plain language without adding any commentary, and using a clear tone similar to Paul Graham. Use active voice, jargon-free, and do not preface comments with contextualization or other preamble. Condense considerably.

Position in Regulation: ${position}

\`\`\`
${text}
\`\`\`

Your output uses JSON in the following format:

interface Response {
    summary: string; // Markdown with your overall summary content
    changesFromProposal?: string; // Markdown with bullet list showing any important categories of changes from the proposal (omit if this does not apply)
    keyPointsByAudience?: {
        audience: "ehr-developer" | "regulator" | "healthcare-provider" | "patient"; // The audience for this key point
        point: string // markdown formatted key points, in 2nd person
    }[] 
}
`,
    },
  ];

  const response = await  pool.enqueue(async () =>  {
    console.log("Req", n++, text.slice(0, 1000));
    return  client.chat.completions.create({
        model: "gpt-4-1106-preview",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: messages as any,
    })
    }
  ) 
  try {
    const ret = JSON.parse(response.choices[0].message.content!);
    summaryCache.set(text, ret)
    console.log(ret);
    return ret;
  } catch (e) {
    return { failed: (e as any)?.message };
  }
}

function getNodePosition(node, parents) {
    // use titles from the root down to tihs node
    let titles = parents.map((p) => p.title);
    titles.push(node.title);
    return titles.join(" > ");
}

function getAllText(node) {
  if (!node) return "";
  let text = node.text || "";
  if (node.children && node.children.length) {
    node.children.forEach((child) => {
      text += "\n" + getAllText(child);
    });
  }
  return text;
}

function getAllSummaryText(summaries) {
  let text = "";
  for (const summary of summaries) {
    if (summary) {
      if (summary.summary) {
        text += "\n" + summary.summary;
      }
      if (summary.changesFromProposal) {
        text += "\n" + summary.changesFromProposal;
      }
      if (summary.keyPointsByAudience) {
        summary.keyPointsByAudience.forEach((keyPoint) => {
          text += "\n" + keyPoint.audience + ": " + keyPoint.point;
        });
      }
    }
  }
  return text;
}

onst MAX_TEXT_SIZE = 4 * 2500;
async function summarizeTree(node, parents = []) {
  if (!node) return;
  const text = getAllText(node);
  const nodePosition = getNodePosition(node, parents);

  let summarized = [];
    if (node.children && node.children.length) {
      await Promise.all(node.children.map(async (child) => {
        await summarizeTree(child, [...parents, node]); // Recursive call
        if (child?.summary) {
          summarized.push(child.summary);
        }
      }));
    }

  if (text.length <= MAX_TEXT_SIZE) {
    // Summarize directly if total text size is within the limit
    node.summary = await summarizeOneSnippet(nodePosition, text);
  } else {
    // If text size is too big, summarize each child and then summarize these summaries
    node.summary = await summarizeOneSnippet(nodePosition, node?.text + "\n\n" + getAllSummaryText(summarized));
  }
}

console.log(countNodes(tree.children[3]));
await summarizeTree(tree.children[3]);
fs.writeFileSync("cures-final.summary.json", JSON.stringify(tree, null, 2));
