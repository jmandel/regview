import dotenv from "dotenv";
import {
  ehrChunkToFacts,
  createAnswerToQuestion,
  createFactModelForQuestion,
  identifyKeywordsForQuestion,
  transcribeImageToMarkdown,
  transcribeImagesToMarkdown,
} from "./prompts";
import { Keywords } from "./types";
dotenv.config();

import { Questionnaire, QuestionnaireItem } from "fhir/r4";

function extractItemFromQuestionnaire(q: Questionnaire, linkId: string) : QuestionnaireItem | undefined {
  if (q.item) {
    return extractItemFromQuestionnaireItems(item, linkId);
  }
  return undefined;
}

function extractItemFromQuestionnaireItems(items: QuestionnaireItem[], linkId: string) : QuestionnaireItem | undefined {
    for (let item of items) {
      if (item.linkId === linkId) {
        return item;
      }
      if (item.item) {
        let result = extractItemFromQuestionnaireItems(item.item, linkId);
        if (result) return result;
      }
    }
    return undefined;
}

function applyRegex(expression: Keywords | string, input: string): boolean {
  if (typeof expression === "string") {
    const regex = new RegExp(expression, "gim");
    return regex.test(input);
  }

  if ("or" in expression) {
    return expression.or.some((exp: any) => applyRegex(exp, input));
  }

  if ("and" in expression) {
    return expression.and.every((exp: any) => applyRegex(exp, input));
  }

  return false;
}

import fs from "fs";
import path from "path";

class PatientFile {
  public ehr: {
    filename: string;
    part: number;
    type: "note" | "fhir";
    content: string;
  }[] = [];

  constructor(private dir: string) {
    this.readFiles();
  }

  get ehrChunks() {
    return this.ehr.map((e) => ({
      ...e,
      contentString:
        typeof e.content === "string" ? e.content : JSON.stringify(e.content),
    }));
  }

  readFiles() {
    const files = fs.readdirSync(this.dir);
    files.forEach((file) => {
      const filePath = path.join(this.dir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      if (file.endsWith(".md") || file.endsWith(".txt")) {
        for (let i = 0; i < content.length; i += 10000) {
          this.ehr.push({
            filename: file,
            part: i,
            type: "note",
            content: content.slice(i, i + 10000),
          });
        }
      } else if (file.endsWith(".json")) {
        const jsonContent = JSON.parse(content);
        if (jsonContent.resourceType === "Bundle" && jsonContent.entry) {
          jsonContent.entry.forEach((entry: any, i: number) => {
            this.ehr.push({
              filename: file,
              part: i,
              type: "fhir",
              content: entry.resource,
            });
          });
        } else {
          this.ehr.push({
            filename: file,
            part: 0,
            type: "fhir",
            content: jsonContent,
          });
        }
      }
    });
  }
}

import { program } from "commander";

program
  .option("-i, --images <type>", "PNG directory")
  .option("-s, --start-page <type>", "Start page")
  .option("-e, --end-page <type>", "End page")
  // concurrncy number defaulting to 5
  .option("-c, --concurrency <number>", "Concurrency", 5)


program.parse(process.argv);
const options = program.opts();
console.log(options)
await transcribeImagesToMarkdown(options.images + ".cache", options.startPage, options.endPage, options.concurrency);


// pdftk  2023-07229.pdf burst  output cache/%03d.pdfpdf
// convert cache/*.pdf cache/%03d.png
// convert cache/*.pdf -background white -alpha remove -alpha off  cache/%03d.png