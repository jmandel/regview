import OpenAI from "openai";
import { QuestionnaireItem } from "fhir/r4";
import { ChatCompletionMessage } from "openai/resources/index.mjs";
import { CacheManager } from "./CacheManager";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_API_ORG,
});

const kwCache = new CacheManager("kwCache.json");

export async function identifyKeywordsForQuestion(
  q: QuestionnaireItem,
  config?: { skipCache: boolean }
) {
  if (!config?.skipCache) {
    const cachedResult = kwCache.get(q.text ?? q.linkId);
    if (cachedResult) {
      return cachedResult;
    }
  }

  const response = await client.chat.completions.create({
    // model: "gpt-3.5-turbo-1106",
    model: "gpt-4-1106-preview",
    temperature: 0.9,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a clinical data abstraction expert with deep knowledge of EHR formats, semantic search, tf–idf, and typescript interfaces",
      },

      {
        role: "user",
        content: `Based on the my question, please identify a query we can use to search the EHR for relevant snippets of information.

Your query should use "and" and "or" tree structure help us find relevant information. Keep them simple and short, and broad. 

## Step 1. Break the question into essential noun concepts

Focus on essential concepts that will appear explicitly in EHR.

Omit any implicit concepts like "diagnosis", "treatment", etc.

For example, for a question like "any history of head injury" -- the words "any history" are not part of the noun concept. The core noun concept is "head injury", so we'll AND a subquery for "head" with a subquery for "injury", then OR in any specific additoinal terms for head injury.

* NEVER query for words "record", "history", "diagnosis", "prescription", "treatment"; these are implicit concepts.

* NEVER query for like "when" or "in what year"; these are impliclit concepts. 

## Step 2. Create queries to triangulate each noun concept
* All keywords should be stemmed -- strip suffixes like "ing" and remove plurals
* Use many clinical expressions, synonyms, and related terms
* Include clinical abbreviations and acronyms and patient-friendly terms
* Expand categories into specific examples with "or"

Your output uses JSON in the following format:

type Keywords {
    and:(string | Keywords)[];
} | {
    or: (string | Keywords)[];
}
`,
      },
      { role: "user", content: "Have you ever had a head injury?" },
      {
        role: "system",
        content: JSON.stringify({
          or: [
            "TBI",
            "concussion",
            {
              and: [
                { or: ["head", "brain", "skull"] },
                { or: ["injury", "trauma", "accident", "fracture"] },
              ],
            },
          ],
        }),
      },
      {
        role: "user",
        content: "Have you ever taken medication for high blood pressure?",
      },
      {
        role: "system",
        content: JSON.stringify({
          or: [
            "antihypertens",
            {
              or: [
                "ACE",
                "ARB",
                "angiotensin",
                "beta block",
                "diuretic",
                "calcium channel block",
                "renin inhibitor",
                "alpha block",
                "vasodilat",
              ],
            },
            {
              or: [
                "lisinopril",
                "losartan",
                "amlodipine",
                "hydrochlorothiazide",
                "metoprolol",
                "atenolol",
                "enalapril",
                "valsartan",
                "diltiazem",
                "spironolactone",
                "furosemide",
                "ramipril",
                "bisoprolol",
                "propranolol",
              ],
            },
          ],
        }),
      },
      { role: "user", content: JSON.stringify(q.text) },
    ],
  });
  const ret = JSON.parse(response.choices[0].message.content!);
  kwCache.set(q.text ?? q.linkId, ret);
  return ret;
}

const factModelCache = new CacheManager("factModelCache.json");

