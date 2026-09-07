export const PANEL_STYLES = `
:host {
  all: initial;
  font-family: "Segoe UI", "Helvetica Neue", sans-serif;
  font-size: 13px;
  color: #1a1a1a;
  line-height: 1.4;
}

* {
  box-sizing: border-box;
}

.lb-root {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}

.lb-root > * {
  pointer-events: auto;
}

.lb-toggle {
  border: 1px solid #5f6368;
  background: #f8f9fa;
  color: #202124;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.lb-toggle:hover {
  background: #eef0f2;
}

.lb-panel {
  width: 320px;
  max-height: min(70vh, 520px);
  overflow: auto;
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 6px;
  padding: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
}

.lb-panel[hidden] {
  display: none;
}

.lb-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.lb-sub {
  margin: 0 0 12px;
  color: #5f6368;
  font-size: 12px;
}

.lb-section-title {
  margin: 12px 0 6px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #5f6368;
}

.lb-module {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
  border-top: 1px solid #eee;
}

.lb-module-name {
  font-weight: 500;
}

.lb-module-meta {
  color: #5f6368;
  font-size: 12px;
}

.lb-btn {
  align-self: flex-start;
  margin-top: 4px;
  border: 1px solid #5f6368;
  background: #fff;
  color: #202124;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
}

.lb-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.lb-btn-cancel {
  border-color: #c5221f;
  color: #c5221f;
}

.lb-status {
  margin-top: 8px;
  padding: 8px;
  background: #f8f9fa;
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
}

.lb-error {
  color: #c5221f;
  margin-top: 6px;
  font-size: 12px;
}

.lb-collections-list {
  display: flex;
  flex-direction: column;
}

.lb-collections-empty {
  color: #5f6368;
  font-size: 12px;
  padding: 8px 0;
}

.lb-collection {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
  border-top: 1px solid #eee;
}

.lb-collection-meta {
  color: #202124;
  font-size: 12px;
  word-break: break-word;
}

.lb-collection-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.lb-btn-small {
  padding: 2px 8px;
  font-size: 12px;
  margin-top: 0;
}
`;
