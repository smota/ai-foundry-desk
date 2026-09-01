import type { CommandExecution } from "../application-service.js";
import { capabilitiesFor, capabilityRegistry, tuiCategories, type CapabilityDefinition } from "../capability-registry.js";

export type TuiScreen = "browser" | "output";
export interface TuiState {
  contextLabel: string;
  screen: TuiScreen;
  categoryIndex: number;
  capabilityIndex: number;
  commandText: string;
  commandCursor: number;
  editing: boolean;
  palette: boolean;
  paletteQuery: string;
  paletteIndex: number;
  confirm: boolean;
  help: boolean;
  running: boolean;
  notice: string | undefined;
  execution?: CommandExecution;
}

export function createTuiState(): TuiState {
  const first = capabilitiesFor(tuiCategories[0])[0]!;
  return {
    contextLabel: process.cwd(),
    screen: "browser", categoryIndex: 0, capabilityIndex: 0,
    commandText: first.command, commandCursor: first.command.length,
    editing: false, palette: false, paletteQuery: "", paletteIndex: 0,
    confirm: false, help: false, running: false, notice: undefined,
  };
}

export function selectedCategory(state: TuiState) { return tuiCategories[state.categoryIndex]!; }
export function visibleCapabilities(state: TuiState) { return capabilitiesFor(selectedCategory(state)); }
export function selectedCapability(state: TuiState): CapabilityDefinition { return visibleCapabilities(state)[state.capabilityIndex] ?? visibleCapabilities(state)[0]!; }

export function selectCategory(state: TuiState, index: number): void {
  state.categoryIndex = (index + tuiCategories.length) % tuiCategories.length;
  state.capabilityIndex = 0;
  selectCapability(state, 0);
}

export function selectCapability(state: TuiState, index: number): void {
  const entries = visibleCapabilities(state);
  state.capabilityIndex = Math.max(0, Math.min(index, entries.length - 1));
  const item = selectedCapability(state);
  state.commandText = item.command;
  state.commandCursor = item.command.length;
  state.notice = undefined;
}

export function paletteMatches(state: TuiState): readonly CapabilityDefinition[] {
  const query = state.paletteQuery.trim().toLowerCase();
  if (!query) return capabilityRegistry;
  return capabilityRegistry.filter((item) => `${item.title} ${item.command} ${item.description} ${item.category}`.toLowerCase().includes(query));
}

export function selectFromPalette(state: TuiState): void {
  const item = paletteMatches(state)[state.paletteIndex];
  if (!item) return;
  selectCategory(state, tuiCategories.indexOf(item.category));
  const index = visibleCapabilities(state).findIndex((entry) => entry.id === item.id);
  selectCapability(state, index);
  state.palette = false;
  state.paletteQuery = "";
  state.paletteIndex = 0;
}
