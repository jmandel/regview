import fs from "fs";
import OpenAI from "openai";
import { program } from 'commander';

program
  .option('-i, --input <file>', 'input file')
  .option('-o, --output <file>', 'output file')
  .parse(process.argv);

const options = program.opts();

if (!options.input) {
  console.error('No input file provided!');
  process.exit(1);
}

if (!options.output) {
  console.error('No output file provided!');
  process.exit(1);
}


const tree = JSON.parse(fs.readFileSync(options.input));

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
const pool = new RequestPool(20);
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

async function summarizeOneSnippet(position, text) {
    const cachedResult = summaryCache.get(text);
    if (cachedResult) {
      return cachedResult;
    }

  const messages = [
    {
      role: "system",
      content:
        "You are a Health IT technology and regulatory assistant, well versed in ONC language. You are reading regulations published by ONC, and these regulations include review of (and response to) public comments. You are summarizing the regulations for a general audience, including healthcare providers, patients, and other stakeholders.",
    },

    {
      role: "user",
      content:
        `Summarize the following regulatory section, reducing it to plain language without adding any commentary, and using a clear tone similar to Paul Graham. Focus on what has been finalized, but you can include some of the rationale and background also, Use active voice, jargon-free, do not preface comments with contextualization or preamble. Condense considerably.

Breadcrumb: ${position}

\`\`\`
${text}
\`\`\`

Your output uses JSON in the following format:

interface Response {
    summary: string; // Markdown with your summary content -- focus on what is being required, then explore any nuances, limitations, or exceptions
    changesFromProposal?: string; // Markdown with bullet list showing important changes between proposal and final rule (omit if this does not apply)
    keyPointsByAudience?: {
        audience: "ehr-developer" | "healthcare-provider" | "patient"; // The audience for this key point
        point: string // markdown formatted key points, in 2nd person
    }[] 
}
`,
    },
  ];

  const response = await  pool.enqueue(async () =>  {
    console.log("Req", n++, position, text.slice(0, 100), text.length, text);
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
    console.log(position, ret);
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

function getAllSummaryText(children) {
  let text = "";
  for (const child of children) {
      text += `\n\nSub-Part: ${child.title} \n\n` + child.summary.summary;
      // if (child.summary.changesFromProposal) {
      //   text += "\nChanges from proposal: \n" + child.summary.changesFromProposal;
      // }
      // if (child.summary.keyPointsByAudience) {
      //   child.summary.keyPointsByAudience.forEach((keyPoint) => {
      //     text += "\nKey Point for " + keyPoint.audience + ": " + keyPoint.point;
      //   });
      // }
  }
  return text;
}

const MAX_TEXT_SIZE = 4 * 2500;
async function summarizeTree(node, parents = []) {
  console.log("Summarizing", getNodePosition(node, parents));
  if (!node) return;
  const text = getAllText(node);
  const nodePosition = getNodePosition(node, parents);

  let summarized = [];
  if (node.children && node.children.length) {
    await Promise.all(node.children.map(async (child) => {
      await summarizeTree(child, [...parents, node]); // Recursive call
      if (child?.summary) {
        summarized.push(child);
      }
    }));
  }
  // summarized = node.children

  if (text.length <= MAX_TEXT_SIZE) {
    // Summarize directly if total text size is within the limit
    console.log("Direct summary", getNodePosition(node, parents));
    node.summary = await summarizeOneSnippet(nodePosition, text);
  } else {
    // If text size is too big, summarize each child and then summarize these summaries
    console.log("recursive summary", getNodePosition(node, parents));
    node.summary = await summarizeOneSnippet(nodePosition, node?.text + "\n\n" + getAllSummaryText(summarized));
  }
    console.log("Completed summary", getNodePosition(node, parents));
}

console.log(countNodes(tree));
for (const child of tree.children) {
  await summarizeTree(child);
}
fs.writeFileSync(options.output, JSON.stringify(tree, null, 2));
