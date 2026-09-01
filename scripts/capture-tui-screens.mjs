import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { renderToHtml } from "../agent-manager/node_modules/@profullstack/hqtui/dist/testing.js";
import { executeAfdUseCase } from "../agent-manager/dist/application-service.js";
import { createTuiState, selectCapability, selectCategory } from "../agent-manager/dist/tui/state.js";
import { drawAfdTui } from "../agent-manager/dist/tui/view.js";

const output = path.resolve("docs", "images", "tui");
const temporary = path.resolve(".tui-capture");
const playwrightRoot = process.env.AFD_PLAYWRIGHT_ROOT;
if (!playwrightRoot) throw new Error("Set AFD_PLAYWRIGHT_ROOT to a Playwright package directory for PNG capture.");
const { chromium } = await import(pathToFileURL(path.join(playwrightRoot, "index.mjs")).href);
const edge = process.env.AFD_EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

await mkdir(output, { recursive: true });
await mkdir(temporary, { recursive: true });
const scenes = [];
const docContext = "C:\\work\\ai-foundry-desk";
const redact = (value) => {
  let result = value.replaceAll(process.cwd(), docContext);
  for (const privateValue of [process.env.USERPROFILE, process.env.HOME]) if (privateValue) result = result.replaceAll(privateValue, "%USERPROFILE%");
  if (process.env.USERNAME) result = result.replace(new RegExp(process.env.USERNAME, "gi"), "<user>");
  result = result.replace(/context=hybrid; account=[^;\s]+; declaredUser=[^;\s]+; profile=[^\s]+/g, "context=hybrid; account=<sandbox>; declaredUser=<user>; profile=<profile>");
  return result.split(/\r?\n/).map((line) => line.length > 108 ? `${line.slice(0, 105)}...` : line).join("\n");
};
const prepare = (state) => { state.contextLabel = docContext; return state; };

const overview = prepare(createTuiState());
scenes.push(["overview", overview]);

const connections = prepare(createTuiState());
selectCategory(connections, 3);
selectCapability(connections, 3);
scenes.push(["connections", connections]);

const project = prepare(createTuiState());
selectCategory(project, 6);
selectCapability(project, 1);
scenes.push(["project-workflow", project]);

const confirmation = prepare(createTuiState());
selectCategory(confirmation, 3);
selectCapability(confirmation, 4);
confirmation.commandText = "mcp sync --scope effective --confirm 8c29e4f-reviewed-plan";
confirmation.commandCursor = confirmation.commandText.length;
confirmation.confirm = true;
scenes.push(["confirmation", confirmation]);

const result = prepare(createTuiState());
const doctor = await executeAfdUseCase(["doctor"]);
result.execution = { ...doctor, events: doctor.events.map((event) => ({ ...event, text: redact(event.text) })) };
result.commandText = "doctor";
result.commandCursor = result.commandText.length;
result.screen = "output";
scenes.push(["doctor-result", result]);

const browser = await chromium.launch({ executablePath: edge, headless: true });
try {
  for (const [name, state] of scenes) {
    const html = renderToHtml((args) => drawAfdTui(args, state), { width: 120, height: 40, theme: "dark", fontSize: 15, padding: 18, className: "afd-tui-capture" });
    const htmlPath = path.join(temporary, `${name}.html`);
    await writeFile(htmlPath, html, "utf8");
    const page = await browser.newPage({ viewport: { width: 1900, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.locator("pre.afd-tui-capture").evaluate((element) => { element.style.display = "inline-block"; element.style.width = "120ch"; element.style.overflow = "hidden"; });
    await page.locator("pre.afd-tui-capture").screenshot({ path: path.join(output, `${name}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Captured ${scenes.length} production-rendered TUI screens in ${output}`);
