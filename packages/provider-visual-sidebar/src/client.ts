import type { ReactGrabAPI } from "react-grab/core";
import { formatElementInfo, copyContent } from "react-grab/core";

// Track changes for a single element
interface ElementChanges {
  element: HTMLElement;
  selector: string;
  originalStyles: Record<string, string>;
  currentStyles: Record<string, string>;
  originalText: string;
  currentText: string;
  elementInfo?: string; // Cached element context
}

// Session stores all changes across multiple elements
interface Session {
  changes: Map<HTMLElement, ElementChanges>;
}

const session: Session = {
  changes: new Map(),
};

// Sidebar state for current element
interface SidebarState {
  isOpen: boolean;
  element: HTMLElement | null;
  originalStyles: Record<string, string>;
  currentStyles: Record<string, string>;
  originalText: string;
  currentText: string;
  wasContentEditable: boolean;
  undoStack: Array<() => void>;
  collapsedSections: Set<string>;
}

const state: SidebarState = {
  isOpen: false,
  element: null,
  originalStyles: {},
  currentStyles: {},
  originalText: "",
  currentText: "",
  wasContentEditable: false,
  undoStack: [],
  collapsedSections: new Set(),
};

// Generate a CSS selector for an element
function getElementSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`;
  let selector = el.tagName.toLowerCase();
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
    if (classes) selector += `.${classes}`;
  }
  return selector;
}

// Save current element changes to session
function saveCurrentToSession() {
  if (!state.element) return;

  const hasStyleChanges = TRACKED_PROPERTIES.some(
    prop => state.originalStyles[prop] !== state.currentStyles[prop]
  );
  const hasTextChanges = state.originalText !== state.currentText;

  if (hasStyleChanges || hasTextChanges) {
    session.changes.set(state.element, {
      element: state.element,
      selector: getElementSelector(state.element),
      originalStyles: { ...state.originalStyles },
      currentStyles: { ...state.currentStyles },
      originalText: state.originalText,
      currentText: state.currentText,
    });
    updateSessionBadge();
  }
}

// Update badge showing number of edited elements
function updateSessionBadge() {
  const badge = document.getElementById("rg-session-badge");
  const count = session.changes.size;
  if (badge) {
    badge.textContent = String(count);
    badge.style.display = count > 0 ? "flex" : "none";
  }
}

// Clear all session changes
function clearSession() {
  session.changes.clear();
  updateSessionBadge();
  showToast("Session cleared");
}

// CSS properties we track
const TRACKED_PROPERTIES = [
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "backgroundColor", "color", "fontSize",
  "display", "width", "height",
];

// Tailwind spacing map
const TAILWIND_SPACING: Record<number, string> = {
  0: "0", 4: "1", 8: "2", 12: "3", 16: "4", 20: "5", 24: "6", 32: "8", 40: "10", 48: "12", 64: "16", 80: "20", 96: "24",
};

function detectTailwind(): boolean {
  const scripts = document.querySelectorAll('script[src*="tailwindcss"]');
  if (scripts.length > 0) return true;
  const classes = document.body.className;
  return /\b(flex|grid|p-|m-|bg-|text-)\b/.test(classes);
}

function parsePx(value: string): number {
  return parseInt(value.replace("px", ""), 10) || 0;
}

function captureStyles(element: HTMLElement): Record<string, string> {
  const computed = window.getComputedStyle(element);
  const styles: Record<string, string> = {};
  for (const prop of TRACKED_PROPERTIES) {
    styles[prop] = computed.getPropertyValue(prop.replace(/([A-Z])/g, "-$1").toLowerCase());
  }
  return styles;
}

function applyStyle(prop: string, value: string) {
  if (!state.element) return;
  const element = state.element;
  const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
  const original = element.style.getPropertyValue(cssProp);
  element.style.setProperty(cssProp, value);
  state.currentStyles[prop] = value;
  state.undoStack.push(() => {
    element.style.setProperty(cssProp, original);
    state.currentStyles[prop] = original || state.originalStyles[prop];
    updateSidebarInputs();
  });
}

function undo() {
  const undoFn = state.undoStack.pop();
  if (undoFn) undoFn();
}

// Text editing functions
function enableTextEditing(element: HTMLElement) {
  state.wasContentEditable = element.isContentEditable;
  state.originalText = element.innerText;
  state.currentText = element.innerText;

  // Make element editable
  element.setAttribute("contenteditable", "true");

  // Add visual indicator that element is editable
  element.style.outline = "2px dashed #3b82f6";
  element.style.outlineOffset = "2px";
  element.style.cursor = "text";

  // Ensure the element can be selected/edited
  (element.style as any).webkitUserSelect = "text";
  (element.style as any).userSelect = "text";

  // Track text changes
  element.addEventListener("input", onTextInput);
  element.addEventListener("blur", onTextBlur);

  // Deactivate React Grab while editing so clicks go to the element
  if (window.__REACT_GRAB__?.isActive?.()) {
    window.__REACT_GRAB__?.deactivate();
  }

  console.log("[visual-sidebar] Text editing enabled for:", element.tagName, "- click to edit text");
}

function disableTextEditing(element: HTMLElement) {
  if (!state.wasContentEditable) {
    element.removeAttribute("contenteditable");
  }

  // Remove visual indicator and editing styles
  element.style.outline = "";
  element.style.outlineOffset = "";
  element.style.cursor = "";
  (element.style as any).webkitUserSelect = "";
  (element.style as any).userSelect = "";

  // Remove listeners
  element.removeEventListener("input", onTextInput);
  element.removeEventListener("blur", onTextBlur);
}

function onTextInput(e: Event) {
  const target = e.target as HTMLElement;
  const previousText = state.currentText;
  state.currentText = target.innerText;

  // Add to undo stack
  state.undoStack.push(() => {
    if (state.element) {
      state.element.innerText = previousText;
      state.currentText = previousText;
    }
  });
}

function onTextBlur() {
  // Update current text on blur in case of paste or other changes
  if (state.element) {
    state.currentText = state.element.innerText;
  }
}

function generateChangeSummary(): string {
  const changes: string[] = [];

  // Style changes
  for (const prop of TRACKED_PROPERTIES) {
    const original = state.originalStyles[prop];
    const current = state.currentStyles[prop];
    if (original !== current) {
      const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
      changes.push(`- ${cssProp}: ${original} -> ${current}`);
    }
  }

  // Text changes
  if (state.originalText !== state.currentText) {
    changes.push(`\nText content changed:`);
    changes.push(`- Before: "${state.originalText.substring(0, 100)}${state.originalText.length > 100 ? '...' : ''}"`);
    changes.push(`- After: "${state.currentText.substring(0, 100)}${state.currentText.length > 100 ? '...' : ''}"`);
  }

  return changes.join("\n");
}

function generateTailwindClasses(): string {
  const classes: string[] = [];
  if (!detectTailwind()) return "";
  const propToTailwind: Record<string, string> = {
    paddingTop: "pt", paddingRight: "pr", paddingBottom: "pb", paddingLeft: "pl",
    marginTop: "mt", marginRight: "mr", marginBottom: "mb", marginLeft: "ml",
  };
  for (const [prop, prefix] of Object.entries(propToTailwind)) {
    const original = state.originalStyles[prop];
    const current = state.currentStyles[prop];
    if (original !== current) {
      const px = parsePx(current);
      const twValue = TAILWIND_SPACING[px];
      if (twValue !== undefined) classes.push(`${prefix}-${twValue}`);
    }
  }
  return classes.join(" ");
}

// Generate changes for a single element (from session)
function generateElementChanges(changes: ElementChanges): string {
  const lines: string[] = [];

  // Style changes
  for (const prop of TRACKED_PROPERTIES) {
    const original = changes.originalStyles[prop];
    const current = changes.currentStyles[prop];
    if (original !== current) {
      const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
      lines.push(`  - ${cssProp}: ${original} -> ${current}`);
    }
  }

  // Text changes
  if (changes.originalText !== changes.currentText) {
    lines.push(`  - text: "${changes.originalText.substring(0, 50)}${changes.originalText.length > 50 ? '...' : ''}" -> "${changes.currentText.substring(0, 50)}${changes.currentText.length > 50 ? '...' : ''}"`);
  }

  return lines.join("\n");
}

async function copyChanges() {
  // Save current element to session first
  saveCurrentToSession();

  // Check if we have any changes in session
  if (session.changes.size === 0) {
    showToast("No changes to copy!");
    return;
  }

  const useTailwind = detectTailwind();
  const sections: string[] = [];

  // Build prompt for all changed elements
  sections.push(`Update the following ${session.changes.size} element(s):\n`);

  let elementIndex = 1;
  for (const [element, changes] of session.changes) {
    const elementChanges = generateElementChanges(changes);
    let elementInfo = changes.elementInfo;

    // Get element info if not cached
    if (!elementInfo) {
      try {
        elementInfo = await formatElementInfo(element);
        changes.elementInfo = elementInfo;
      } catch {
        elementInfo = `<${changes.selector}>`;
      }
    }

    sections.push(`--- Element ${elementIndex}: ${changes.selector} ---`);
    sections.push(`Changes:`);
    sections.push(elementChanges);

    // Generate tailwind suggestions for this element
    if (useTailwind) {
      const twClasses: string[] = [];
      const propToTailwind: Record<string, string> = {
        paddingTop: "pt", paddingRight: "pr", paddingBottom: "pb", paddingLeft: "pl",
        marginTop: "mt", marginRight: "mr", marginBottom: "mb", marginLeft: "ml",
      };
      for (const [prop, prefix] of Object.entries(propToTailwind)) {
        if (changes.originalStyles[prop] !== changes.currentStyles[prop]) {
          const px = parsePx(changes.currentStyles[prop]);
          const twValue = TAILWIND_SPACING[px];
          if (twValue !== undefined) twClasses.push(`${prefix}-${twValue}`);
        }
      }
      if (twClasses.length > 0) {
        sections.push(`Suggested Tailwind: ${twClasses.join(" ")}`);
      }
    }

    sections.push(`\nElement context:\n${elementInfo}\n`);
    elementIndex++;
  }

  const prompt = sections.join("\n");

  try {
    await navigator.clipboard.writeText(prompt);
    showToast(`Copied ${session.changes.size} change(s)! Paste in Claude Code`);
    // Don't clear session - let user do it manually
  } catch {
    copyContent(prompt);
    showToast(`Copied ${session.changes.size} change(s)!`);
  }
}

function showToast(message: string) {
  const existing = document.getElementById("rg-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "rg-toast";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #1a1a1a; color: #fff; padding: 12px 20px; border-radius: 8px;
    font: 500 13px/1 -apple-system, BlinkMacSystemFont, sans-serif;
    z-index: 2147483647; border: 1px solid #333;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  `;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity 0.2s"; setTimeout(() => toast.remove(), 200); }, 2000);
}

