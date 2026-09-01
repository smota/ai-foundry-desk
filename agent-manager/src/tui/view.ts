import type { Container, RenderArgs, Theme } from "@profullstack/hqtui";
import { VERSION } from "../command-service.js";
import { capabilitiesFor, safetyLabel, tuiCategories, type CapabilityDefinition, type SafetyClass } from "../capability-registry.js";
import { paletteMatches, selectedCapability, selectedCategory, visibleCapabilities, type TuiState } from "./state.js";

export interface TuiActions {
  selectCategory(index: number): void;
  selectCapability(index: number): void;
  run(): void;
  edit(): void;
  back(): void;
  confirm(): void;
}
const noActions: TuiActions = { selectCategory() {}, selectCapability() {}, run() {}, edit() {}, back() {}, confirm() {} };
type DrawArgs = Pick<RenderArgs, "ui" | "theme" | "width" | "height">;

function safetyColor(theme: Theme, safety: SafetyClass) {
  if (safety === "read-only") return theme.success;
  if (safety === "destructive-recoverable") return theme.danger;
  return theme.warning;
}

function drawHeader(ui: Container, state: TuiState, width: number): void {
  ui.row({ height: 3, gap: 1 }, (row) => {
    row.panel({ title: `AI Foundry Desk ${VERSION}`, width: "1fr" }, (panel) => panel.text(`Multi-Agent Workbench  |  ${process.platform}  |  ${state.contextLabel}`, { wrap: false }));
    if (width >= 90) row.panel({ title: "Context", width: 28 }, (panel) => panel.text(state.running ? "RUNNING" : state.screen === "output" ? "RESULT" : "READY", { align: "center", bold: true }));
  });
}

function drawCategories(ui: Container, state: TuiState, actions: TuiActions): void {
  ui.panel({ title: "Capabilities", width: 22, focusable: true }, (panel) => {
    panel.list({ items: tuiCategories.map((category) => ({ label: category, badge: String(visibleCount(category)) })), selected: state.categoryIndex, followSelection: true, scrollbar: false, onSelectRow: actions.selectCategory });
  });
}

function visibleCount(category: typeof tuiCategories[number]): number {
  return capabilityRegistryByCategory.get(category) ?? 0;
}
const capabilityRegistryByCategory = new Map(tuiCategories.map((category) => [category, 0]));
for (const category of tuiCategories) capabilityRegistryByCategory.set(category, capabilitiesFor(category).length);

function drawCapabilityTable(ui: Container, state: TuiState, actions: TuiActions, width: number): void {
  const rows = [...visibleCapabilities(state)];
  ui.panel({ title: selectedCategory(state), width: width >= 120 ? 46 : "1fr", focusable: true }, (panel) => {
    panel.table({
      rows,
      columns: [
        { key: "title", title: "Action", min: 20 },
        ...(width >= 105 ? [{ key: "stage", title: "Stage", width: 9 } as const] : []),
      ],
      selected: state.capabilityIndex, followSelection: true, scrollbar: true,
      onSelectRow: actions.selectCapability,
    });
  });
}

function workflow(item: CapabilityDefinition): string {
  const steps = ["Inspect", "Select", "Plan", "Review", "Confirm", "Execute", "Verify/Receipt"];
  const active = item.stage === "inspect" ? 0 : item.stage === "plan" ? 2 : item.stage === "apply" || item.stage === "operate" ? 5 : item.stage === "rollback" ? 5 : 6;
  return steps.map((step, index) => index === active ? `[${step}]` : step).join(" > ");
}

function drawDetail(ui: Container, state: TuiState, actions: TuiActions): void {
  const item = selectedCapability(state);
  ui.panel({ title: "Review", width: "1fr", focusable: true }, (panel) => {
    panel.heading(item.title);
    panel.badge({ text: safetyLabel(item.safety), color: safetyColor(panel.theme, item.safety), variant: "outline" });
    panel.divider({ label: "Purpose" });
    panel.text(item.description, { wrap: true });
    panel.divider({ label: "Workflow" });
    panel.text(workflow(item), { wrap: true });
    if (item.inputs) panel.keyValues([{ label: "Inputs", value: item.inputs }], { labelWidth: 8 });
    panel.divider({ label: "Equivalent CLI" });
    panel.textInput({ label: state.editing ? "Editing" : "Command", value: `afd ${state.commandText}`, cursor: state.commandCursor + 4, focused: state.editing, color: state.editing ? panel.theme.primary : panel.theme.muted });
    panel.spacer(1);
    panel.buttons([
      { label: state.editing ? "Finish edit" : "Edit inputs", variant: "ghost", onPress: actions.edit },
      { label: item.safety === "read-only" ? "Run" : "Review action", variant: item.safety === "read-only" ? "primary" : "warning", onPress: actions.run },
    ]);
    if (state.notice) panel.text(state.notice, { fg: panel.theme.warning, wrap: true });
  });
}

