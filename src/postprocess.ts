import { generateMarkdown, loadAndParseHtmls, parseText } from "./prompts";

//const result = await loadAndParseHtmls(process.argv[2])
//console.log(result)

const result = await parseText(process.argv[2])
//console.log(generateMarkdown(result)[0])
console.log(JSON.stringify(result, null, 2))
