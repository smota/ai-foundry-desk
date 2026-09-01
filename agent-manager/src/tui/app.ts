import process from "node:process";
import { createApp, type KeyEvent } from "@profullstack/hqtui";
import { commandMayWrite, executeAfdUseCase, hasUnresolvedInput, parseCommandField } from "../application-service.js";
import { drawAfdTui, type TuiActions } from "./view.js";
import { createTuiState, paletteMatches, selectCapability, selectCategory, selectFromPalette, selectedCapability } from "./state.js";

function insert(value: string, cursor: number, text: string): { value: string; cursor: number } {
  return { value: value.slice(0, cursor) + text + value.slice(cursor), cursor: cursor + text.length };
}

export async function runTui(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("afd tui requires an interactive terminal. Use the line-oriented afd CLI for non-TTY and screen-reader workflows.\n");
    return 1;
  }
  const state = createTuiState();
  const app = await createApp({
    title: "AI Foundry Desk",
    quitKeys: [],
    alternateScreen: process.env.AFD_TUI_INLINE !== "1",
    theme: process.env.AFD_TUI_THEME ?? "dark",
    monochrome: Boolean(process.env.NO_COLOR),
    reducedMotion: process.env.AFD_TUI_REDUCED_MOTION === "1",
    mouse: process.env.AFD_TUI_MOUSE !== "0",
    ...(process.env.AFD_TUI_ASCII === "1" ? { capabilities: { unicode: false, braille: false } } : {}),
  });

  const invalidate = () => app.invalidate();
  const execute = async (): Promise<void> => {
    let args: string[];
    try {
      args = parseCommandField(state.commandText);
      if (hasUnresolvedInput(args)) throw new Error("Replace every <placeholder> in the command field before running.");
    } catch (error: unknown) {
      state.notice = error instanceof Error ? error.message : String(error);
      state.confirm = false;
      invalidate();
      return;
    }
    state.confirm = false;
    state.running = true;
    state.screen = "output";
    state.notice = undefined;
    invalidate();
    state.execution = await executeAfdUseCase(args);
    state.running = false;
    invalidate();
  };
  const requestRun = (): void => {
    try {
      const args = parseCommandField(state.commandText);
      if (hasUnresolvedInput(args)) throw new Error("Replace every <placeholder> in the command field before running.");
      if (commandMayWrite(args)) { state.confirm = true; invalidate(); return; }
      void execute();
    } catch (error: unknown) {
      state.notice = error instanceof Error ? error.message : String(error);
      invalidate();
    }
  };
  const actions: TuiActions = {
    selectCategory: (index) => { selectCategory(state, index); invalidate(); },
    selectCapability: (index) => { selectCapability(state, index); invalidate(); },
    run: requestRun,
    edit: () => { state.editing = !state.editing; state.commandCursor = state.commandText.length; invalidate(); },
    back: () => { state.screen = "browser"; invalidate(); },
    confirm: () => { void execute(); },
  };

  app.render((args) => drawAfdTui(args, state, actions));

  const editKey = (event: KeyEvent): boolean => {
    if (!state.editing) return false;
    if (event.name === "escape") { state.editing = false; state.commandText = selectedCapability(state).command; state.commandCursor = state.commandText.length; }
    else if (event.name === "enter") state.editing = false;
    else if (event.name === "left") state.commandCursor = Math.max(0, state.commandCursor - 1);
    else if (event.name === "right") state.commandCursor = Math.min(state.commandText.length, state.commandCursor + 1);
    else if (event.name === "home") state.commandCursor = 0;
    else if (event.name === "end") state.commandCursor = state.commandText.length;
    else if (event.name === "backspace" && state.commandCursor > 0) { state.commandText = state.commandText.slice(0, state.commandCursor - 1) + state.commandText.slice(state.commandCursor); state.commandCursor -= 1; }
    else if (event.name === "delete") state.commandText = state.commandText.slice(0, state.commandCursor) + state.commandText.slice(state.commandCursor + 1);
    else if (event.char && !event.ctrl && !event.alt) { const next = insert(state.commandText, state.commandCursor, event.char); state.commandText = next.value; state.commandCursor = next.cursor; }
    invalidate();
    return true;
  };
  const paletteKey = (event: KeyEvent): boolean => {
    if (!state.palette) return false;
    const matches = paletteMatches(state);
    if (event.name === "escape") { state.palette = false; state.paletteQuery = ""; state.paletteIndex = 0; }
    else if (event.name === "enter") selectFromPalette(state);
    else if (event.name === "up") state.paletteIndex = Math.max(0, state.paletteIndex - 1);
    else if (event.name === "down") state.paletteIndex = Math.min(Math.max(0, matches.length - 1), state.paletteIndex + 1);
    else if (event.name === "backspace") { state.paletteQuery = state.paletteQuery.slice(0, -1); state.paletteIndex = 0; }
    else if (event.char && !event.ctrl && !event.alt) { state.paletteQuery += event.char; state.paletteIndex = 0; }
    invalidate();
    return true;
  };

  app.on("paste", (event) => {
    if (state.editing) { const next = insert(state.commandText, state.commandCursor, event.text.replace(/[\r\n]+/g, " ")); state.commandText = next.value; state.commandCursor = next.cursor; invalidate(); }
    else if (state.palette) { state.paletteQuery += event.text.replace(/[\r\n]+/g, " "); state.paletteIndex = 0; invalidate(); }
  });
  app.on("key", (event) => {
    if (editKey(event) || paletteKey(event)) return;
    if (state.help) { if (["escape", "?", "enter"].includes(event.name)) { state.help = false; invalidate(); } return; }
    if (state.confirm) {
      if (event.name === "escape") { state.confirm = false; invalidate(); }
      else if (event.name === "enter") void execute();
      return;
    }
    if (state.running) { state.notice = "The current operation cannot be safely detached. Wait for its typed result or use Ctrl+C to terminate the process."; invalidate(); return; }
    if (event.key === "ctrl+c" || event.name === "q") { app.quit(); return; }
    if (event.name === "?") { state.help = true; invalidate(); return; }
    if (event.name === "/") { state.palette = true; state.paletteQuery = ""; state.paletteIndex = 0; invalidate(); return; }
    if (event.name === "escape" && state.screen === "output") { state.screen = "browser"; invalidate(); return; }
    if (event.name === "left") selectCategory(state, state.categoryIndex - 1);
    else if (event.name === "right") selectCategory(state, state.categoryIndex + 1);
    else if (event.name === "up") selectCapability(state, state.capabilityIndex - 1);
    else if (event.name === "down") selectCapability(state, state.capabilityIndex + 1);
    else if (event.name === "e") { state.editing = true; state.commandCursor = state.commandText.length; }
    else if (event.name === "enter" || event.name === "r") requestRun();
    invalidate();
  });

  await app.start();
  return 0;
}