function drawBrowser(ui: Container, state: TuiState, actions: TuiActions, width: number): void {
  if (width >= 100) {
    ui.row({ height: "1fr", gap: 1 }, (row) => { drawCategories(row, state, actions); drawCapabilityTable(row, state, actions, width); drawDetail(row, state, actions); });
    return;
  }
  ui.tabs({ tabs: [...tuiCategories], active: state.categoryIndex, variant: "underline", onSelect: actions.selectCategory, height: 2 });
  if (width >= 80) ui.row({ height: "1fr", gap: 1 }, (row) => { drawCapabilityTable(row, state, actions, width); drawDetail(row, state, actions); });
  else ui.column({ height: "1fr", gap: 1 }, (column) => { drawCapabilityTable(column, state, actions, width); drawDetail(column, state, actions); });
}

function drawOutput(ui: Container, state: TuiState, actions: TuiActions): void {
  const execution = state.execution;
  ui.panel({ title: state.running ? "Executing" : "Result", height: "1fr" }, (panel) => {
    if (state.running) {
      panel.heading(`afd ${state.commandText}`);
      panel.progress({ value: 0.5, label: "Operation in progress" });
      panel.text("The typed application service is running. Terminal state remains owned by HQTUI.", { wrap: true });
      return;
    }
    if (!execution) { panel.text("No operation has run in this session."); return; }
    const color = execution.outcome === "passed" ? panel.theme.success : execution.outcome === "action-needed" ? panel.theme.warning : panel.theme.danger;
    panel.row({ height: 2 }, (row) => {
      row.badge({ text: execution.outcome.toUpperCase(), color, variant: "outline", width: 22 });
      row.keyValues([{ label: "Exit", value: String(execution.exitCode) }, { label: "Ended", value: execution.endedAt.slice(11, 19) }], { labelWidth: 6, width: "1fr" });
    });
    panel.divider({ label: `afd ${execution.args.join(" ")}` });
    const entries = execution.events.flatMap((event) => event.text.split(/\r?\n/).filter(Boolean).map((message) => ({ level: event.stream === "stderr" ? "ERROR" : "INFO", message: message.replace(/\t/g, "  "), color: event.stream === "stderr" ? panel.theme.danger : panel.theme.foreground })));
    panel.log({ entries: entries.length ? entries : [{ level: "INFO", message: "Command completed without textual output." }], follow: true, scrollbar: true, wrap: true, height: "1fr" });
    panel.buttons([{ label: "Back to capabilities", variant: "primary", onPress: actions.back }]);
  });
}

function drawOverlays(ui: Container, state: TuiState): void {
  if (state.palette) {
    const matches = paletteMatches(state);
    ui.commandPalette({ query: state.paletteQuery, selected: Math.min(state.paletteIndex, Math.max(0, matches.length - 1)), items: matches.slice(0, 12).map((item) => ({ label: item.title, hint: `afd ${item.command}` })), width: 76, height: 17, placeholder: "Search intent or exact command" });
  }
  if (state.confirm) {
    const item = selectedCapability(state);
    ui.modal({
      title: "Confirm reviewed action",
      message: `${safetyLabel(item.safety)}\n\nafd ${state.commandText}\n\nThe command will be revalidated by the shared AFD service. Drift or missing evidence will block it.\n\nPress Enter again to execute; Esc cancels.`,
      width: 72, height: 13, buttons: [{ label: "Esc: Cancel" }, { label: "Enter: Execute", variant: "warning", focused: true }],
    });
  }
  if (state.help) {
    ui.modal({ title: "Keyboard and accessibility", width: 72, height: 16, message: "Left/Right  Change category\nUp/Down     Select capability\n/           Search all capabilities\ne           Edit command inputs\nEnter       Run read-only / review write / confirm in modal\nEsc         Close or return\nr           Run selected action\n?           This help\nq           Quit\n\nEvery mouse action has keyboard parity. Status never depends on color alone. The line-oriented CLI remains available for screen-reader and non-TTY use." });
  }
}

export function drawAfdTui(args: DrawArgs, state: TuiState, actions: TuiActions = noActions): void {
  const { ui, width } = args;
  drawHeader(ui, state, width);
  if (state.screen === "output") drawOutput(ui, state, actions); else drawBrowser(ui, state, actions, width);
  const statusItems = state.running ? [{ label: "Operation running - input locked" }]
    : state.screen === "output" ? [{ key: "Esc", label: "Back" }]
    : state.editing ? [{ key: "Enter", label: "Finish" }, { key: "Esc", label: "Cancel edit" }]
    : [{ key: "/", label: "Search" }, { key: "e", label: "Edit" }, { key: "Enter", label: "Run/Review" }, { key: "?", label: "Help" }];
  ui.statusBar({
    items: statusItems,
    right: state.running ? [] : state.screen === "output" ? [{ label: state.execution?.outcome ?? "result" }, { key: "q", label: "Quit" }] : [{ label: `${visibleCapabilities(state).length} actions` }, { key: "q", label: "Quit" }], keyStyle: "caps", height: 1,
  });
  drawOverlays(ui, state);
}