// Draggable value handler
let dragState: { prop: string; startX: number; startY: number; startValue: number } | null = null;

function startDrag(e: MouseEvent, prop: string) {
  const value = parsePx(state.currentStyles[prop] || "0");
  dragState = { prop, startX: e.clientX, startY: e.clientY, startValue: value };
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", stopDrag);
  document.body.style.cursor = "ew-resize";
  document.body.style.userSelect = "none";
}

function onDrag(e: MouseEvent) {
  if (!dragState) return;
  const delta = e.clientX - dragState.startX;
  const newValue = Math.max(0, dragState.startValue + Math.round(delta / 2));
  applyStyle(dragState.prop, `${newValue}px`);
  updateSidebarInputs();
}

function stopDrag() {
  dragState = null;
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

let sidebarElement: HTMLElement | null = null;

function createSidebar() {
  if (sidebarElement) return sidebarElement;

  const sidebar = document.createElement("div");
  sidebar.id = "rg-sidebar";
  sidebar.innerHTML = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

      #rg-sidebar {
        position: fixed;
        top: 0;
        right: -320px;
        width: 300px;
        height: 100vh;
        background: #1e1e1e;
        color: #e0e0e0;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        z-index: 2147483646;
        transition: right 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        overflow-y: auto;
        border-left: 1px solid #333;
        box-shadow: -4px 0 24px rgba(0,0,0,0.5);
      }
      #rg-sidebar.open { right: 0; }
      #rg-sidebar * { box-sizing: border-box; }

      .rg-header {
        padding: 12px 16px;
        background: #252525;
        border-bottom: 1px solid #333;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .rg-header-title {
        font-weight: 600;
        font-size: 13px;
        color: #fff;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rg-header-title::before {
        content: "";
        width: 8px;
        height: 8px;
        background: #10b981;
        border-radius: 50%;
      }
      .rg-close {
        background: none;
        border: none;
        color: #888;
        cursor: pointer;
        padding: 4px;
        display: flex;
        border-radius: 4px;
        transition: all 0.15s;
      }
      .rg-close:hover { background: #333; color: #fff; }

      .rg-section {
        border-bottom: 1px solid #2a2a2a;
      }
      .rg-section-header {
        padding: 10px 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        user-select: none;
        transition: background 0.15s;
      }
      .rg-section-header:hover { background: #252525; }
      .rg-section-title {
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #888;
      }
      .rg-section-arrow {
        color: #666;
        transition: transform 0.2s;
      }
      .rg-section.collapsed .rg-section-arrow { transform: rotate(-90deg); }
      .rg-section.collapsed .rg-section-content { display: none; }
      .rg-section-content { padding: 12px 16px 16px; }

      /* Spacing Box Model */
      .rg-spacing-box {
        position: relative;
        background: #252525;
        border-radius: 6px;
        padding: 8px;
      }
      .rg-margin-box {
        background: rgba(251, 146, 60, 0.15);
        border: 1px dashed rgba(251, 146, 60, 0.4);
        border-radius: 4px;
        padding: 20px;
        position: relative;
      }
      .rg-padding-box {
        background: rgba(74, 222, 128, 0.15);
        border: 1px dashed rgba(74, 222, 128, 0.4);
        border-radius: 4px;
        padding: 20px;
        position: relative;
      }
      .rg-content-box {
        background: #3b82f6;
        border-radius: 2px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        color: rgba(255,255,255,0.7);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .rg-spacing-label {
        position: absolute;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #666;
      }
      .rg-margin-label { top: 4px; left: 8px; color: #fb923c; }
      .rg-padding-label { top: 4px; left: 8px; color: #4ade80; }

      .rg-spacing-input {
        position: absolute;
        width: 28px;
        background: transparent;
        border: none;
        color: #aaa;
        font-size: 11px;
        font-family: 'SF Mono', Monaco, monospace;
        text-align: center;
        cursor: ew-resize;
        padding: 2px;
        border-radius: 3px;
        transition: all 0.15s;
      }
      .rg-spacing-input:hover { background: rgba(255,255,255,0.1); color: #fff; }
      .rg-spacing-input:focus {
        outline: none;
        background: rgba(255,255,255,0.15);
        color: #fff;
        cursor: text;
      }

      /* Margin inputs */
      .rg-m-top { top: 24px; left: 50%; transform: translateX(-50%); }
      .rg-m-right { right: 4px; top: 50%; transform: translateY(-50%); }
      .rg-m-bottom { bottom: 4px; left: 50%; transform: translateX(-50%); }
      .rg-m-left { left: 4px; top: 50%; transform: translateY(-50%); }

      /* Padding inputs */
      .rg-p-top { top: 20px; left: 50%; transform: translateX(-50%); }
      .rg-p-right { right: 4px; top: 50%; transform: translateY(-50%); }
      .rg-p-bottom { bottom: 4px; left: 50%; transform: translateX(-50%); }
      .rg-p-left { left: 4px; top: 50%; transform: translateY(-50%); }

      /* Display toggles */
      .rg-display-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }
      .rg-display-label {
        color: #888;
        font-size: 11px;
        width: 50px;
      }
      .rg-display-toggles {
        display: flex;
        background: #252525;
        border-radius: 6px;
        padding: 2px;
        flex: 1;
      }
      .rg-display-btn {
        flex: 1;
        padding: 6px 8px;
        background: none;
        border: none;
        color: #888;
        font-size: 11px;
        font-family: inherit;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.15s;
      }
      .rg-display-btn:hover { color: #fff; }
      .rg-display-btn.active { background: #3b82f6; color: #fff; }

      /* Input rows */
      .rg-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .rg-label {
        color: #888;
        font-size: 11px;
        width: 50px;
        flex-shrink: 0;
      }
      .rg-draggable-label {
        cursor: ew-resize;
        user-select: none;
        transition: color 0.15s;
      }
      .rg-draggable-label:hover {
        color: #3b82f6;
      }
      .rg-draggable {
        cursor: ew-resize;
      }
      .rg-draggable:focus {
        cursor: text;
      }
      .rg-input {
        flex: 1;
        background: #252525;
        border: 1px solid #333;
        border-radius: 4px;
        padding: 6px 8px;
        color: #fff;
        font-size: 11px;
        font-family: inherit;
        transition: all 0.15s;
      }
      .rg-input:hover { border-color: #444; }
      .rg-input:focus { outline: none; border-color: #3b82f6; }

      .rg-color-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rg-color-input {
        width: 32px;
        height: 32px;
        padding: 0;
        border: 2px solid #333;
        border-radius: 6px;
        cursor: pointer;
        overflow: hidden;
      }
      .rg-color-input::-webkit-color-swatch-wrapper { padding: 0; }
      .rg-color-input::-webkit-color-swatch { border: none; border-radius: 4px; }
      .rg-color-text {
        flex: 1;
        background: #252525;
        border: 1px solid #333;
        border-radius: 4px;
        padding: 6px 8px;
        color: #fff;
        font-size: 11px;
        font-family: 'SF Mono', Monaco, monospace;
      }
      .rg-color-text:focus { outline: none; border-color: #3b82f6; }

      /* Actions */
      .rg-actions {
        padding: 16px;
        display: flex;
        gap: 8px;
        border-top: 1px solid #333;
        background: #1e1e1e;
        position: sticky;
        bottom: 0;
      }
      .rg-btn {
        flex: 1;
        padding: 10px 16px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s;
      }
      .rg-btn-primary {
        background: #3b82f6;
        color: #fff;
      }
      .rg-btn-primary:hover { background: #2563eb; }
      .rg-btn-secondary {
        background: #333;
        color: #fff;
      }
      .rg-btn-secondary:hover { background: #404040; }
      .rg-btn-danger {
        background: transparent;
        color: #f87171;
        border: 1px solid rgba(248, 113, 113, 0.3);
      }
      .rg-btn-danger:hover { background: rgba(248, 113, 113, 0.1); }

      /* Session badge */
      .rg-session-badge {
        display: none;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        background: #3b82f6;
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        border-radius: 10px;
        margin-left: 8px;
      }
    </style>

    <div class="rg-header">
      <div class="rg-header-title">
        Style
        <span class="rg-session-badge" id="rg-session-badge">0</span>
      </div>
      <button class="rg-close" id="rg-close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <!-- Layout Section -->
    <div class="rg-section" data-section="layout">
      <div class="rg-section-header">
        <span class="rg-section-title">Layout</span>
        <svg class="rg-section-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="rg-section-content">
        <div class="rg-display-row">
          <span class="rg-display-label">Display</span>
          <div class="rg-display-toggles">
            <button class="rg-display-btn" data-display="block">Block</button>
            <button class="rg-display-btn" data-display="flex">Flex</button>
            <button class="rg-display-btn" data-display="grid">Grid</button>
            <button class="rg-display-btn" data-display="none">None</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Spacing Section -->
    <div class="rg-section" data-section="spacing">
      <div class="rg-section-header">
        <span class="rg-section-title">Spacing</span>
        <svg class="rg-section-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="rg-section-content">
        <div class="rg-spacing-box">
          <div class="rg-margin-box">
            <span class="rg-spacing-label rg-margin-label">margin</span>
            <input class="rg-spacing-input rg-m-top" id="rg-mt" value="0" data-prop="marginTop">
            <input class="rg-spacing-input rg-m-right" id="rg-mr" value="0" data-prop="marginRight">
            <input class="rg-spacing-input rg-m-bottom" id="rg-mb" value="0" data-prop="marginBottom">
            <input class="rg-spacing-input rg-m-left" id="rg-ml" value="0" data-prop="marginLeft">

            <div class="rg-padding-box">
              <span class="rg-spacing-label rg-padding-label">padding</span>
              <input class="rg-spacing-input rg-p-top" id="rg-pt" value="0" data-prop="paddingTop">
              <input class="rg-spacing-input rg-p-right" id="rg-pr" value="0" data-prop="paddingRight">
              <input class="rg-spacing-input rg-p-bottom" id="rg-pb" value="0" data-prop="paddingBottom">
              <input class="rg-spacing-input rg-p-left" id="rg-pl" value="0" data-prop="paddingLeft">

              <div class="rg-content-box">content</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Size Section -->
    <div class="rg-section" data-section="size">
      <div class="rg-section-header">
        <span class="rg-section-title">Size</span>
        <svg class="rg-section-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="rg-section-content">
        <div class="rg-row">
          <span class="rg-label rg-draggable-label" data-prop="width">Width</span>
          <input class="rg-input rg-draggable" id="rg-width" type="text" placeholder="auto" data-prop="width">
        </div>
        <div class="rg-row">
          <span class="rg-label rg-draggable-label" data-prop="height">Height</span>
          <input class="rg-input rg-draggable" id="rg-height" type="text" placeholder="auto" data-prop="height">
        </div>
      </div>
    </div>

    <!-- Typography Section -->
    <div class="rg-section" data-section="typography">
      <div class="rg-section-header">
        <span class="rg-section-title">Typography</span>
        <svg class="rg-section-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="rg-section-content">
        <div class="rg-row">
          <span class="rg-label rg-draggable-label" data-prop="fontSize">Size</span>
          <input class="rg-input rg-draggable" id="rg-font-size" type="text" placeholder="16" data-prop="fontSize">
        </div>
        <div class="rg-row">
          <span class="rg-label">Color</span>
          <div class="rg-color-row" style="flex:1">
            <input type="color" class="rg-color-input" id="rg-text-color">
            <input type="text" class="rg-color-text" id="rg-text-color-text" placeholder="#000000">
          </div>
        </div>
      </div>
    </div>

    <!-- Background Section -->
    <div class="rg-section" data-section="background">
      <div class="rg-section-header">
        <span class="rg-section-title">Background</span>
        <svg class="rg-section-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="rg-section-content">
        <div class="rg-row">
          <span class="rg-label">Color</span>
          <div class="rg-color-row" style="flex:1">
            <input type="color" class="rg-color-input" id="rg-bg-color">
            <input type="text" class="rg-color-text" id="rg-bg-color-text" placeholder="#ffffff">
          </div>
        </div>
      </div>
    </div>

    <div class="rg-actions">
      <button class="rg-btn rg-btn-secondary" id="rg-undo">Undo</button>
      <button class="rg-btn rg-btn-danger" id="rg-clear">Clear All</button>
      <button class="rg-btn rg-btn-primary" id="rg-copy">Copy All</button>
    </div>
  `;

  document.body.appendChild(sidebar);
  sidebarElement = sidebar;

  // Close button
  sidebar.querySelector("#rg-close")?.addEventListener("click", closeSidebar);
  sidebar.querySelector("#rg-copy")?.addEventListener("click", copyChanges);
  sidebar.querySelector("#rg-undo")?.addEventListener("click", undo);
  sidebar.querySelector("#rg-clear")?.addEventListener("click", clearSession);

  // Section collapse
  sidebar.querySelectorAll(".rg-section-header").forEach(header => {
    header.addEventListener("click", () => {
      const section = header.parentElement;
      section?.classList.toggle("collapsed");
    });
  });

  // Display toggles
  sidebar.querySelectorAll(".rg-display-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const display = (btn as HTMLElement).dataset.display;
      if (display) {
        applyStyle("display", display);
        updateDisplayToggles();
      }
    });
  });

  // Spacing inputs with drag support
  sidebar.querySelectorAll(".rg-spacing-input").forEach(input => {
    const el = input as HTMLInputElement;
    const prop = el.dataset.prop;
    if (!prop) return;

    el.addEventListener("mousedown", (e) => {
      if (document.activeElement !== el) {
        e.preventDefault();
        startDrag(e as MouseEvent, prop);
      }
    });

    el.addEventListener("change", () => {
      applyStyle(prop, `${el.value}px`);
    });

    el.addEventListener("focus", () => {
      el.select();
    });
  });

  // Draggable inputs (width, height, font-size) - drag on label OR input
  sidebar.querySelectorAll(".rg-draggable").forEach(input => {
    const el = input as HTMLInputElement;
    const prop = el.dataset.prop;
    if (!prop) return;

    el.addEventListener("mousedown", (e) => {
      if (document.activeElement !== el) {
        e.preventDefault();
        startDrag(e as MouseEvent, prop);
      }
    });

    el.addEventListener("change", () => {
      const val = el.value;
      if (val === "" || val === "auto") {
        applyStyle(prop, "auto");
      } else {
        applyStyle(prop, `${parsePx(val)}px`);
      }
    });

    el.addEventListener("focus", () => el.select());
  });

  // Draggable labels - can drag on the label text too
  sidebar.querySelectorAll(".rg-draggable-label").forEach(label => {
    const el = label as HTMLElement;
    const prop = el.dataset.prop;
    if (!prop) return;

    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startDrag(e as MouseEvent, prop);
    });
  });

  // Colors
  const bgColorPicker = sidebar.querySelector("#rg-bg-color") as HTMLInputElement;
  const bgColorText = sidebar.querySelector("#rg-bg-color-text") as HTMLInputElement;
  const textColorPicker = sidebar.querySelector("#rg-text-color") as HTMLInputElement;
  const textColorText = sidebar.querySelector("#rg-text-color-text") as HTMLInputElement;

  bgColorPicker?.addEventListener("input", () => {
    applyStyle("backgroundColor", bgColorPicker.value);
    bgColorText.value = bgColorPicker.value;
  });
  bgColorText?.addEventListener("change", () => {
    applyStyle("backgroundColor", bgColorText.value);
    bgColorPicker.value = bgColorText.value;
  });
  textColorPicker?.addEventListener("input", () => {
    applyStyle("color", textColorPicker.value);
    textColorText.value = textColorPicker.value;
  });
  textColorText?.addEventListener("change", () => {
    applyStyle("color", textColorText.value);
    textColorPicker.value = textColorText.value;
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.isOpen) closeSidebar();
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && state.isOpen) { e.preventDefault(); undo(); }
  });

  return sidebar;
}

function updateDisplayToggles() {
  if (!sidebarElement) return;
  const current = state.currentStyles.display || "block";
  sidebarElement.querySelectorAll(".rg-display-btn").forEach(btn => {
    const el = btn as HTMLElement;
    el.classList.toggle("active", el.dataset.display === current);
  });
}

function updateSidebarInputs() {
  if (!sidebarElement) return;
  const styles = state.currentStyles;

  // Spacing
  const spacingMap = [
    ["rg-mt", "marginTop"], ["rg-mr", "marginRight"], ["rg-mb", "marginBottom"], ["rg-ml", "marginLeft"],
    ["rg-pt", "paddingTop"], ["rg-pr", "paddingRight"], ["rg-pb", "paddingBottom"], ["rg-pl", "paddingLeft"],
  ];
  for (const [id, prop] of spacingMap) {
    const input = sidebarElement.querySelector(`#${id}`) as HTMLInputElement;
    if (input) input.value = String(parsePx(styles[prop] || "0"));
  }

  // Size - show just the number for dragging
  const widthInput = sidebarElement.querySelector("#rg-width") as HTMLInputElement;
  const heightInput = sidebarElement.querySelector("#rg-height") as HTMLInputElement;
  const widthVal = styles.width || "auto";
  const heightVal = styles.height || "auto";
  if (widthInput) widthInput.value = widthVal === "auto" ? "" : String(parsePx(widthVal));
  if (heightInput) heightInput.value = heightVal === "auto" ? "" : String(parsePx(heightVal));

  // Display
  updateDisplayToggles();

  // Colors
  const rgbToHex = (rgb: string) => {
    const match = rgb.match(/\d+/g);
    if (!match || match.length < 3) return "#ffffff";
    const [r, g, b] = match.map(Number);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  };

  const bgHex = rgbToHex(styles.backgroundColor || "rgb(255,255,255)");
  const textHex = rgbToHex(styles.color || "rgb(0,0,0)");

  const bgColorPicker = sidebarElement.querySelector("#rg-bg-color") as HTMLInputElement;
  const bgColorText = sidebarElement.querySelector("#rg-bg-color-text") as HTMLInputElement;
  const textColorPicker = sidebarElement.querySelector("#rg-text-color") as HTMLInputElement;
  const textColorText = sidebarElement.querySelector("#rg-text-color-text") as HTMLInputElement;

  if (bgColorPicker) bgColorPicker.value = bgHex;
  if (bgColorText) bgColorText.value = bgHex;
  if (textColorPicker) textColorPicker.value = textHex;
  if (textColorText) textColorText.value = textHex;

  // Font size
  const fontSizeInput = sidebarElement.querySelector("#rg-font-size") as HTMLInputElement;
  if (fontSizeInput) fontSizeInput.value = String(parsePx(styles.fontSize || "16px"));
}

function openSidebar(element: HTMLElement) {
  createSidebar();

  // Save current element to session before switching
  if (state.element && state.element !== element) {
    saveCurrentToSession();
    disableTextEditing(state.element);
  }

  state.element = element;
  state.undoStack = [];
  state.isOpen = true;

  // Check if element was previously edited in this session
  const previousChanges = session.changes.get(element);
  if (previousChanges) {
    // Restore previous state
    state.originalStyles = { ...previousChanges.originalStyles };
    state.currentStyles = { ...previousChanges.currentStyles };
    state.originalText = previousChanges.originalText;
    state.currentText = previousChanges.currentText;
  } else {
    // Fresh element
    state.originalStyles = captureStyles(element);
    state.currentStyles = { ...state.originalStyles };
  }

  // Enable inline text editing
  enableTextEditing(element);

  updateSidebarInputs();
  updateSessionBadge();
  sidebarElement?.classList.add("open");
}

function closeSidebar() {
  // Save changes to session before closing
  saveCurrentToSession();

  // Disable text editing before clearing element reference
  if (state.element) {
    disableTextEditing(state.element);
  }

  state.isOpen = false;
  state.element = null;
  state.originalText = "";
  state.currentText = "";
  sidebarElement?.classList.remove("open");
}

// Attach to React Grab
declare global {
  interface Window {
    __REACT_GRAB__?: ReactGrabAPI;
  }
}

export function attachSidebar() {
  if (typeof window === "undefined") return;

  const attach = (api: ReactGrabAPI) => {
    api.updateOptions({
      onCopySuccess: (elements: Element[], _content: string) => {
        if (elements.length > 0 && elements[0] instanceof HTMLElement) {
          openSidebar(elements[0]);
        }
      },
    });
  };

  const api = window.__REACT_GRAB__;
  if (api) { attach(api); return; }

  window.addEventListener("react-grab:init", (event: Event) => {
    attach((event as CustomEvent<ReactGrabAPI>).detail);
  }, { once: true });

  const apiAfterListener = window.__REACT_GRAB__;
  if (apiAfterListener) attach(apiAfterListener);
}

attachSidebar();

export { openSidebar, closeSidebar, state };