export async function createFactModelForQuestion(
  q: QuestionnaireItem,
  config?: { skipCache: boolean }
) {
  if (!config?.skipCache) {
    const cachedResult = factModelCache.get(q.text ?? q.linkId);
    if (cachedResult) {
      return cachedResult;
    }
  }
  const messages = [
    {
      role: "system",
      content:
        "You are a clinical data abstraction expert with deep knowledge of EHR formats and typescript interfaces",
    },
    {
      role: "user",
      content: `
Based on my question, I need a "fact model" and data abstraction instructions for an EHR data abstraction team. The team will process EHR data in chunks, populating instances of the fact model. Their parallel work demands a fact model suitable for monotonic aggregation. The fact model should consist of TypeScript interfaces for populating a database to answer the clinical question.

* Do not include elements for patient identification; the abstraction team will always be working in the context of a single patient.
* Account for dates because downstream summarization may depend on them
* Model components and inputs that can help answer the question even if no direct answer is present in the EHR
* All elements should be optional if they might ever be missing from the EHR when a fact is being created.
* If you have several distinct fact types, define FactModel as a disjoint union of those types.

Begin your output with a ${"```typescript"} code block with an interface named FactModel, including dependent interfaces or types. The data abstraction team will create FactModel[] arrays for each chunk of EHR the process, so your FactModel does not need internal arrays.

Provide detailed commentary as instructions for the data abstraction team. They will be working with plain text EHR chunks, so include sufficient context to guide them in:
 * Identifying relevant information.
 * Determining when to create facts and when to discard irrelevant data.
`,
    },
    { role: "user", content: JSON.stringify(q) },
  ];
  // console.log(messages)
  const response = await client.chat.completions.create({
    // model: "gpt-3.5-turbo-1106",
    model: "gpt-4-1106-preview",
    temperature: 0.9,
    messages: messages as ChatCompletionMessage[],
  });
  const ret = response.choices[0].message.content;
  factModelCache.set(q.text ?? q.linkId, ret);
  return ret;
}

const factCache = new CacheManager("factCache.json");
export async function ehrChunkToFacts(
  instructions: string,
  ehrChunk: string,
  config?: { skipCache: boolean }
) {
  if (!config?.skipCache) {
    const cachedResult = factCache.get(instructions + ehrChunk);
    if (cachedResult) {
      return cachedResult;
    }
  }

  const response = await client.chat.completions.create({
    // model: "gpt-3.5-turbo-1106",
    model: "gpt-4-1106-preview",
    temperature: 0.9,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are the leader of a clinical data abstraction expert with deep knowledge of EHR formats and typescript interfaces.",
      },
      {
        role: "user",
        content: instructions,
      },
      {
        role: "user",
        content:
          `Here is an EHR chunk. Perform abstractions and return a a JSON object with {"result": FactModel[]}. The FactModel[] array can have 0, 1, or more elements\n\n---\n` +
          ehrChunk,
      },
    ],
  });
  const ret = JSON.parse(response.choices[0].message.content!);
  factCache.set(instructions + ehrChunk, ret);
  return ret;
}

const finalAnswerCache = new CacheManager("finalAnswerCache.json");

export async function createAnswerToQuestion(
  q: QuestionnaireItem,
  facts: any[],
  config?: { skipCache: boolean }
) {
  const factsString = JSON.stringify(facts, null, 2);
  if (!config?.skipCache) {
    const cachedResult = finalAnswerCache.get(q.text + factsString);
    if (cachedResult) {
      return cachedResult;
    }
  }

  const response = await client.chat.completions.create({
    model: "gpt-4-1106-preview",
    // model: "gpt-3.5-turbo-1106",
    temperature: 0.9,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a clinical informatics expert with deep knowledge of EHR formats and FHIR.",
      },
      {
        role: "user",
        content: `

# Question
${JSON.stringify(q, null, 2)}

# Facts
${factsString}

# Answer format

Based on my question, please create an answer, using the supplied facts.

Output a JSON QuestionnaireResponse.item like

{ // Groups and questions
    "linkId" : "<string>", // R!  Pointer to specific item from Questionnaire
    "definition" : "<uri>", // ElementDefinition - details for the item
    "text" : "<string>", // Name for group or question text
    "answer" : [{ // The response(s) to the question
      // value[x]: Single-valued answer to the question. One of these 12:
      "valueBoolean" : <Gboolean>,
      "valueDecimal" : <decimal>,
      "valueInteger" : <integer>,
      "valueDate" : "<date>",
      "valueDateTime" : "<dateTime>",
      "valueTime" : "<time>",
      "valueString" : "<string>",
      "valueUri" : "<uri>",
      "valueAttachment" : { Attachment },
      "valueCoding" : { Coding },
      "valueQuantity" : { Quantity },
      "valueReference" : { Reference(Any) },
      "item" : [{ Content as for QuestionnaireResponse.item }] // Nested groups and questions
    }
`,
      },
    ],
  });

  const ret = JSON.parse(response.choices[0].message.content!);
  finalAnswerCache.set(q.text + factsString, ret);
  return ret;
}

import fs from "fs/promises";

export const transcribeImageToMarkdown = async (
  imagePath: string,
) => {
  const image = await fs.readFile(imagePath);
  const base64Image = image.toString("base64");

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `Your task is to transcribe this image into accurate HTML with semantic tags for headings(H1-H5), paragraphs (P), bold (B), underline (U), italic (I), and tables (TABLE, TH, TR, TD, etc). Do not output a ${"```"} code block or preamble, just HTML.

When creating headings, always preserve numbering/lettering like "IV", "C.", "7.", "xi.", "g.".
* Example Text: "B. Application Access"
* Output: "<H1>B. Application Access</H1>"

For footnotes: use <p class="footnote">
Do not use "<section>" "<ol>" or "<li> tags.

Start at the top of the page. Include all text verbatim, including any partial content at top and bottom of page.`,
      },
      {
        type: "image_url",
        image_url: {
          // base64 encoded image from imagePath
          url: `data:image/png;base64,${base64Image}`,
          detail: "high",
        },
      },
    ],
  };
};
class RequestQueue {
  constructor(maxParallelRequests, maxRetries = 3) {
    this.maxParallelRequests = maxParallelRequests;
    this.maxRetries = maxRetries;
    this.queue = [];
    this.activeRequests = 0;
    this.results = new Map();
  }

  push(request) {
    this.queue.push(request);
    this.processNext();
  }

  async processNext() {
    if (this.activeRequests >= this.maxParallelRequests || this.queue.length === 0) {
      return;
    }

    this.activeRequests++;
    const request = this.queue.shift();

    try {
      const result = await request();
      this.results.set(request, { status: 'fulfilled', value: result });
    } catch (error) {
      console.error(`Request failed: ${error}`);
      // retry maxRetires times
      for (let i = 0; i < this.maxRetries; i++) {
        try {
          const result = await request();
          await new Promise(resolve => setTimeout(resolve, 5000));
          this.results.set(request, { status: 'fulfilled', value: result });
          break;
        } catch (retryError) {
          console.error(`Retry failed: ${retryError}`);
          this.results.set(request, { status: 'rejected', reason: retryError });
        }
      }

      try {
        const result = await request();
        this.results.set(request, { status: 'fulfilled', value: result });
      } catch (retryError) {
        console.error(`Retry failed: ${retryError}`);
        this.results.set(request, { status: 'rejected', reason: retryError });
      }
    } finally {
      this.activeRequests--;
      this.processNext();
    }
  }

  async waitUntilAllDone() {
    while (this.activeRequests > 0 || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return this.results;
  }
}
const NUM_REQUESTS = 5; // Set your desired number of parallel requests

import fsPlain from "fs"
export async function transcribeImagesToMarkdown(
  imageDir: string,
  startPage = 1,
  endPage = 2000,
  concurrency = NUM_REQUESTS
) {

  let images = await fs.readdir(imageDir);
  images.sort()
  images = images
    .filter((i) => i.endsWith(".png"))
    .map((i) => `${imageDir}/${i}`);
  images = images.slice(startPage-1, endPage);
  images = images.filter((i) => !fsPlain.existsSync(i.replace(".png", ".html")));
  console.log("Fetch", startPage, endPage, images)

  const queue = new RequestQueue(concurrency);
  for (const i of images) {
    queue.push(() => transcribeImage(i));
  }

  const results = await queue.waitUntilAllDone();
  console.log(results);
  return results;
}


async function transcribeImage(i: string) {
    let messages = [
      {
        role: "system",
        content: "You are a meticulous HTML formatting assistant",
      },
      (await transcribeImageToMarkdown(i)) as any,
    ];
    console.log(i);
    const response = await client.chat.completions.create({
      model: "gpt-4-vision-preview",
      temperature: 0,
      messages,
      max_tokens: 4096,
    });

    console.log(i, response);
    const ret = response.choices[0].message.content;
    // write to file in image dir
    const md = ret!; // extract markdown blocok
    const filename = i.replace(".png", ".html");
    await fs.writeFile(filename, md);

  return ret;
}

const { JSDOM } = require("jsdom");

export function parseText(file: string) {
  let lines = fsPlain.readFileSync(file, "utf-8").replace(/\f/g, '');

  // Constructing the regular expression
  let regex = new RegExp("RIN 0955-AA03.*?official HHS-approved document\.", "gsm");

  // Example use
  lines = lines.replace(regex, '');
  //console.log(lines)


  const navigationPath = lines.split("\n").reduce(
    (acc, line) => {

      if (!line.includes(".")) {
        acc.processed.at(-1)[0].text += line  + "\n";
        return acc;
      }

      const text = line.split(". ")[0] + ".";

      // Determine the valid successors to the current path
      const LOOKAHEAD = 3;
      const validSuccessors = [];
      for (let j = 0; j< LOOKAHEAD;j++) {
        validSuccessors.push(acc.path.concat([j]));
      }

      for (let i = acc.path.length-1; i >=0; i--) {
        for (let j = 0; j < LOOKAHEAD;j++) {
          validSuccessors.push(
            acc.path.slice(0, i).concat((acc.path[i] || -1) + j + 1)
          );
        }
      }
      //console.log("Line", line, text, validSuccessors, "FROM", acc.path)

      // Determine the text for the final component of each valid successor
      const successorTexts = validSuccessors.map((successor) => {
        if (successor.length === 0) return "I";
        const level = successor.length - 1;
        switch (level) {
          case 0:
            return toRoman(successor[successor.length - 1] + 1); // Roman numerals
          case 1:
            return String.fromCharCode(
              64 + successor[successor.length - 1] + 1
            ); // Capital letters
          case 2:
            return successor[successor.length - 1] + 1; // Arabic numerals
          case 3:
            return String.fromCharCode(
              96 + successor[successor.length - 1] + 1
            ); // Lowercase letters

          case 4:
            return toRoman(successor[successor.length - 1] + 1).toLowerCase(); // Lowercase Roman numerals
          default:
            return null;
        }
      });

      // Ignore the heading if its text doesn't match any of the successor texts
      //console.log(text, successorTexts, validSuccessors)
      if (
        !successorTexts.some(
          (regex) => regex && new RegExp("^" + regex+"\.$").test(text)
        )
      ) {
        acc.processed.at(-1)[0].text += line  + "\n";
        //console.log("Accumulate", acc.processed.at(-1)[0])
        return acc;
      }

      // Determine the level based on the matching successor text
      const levelIndex = successorTexts.findIndex(
        (regex) => regex && new RegExp("^" + regex + "\.$").test(text)
      );


      // Update the path
      acc.path = validSuccessors[levelIndex]
      const level = validSuccessors[levelIndex].length-1
      //console.log("new level", line, acc.path, level)

      // Add the heading to the processed list
      acc.processed.push([{title: line, text: "", children: []}, [...acc.path]]);
      return acc;
    },
    { processed: [[{title: "Root", text: "", chidren: []}, []]], path: [] }
  );

  //console.log("REady to stitch", JSON.stringify(navigationPath, null, 2))
  return stitchTree(navigationPath.processed)
}


function stitchTree(data) {
  let lastFootnoteNumber = 0;
    // Define the root of the tree
    let  root = {children: []};

    // Helper function to insert a node into the tree
    function insertNode(node, path) {
        let current = root;
        for (let i = 0; i < path.length-1; i++) {
            if (!(path[i] in current.children))
            {
                current.children[path[i]] = { path: path.slice(0, i), children: [] };
            }
            current = current.children[path[i]];
        }
        //console.log("Pushing to", node.title, current.path, node.path)
        current.children[path.at(-1)] = node
    }

    // Iterate over the data to build the tree
    data.slice(1).forEach(item => {
        let itemText;
        [itemText, lastFootnoteNumber] =preprocessText(item[0].text, lastFootnoteNumber)
        //console.log("REaching", JSON.stringify(item), "\n\nITEMRAW:" + item[0].text, "\n\nItemText" + itemText);
        let node = {
            title: item[0].title,
            text: itemText,
            path: item[1],
            children: []
        };
        insertNode(node, item[1]);
    });

    return root;
}


function parseHtml(html: string) {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, b, i, u, p"));

  const navigationPath = headings.reduce(
    (acc, heading) => {
      const text = heading.textContent.trim().split(".")[0] + ".";

      // Determine the valid successors to the current path
      const LOOKAHEAD = 3;
      const validSuccessors = [];
      for (let i = 0; i < acc.path.length; i++) {
        for (let j = 0; j < LOOKAHEAD;j++) {
          validSuccessors.push(
            acc.path.slice(0, i).concat((acc.path[i] || -1) + j + 1)
          );
        }
      }
      for (let j = 0; j< LOOKAHEAD;j++) {
        validSuccessors.push(acc.path.concat([j]));
        }

      // Determine the text for the final component of each valid successor
      const successorTexts = validSuccessors.map((successor) => {
        if (successor.length === 0) return "I";
        const level = successor.length - 1;
        switch (level) {
          case 0:
            return toRoman(successor[successor.length - 1] + 1); // Roman numerals
          case 1:
            return String.fromCharCode(
              64 + successor[successor.length - 1] + 1
            ); // Capital letters
          case 2:
            return successor[successor.length - 1] + 1; // Arabic numerals
          case 3:
            return String.fromCharCode(
              96 + successor[successor.length - 1] + 1
            ); // Lowercase letters

          case 4:
            return toRoman(successor[successor.length - 1] + 1).toLowerCase(); // Lowercase Roman numerals
          default:
            return null;
        }
      });

      // Ignore the heading if its text doesn't match any of the successor texts
      if (
        !successorTexts.some(
          (regex) => regex && new RegExp("^" + regex+"\.$").test(text)
        )
      ) {
        //console.log("None", text, successorTexts)
        return acc;
      }

      // Determine the level based on the matching successor text
      const levelIndex = successorTexts.findIndex(
        (regex) => regex && new RegExp("^" + regex).test(text)
      );

      const level = validSuccessors[levelIndex].length-1

      //console.log("Updating", acc.path,  text + " to level " + level, successorTexts);
      // Update the path
      acc.path = validSuccessors[levelIndex]
      //console.log(acc.path, level)

      // Add the heading to the processed list
      acc.processed.push([heading, [...acc.path]]);

      return acc;
    },
    { processed: [], path: [] }
  );

  navigationPath.processed.forEach(([heading, path]) => {
    const h = dom.window.document.createElement(`h${path.length}`);
    h.innerHTML = heading.innerHTML;
    // assign a data attribute with the full path
    h.setAttribute("data-path", JSON.stringify(path));
    heading.parentNode.replaceChild(h, heading);
  });

  // find any h1-h6 that desont ahve a data-path attribute and change the header ot h6
  const headings2 = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  headings2.forEach((heading) => {
    if (!heading.hasAttribute("data-path")) {
      const h = dom.window.document.createElement(`h6`);
      h.innerHTML = heading.innerHTML;
      heading.parentNode.replaceChild(h, heading);
    }
  });

  return dom.window.document.body.innerHTML
}

function toRoman(num) {
  const roman = [
    "M",
    "CM",
    "D",
    "CD",
    "C",
    "XC",
    "L",
    "XL",
    "X",
    "IX",
    "V",
    "IV",
    "I",
  ];
  const decimal = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  let result = "";
  for (let i = 0; i < decimal.length; i++) {
    while (num % decimal[i] < num) {
      result += roman[i];
      num -= decimal[i];
    }
  }
  return result;
}

function toLetter(num) {
  return String.fromCharCode(64 + num);
}

const path = require("path");

export async function loadAndParseHtmls(htmlPath: string) {
  const html = await fs.readFile(path.join(htmlPath), "utf-8");
  // remove any ```html and ``` markers
  const htmlFixed = html.replace(/```html/g, "").replace(/```/g, "");

  let parsed = parseHtml(htmlFixed);
  return parsed;



  const t= parseDOM(parsed);

  console.log(t)
function parseDOM(html) {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Flatten the DOM
    const elements = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, table')];

    //fconsole.log(elements)
    // Build the tree structure
    const tree = buildTree(elements);

    return tree;
}

function buildTree(elements) {
    const rootNode = { title: 'Root', children: [] };
    let currentPath = [];
    let nodeMap = { '': rootNode };

    elements.forEach(element => {
        const dataPath = element.getAttribute('data-path');
        if (dataPath) {
            const path = dataPath.split(',');
            updateCurrentPath(currentPath, path);
            const node = createNode(element);
            insertNode(nodeMap, currentPath, node);
        } else if (element.tagName === 'P' || element.tagName === 'TABLE') {
            const parentPath = currentPath.join(',');
            nodeMap[parentPath].text = (nodeMap[parentPath].text || '') + element.outerHTML;
        }
    });

    return rootNode;
}

function updateCurrentPath(currentPath, newPath) {
    while (currentPath.length > newPath.length) {
        currentPath.pop();
    }
    newPath.forEach((path, index) => {
        if (currentPath[index] !== path) {
            currentPath[index] = path;
        }
    });
}

function createNode(element) {
    return {
        title: element.textContent.trim(),
        children: [],
        text: ''
    };
}

function insertNode(nodeMap, currentPath, node) {
    const parentPath = currentPath.slice(0, -1).join(',');
    if (!nodeMap[parentPath]) {
      nodeMap[parentPath] = { title: '', children: [] };
    }
    nodeMap[parentPath].children.push(node);
    const nodePath = currentPath.join(',');
    nodeMap[nodePath] = node;
}

}


function separateHeadings(text) {
  return text;
  return text.replace(/(\n)([^\nA-Za-z\s]{5,50})(\n)/g, '\n\n*$2*\n\n');
}


function findAndSuperscriptNumbers(text, footnoteNumber, lineRange) {
  const lines = text.split('\n');
  const startLine = Math.max(0, lineRange.start);
  const endLine = Math.min(lines.length - 1, lineRange.end);
  const footnoteRegex = new RegExp(`([^\s]+)${footnoteNumber}([\s.]|$)`, 'gm');

  //console.log("Looking for ", footnoteNumber, lineRange)
  for (let i = endLine; i >= startLine; i--) {
    //console.log("Looking for ", footnoteNumber, lineRange, lines[i], footnoteRegex)

    if (footnoteRegex.test(lines[i])) {
      //qconsole.log("Found", lines[i])
      lines[i] = lines[i].replace(footnoteRegex, `$1<sup>${footnoteNumber}</sup>$2`);
      break; // Stop after the first match
    }
  }

  return lines.join('\n');
}

function formatFootnotes(text, lastFootnoteNumberIn = 0) {
  if (text === undefined) {
    return ["", lastFootnoteNumberIn]
  }
  let lastFootnoteNumber = lastFootnoteNumberIn;
  const maxFootnoteJump = 10;
  return [text.replace(/^(\d+)$/gm, (match, footnoteNumber) => {
    footnoteNumber = parseInt(footnoteNumber, 10);
    //console.log("Repl", footnoteNumber, lastFootnoteNumber)
    if (footnoteNumber > lastFootnoteNumber && footnoteNumber <= lastFootnoteNumber + maxFootnoteJump) {
      lastFootnoteNumber = footnoteNumber;
      //console.log("update", match, footnoteNumber)
      return `\nFootnote ${footnoteNumber}:`;
    } else {
      // If the footnote is out of order, keep it unchanged
      return match;
    }
  }), lastFootnoteNumber];
}

function insertParagraphBreaksAndFormatTitles(text) {
  const lines = text.split('\n');
  let newText = '';
  let isStartOfParagraph = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';

    // Format specific starting words in italics
    if (isStartOfParagraph) {
      if (line.startsWith('Comments.')) {
        newText += `*Comments.*${line.substring(9)}\n`;
      } else if (line.startsWith('Response.')) {
        newText += `*Response.*${line.substring(9)}\n`;
      } else if (line.match(/^[A-Z\s]+$/) && line.length < 50) {
        // Format as bold and add a newline for capitalized titles
        newText += `**${line}**\n\n`;
      } else {
        newText += line + '\n';
      }
    } else {
      newText += line + '\n';
    }

    // Determine if the next line is the start of a new paragraph
    if (line === '' || (line.match(/[.”"]$/) && nextLine && nextLine[0] === nextLine[0].toUpperCase())) {
      isStartOfParagraph = true;
      newText += '\n'; // Add a paragraph break
    } else {
      isStartOfParagraph = false;
    }
  }

  return newText;
}


function preprocessText(text, lastFootnoteNumberIn = 0) {
  let lastFootnoteNumber = lastFootnoteNumberIn;
  let processedText = text;
  processedText = separateHeadings(processedText);
  [processedText, lastFootnoteNumber] = processedText = formatFootnotes(processedText, lastFootnoteNumber);
  processedText = insertParagraphBreaksAndFormatTitles(processedText);

  //console.log("proc", processedText, lastFootnoteNumber)
  const lines = processedText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^Footnote (\d+):/);
    if (match) {
      const footnoteNumber = match[1];
      const lineRange = { start: i - 80, end: i - 1 };
      processedText = findAndSuperscriptNumbers(processedText, footnoteNumber, lineRange);
    }
  }

  //console.log("proc done", processedText, lastFootnoteNumber)
  return [processedText, lastFootnoteNumber];
}


export function generateMarkdown(node, depth = 0, lastFootnoteNumberIn = 0) {
  let lastFootnoteNumber = lastFootnoteNumberIn;
  // Base case: If the node is null or undefined, return an empty string
  if (!node) return '';

  // Create the heading tag based on the depth
  const headingTag = `H${Math.min(depth, 5)}`; // Cap the heading level at H5

  // Convert the path array to a string
  const pathString = JSON.stringify(node.path);

  // Start with the node's title in a heading tag with a data-path attribute
  let markdown = ``;
  if (depth > 0) {
    markdown = `<${headingTag} data-path='${pathString}'>${node.title}</${headingTag}>\n\n`;

    // Add the node's text
    let thisNodeText;
    [thisNodeText, lastFootnoteNumber] =  preprocessText(node.text, lastFootnoteNumber)
    //console.log("lastfoot", lastFootnoteNumber)
    if(node.text) markdown += `${thisNodeText}\n\n`;
  }

  // Recursively process each child, increasing the depth
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => {
      let thisNodeText;
      [thisNodeText, lastFootnoteNumber] = generateMarkdown(child, depth + 1, lastFootnoteNumber);
      markdown += thisNodeText
    });
  }

  return [markdown, lastFootnoteNumber];
}


