"use strict";

(() => {
  const VERSION = 1;
  const DRAFT_KEY = "form-studio-draft-v2";
  const HISTORY_LIMIT = 60;
  const FIELD_TYPES = ["text", "number", "select", "checkbox", "date", "file"];
  const TYPE_LABELS = { text: "Short answer", number: "Number", select: "Dropdown", checkbox: "Checkbox", date: "Date", file: "File upload" };
  const TYPE_GLYPHS = { text: "T", number: "#", select: "≡", checkbox: "✓", date: "▦", file: "↑" };
  const STARTER = {
    schemaVersion: VERSION,
    settings: {
      title: "Student Workshop Registration",
      description: "Reserve a place at a campus workshop. Choose a session and tell us what you would like to learn.",
    },
    fields: [
      { id: "full-name", type: "text", label: "Your name", helpText: "Enter the name you use at school.", placeholder: "e.g. Alex Morgan", required: true, options: [], validation: {}, condition: null },
      { id: "student-email", type: "text", label: "Student email", helpText: "We will send your registration details here.", placeholder: "you@college.edu", required: true, options: [], validation: { maxLength: 100 }, condition: null },
      { id: "workshop-session", type: "select", label: "Which workshop would you like to attend?", helpText: "Choose one session.", placeholder: "Choose a workshop", required: true, options: ["Web development basics", "Design thinking lab", "Portfolio review"], validation: {}, condition: null },
      { id: "web-goal", type: "text", label: "What would you like to build?", helpText: "Share a topic or small project you are interested in.", placeholder: "e.g. A personal portfolio", required: false, options: [], validation: { maxLength: 240 }, condition: { fieldId: "workshop-session", equals: "Web development basics" } },
      { id: "preferred-date", type: "date", label: "Preferred date", helpText: "Choose a date that works for you.", placeholder: "", required: false, options: [], validation: {}, condition: null },
    ],
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const fieldsNode = $("#fields");
  const editorNode = $("#questionEditor");
  const studentForm = $("#studentForm");

  let schema = copy(STARTER);
  let selectedFieldId = schema.fields[0]?.id ?? null;
  let answers = {};
  let undoStack = [];
  let redoStack = [];
  let editStart = null;
  let toastTimer = 0;

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  function safeNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return `q-${window.crypto.randomUUID()}`;
    return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function normalize(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || !input.settings || !Array.isArray(input.fields)) {
      throw new Error("This file is not a valid form schema.");
    }
    const version = Number(input.schemaVersion ?? 0);
    if (!Number.isInteger(version) || version < 0) throw new Error("The form version must be a whole number.");
    if (version > VERSION) throw new Error("This form was made with a newer version of Form Studio.");
    if (input.fields.length > 50) throw new Error("A form can have up to 50 questions.");

    const usedIds = new Set();
    const fields = input.fields.map((field, index) => {
      if (!field || typeof field !== "object" || Array.isArray(field)) throw new Error(`Question ${index + 1} must be an object.`);
      let id = typeof field.id === "string" && field.id.trim() ? field.id.trim() : makeId();
      if (usedIds.has(id)) id = makeId();
      usedIds.add(id);
      const type = FIELD_TYPES.includes(field.type) ? field.type : "text";
      const validation = field.validation && typeof field.validation === "object" && !Array.isArray(field.validation) ? field.validation : {};
      return {
        id,
        type,
        label: String(field.label ?? `Question ${index + 1}`).slice(0, 100),
        helpText: String(field.helpText ?? "").slice(0, 220),
        placeholder: String(field.placeholder ?? "").slice(0, 160),
        required: Boolean(field.required),
        options: type === "select" && Array.isArray(field.options) ? field.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 40) : [],
        validation: {
          minLength: safeNumber(validation.minLength),
          maxLength: safeNumber(validation.maxLength),
          min: safeNumber(validation.min),
          max: safeNumber(validation.max),
        },
        condition: field.condition && typeof field.condition.fieldId === "string"
          ? { fieldId: field.condition.fieldId, equals: String(field.condition.equals ?? "") }
          : null,
      };
    });

    return {
      schemaVersion: VERSION,
      settings: {
        title: String(input.settings.title ?? "Untitled form").slice(0, 80),
        description: String(input.settings.description ?? "").slice(0, 240),
      },
      fields,
    };
  }
  function state() { return JSON.stringify(schema); }
  function toast(message, isError = false) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.toggle("toast-error", isError);
    node.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("visible"), 2600);
  }
  function save() {
    try {
      localStorage.setItem(DRAFT_KEY, state());
      $("#saveText").textContent = "Saved in this browser";
      $("#save").classList.remove("save-error");
    } catch {
      $("#saveText").textContent = "Could not save";
      $("#save").classList.add("save-error");
    }
  }
  function scheduleSave() {
    $("#saveText").textContent = "Saving…";
    clearTimeout(scheduleSave.timer);
    scheduleSave.timer = setTimeout(save, 180);
  }
  function record(before) {
    const after = state();
    if (!before || before === after) return;
    undoStack.push(before);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    updateHistory();
  }
  function beginEdit() { if (!editStart) editStart = state(); }
  function finishEdit() {
    record(editStart);
    editStart = null;
    updateHistory();
  }
  function updateHistory() {
    $("#undo").disabled = !undoStack.length;
    $("#redo").disabled = !redoStack.length;
  }
  function ensureSelection() {
    if (!schema.fields.some((field) => field.id === selectedFieldId)) selectedFieldId = schema.fields[0]?.id ?? null;
  }
  function render() {
    ensureSelection();
    renderBuilder();
    renderPreview();
    updateHistory();
  }
  function mutate(change) {
    const before = state();
    change();
    ensureSelection();
    record(before);
    render();
    scheduleSave();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(state());
    schema = normalize(JSON.parse(undoStack.pop()));
    answers = {};
    ensureSelection();
    render();
    scheduleSave();
    toast("Change undone.");
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(state());
    schema = normalize(JSON.parse(redoStack.pop()));
    answers = {};
    ensureSelection();
    render();
    scheduleSave();
    toast("Change restored.");
  }

  function parents(field) {
    const index = schema.fields.indexOf(field);
    return schema.fields.slice(0, index).filter((candidate) => ["select", "checkbox"].includes(candidate.type));
  }
  function optionsFor(field) { return field?.type === "checkbox" ? ["true", "false"] : field?.options ?? []; }
  function conditionMarkup(field) {
    const possibleParents = parents(field);
    if (!possibleParents.length) return "";
    const selectedParent = possibleParents.find((candidate) => candidate.id === field.condition?.fieldId);
    const values = optionsFor(selectedParent);
    const selectedValue = values.includes(field.condition?.equals) ? field.condition.equals : values[0];
    const parentChoices = possibleParents.map((parent) => `<option value="${escapeHtml(parent.id)}"${parent.id === selectedParent?.id ? " selected" : ""}>${escapeHtml(parent.label || TYPE_LABELS[parent.type])}</option>`).join("");
    const answerChoices = values.map((value) => `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(value === "true" ? "Checked" : value === "false" ? "Not checked" : value)}</option>`).join("");
    return `<div class="condition-settings">
      <p class="settings-section-label">Show this question if…</p>
      <label class="control-label" for="parent-${escapeHtml(field.id)}">The answer to</label>
      <select class="text-control" id="parent-${escapeHtml(field.id)}" data-id="${escapeHtml(field.id)}" data-prop="parent"><option value="">Always show</option>${parentChoices}</select>
      <label class="control-label" for="equals-${escapeHtml(field.id)}">is</label>
      <select class="text-control" id="equals-${escapeHtml(field.id)}" data-id="${escapeHtml(field.id)}" data-prop="equals"${values.length ? "" : " disabled"}>${answerChoices || "<option value=\"\">Choose an answer first</option>"}</select>
      <p class="field-hint">Only earlier dropdown and checkbox questions can be used.</p>
    </div>`;
  }
  function validationMarkup(field) {
    if (field.type === "text") {
      return `<div class="validation-settings"><p class="settings-section-label">Answer length</p>
        <div class="setting-row"><label class="control-label" for="rule-minLength-${escapeHtml(field.id)}">Minimum characters</label><input class="text-control" id="rule-minLength-${escapeHtml(field.id)}" type="number" min="0" max="5000" placeholder="No minimum" value="${escapeHtml(field.validation.minLength ?? "")}" data-id="${escapeHtml(field.id)}" data-prop="minLength" /></div>
        <div class="setting-row"><label class="control-label" for="rule-maxLength-${escapeHtml(field.id)}">Maximum characters</label><input class="text-control" id="rule-maxLength-${escapeHtml(field.id)}" type="number" min="1" max="5000" placeholder="No maximum" value="${escapeHtml(field.validation.maxLength ?? "")}" data-id="${escapeHtml(field.id)}" data-prop="maxLength" /></div>
      </div>`;
    }
    if (field.type === "number") {
      return `<div class="validation-settings"><p class="settings-section-label">Number range</p>
        <div class="setting-row"><label class="control-label" for="rule-min-${escapeHtml(field.id)}">Smallest allowed number</label><input class="text-control" id="rule-min-${escapeHtml(field.id)}" type="number" placeholder="No minimum" value="${escapeHtml(field.validation.min ?? "")}" data-id="${escapeHtml(field.id)}" data-prop="min" /></div>
        <div class="setting-row"><label class="control-label" for="rule-max-${escapeHtml(field.id)}">Largest allowed number</label><input class="text-control" id="rule-max-${escapeHtml(field.id)}" type="number" placeholder="No maximum" value="${escapeHtml(field.validation.max ?? "")}" data-id="${escapeHtml(field.id)}" data-prop="max" /></div>
      </div>`;
    }
    return "";
  }
  function hasValidation(field) { return Object.values(field.validation).some((value) => value !== null && value !== undefined); }
  function renderQuestionRow(field, index) {
    const selected = field.id === selectedFieldId;
    return `<article class="question-row${selected ? " is-selected" : ""}" role="listitem">
      <button class="question-select" type="button" data-action="select" data-id="${escapeHtml(field.id)}" aria-expanded="${selected}" aria-label="Edit question ${index + 1}: ${escapeHtml(field.label || TYPE_LABELS[field.type])}">
        <span class="question-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="question-glyph" aria-hidden="true">${TYPE_GLYPHS[field.type]}</span>
        <span class="question-copy"><strong>${escapeHtml(field.label || `Untitled ${TYPE_LABELS[field.type]} question`)}</strong><small>${escapeHtml(TYPE_LABELS[field.type])}${field.required ? " · Required" : ""}</small></span>
      </button>
      <div class="question-actions" aria-label="Question ${index + 1} actions">
        <button class="row-action" type="button" data-action="up" data-id="${escapeHtml(field.id)}" aria-label="Move ${escapeHtml(field.label || "question")} up" title="Move up"${index === 0 ? " disabled" : ""}>↑</button>
        <button class="row-action" type="button" data-action="down" data-id="${escapeHtml(field.id)}" aria-label="Move ${escapeHtml(field.label || "question")} down" title="Move down"${index === schema.fields.length - 1 ? " disabled" : ""}>↓</button>
        <button class="row-action remove-action" type="button" data-action="delete" data-id="${escapeHtml(field.id)}" aria-label="Remove ${escapeHtml(field.label || "question")}" title="Remove question">×</button>
      </div>
    </article>`;
  }
  function renderQuestionEditor(field) {
    if (!field) return `<div class="inspector-empty"><span class="inspector-empty-icon" aria-hidden="true">✳</span><strong>Choose a question to edit</strong><p>Select one from the list, or add a question above.</p></div>`;
    const index = schema.fields.indexOf(field);
    const id = escapeHtml(field.id);
    const options = field.type === "select"
      ? `<div class="editor-section"><label class="control-label" for="options-${id}">Answer choices <span>(one per line)</span></label><textarea class="text-control options-control" id="options-${id}" rows="4" maxlength="1200" data-id="${id}" data-prop="options">${escapeHtml(field.options.join("\n"))}</textarea><p class="field-hint">Each line becomes one option students can choose.</p></div>`
      : "";
    const validation = validationMarkup(field);
    const conditions = conditionMarkup(field);
    const advanced = `${validation}${conditions}`;
    const advancedOpen = Boolean(field.condition) || hasValidation(field);
    const placeholderLabel = field.type === "checkbox" ? "Checkbox text" : "Placeholder (optional)";
    const placeholder = ["date", "file"].includes(field.type) ? "" : `<div class="editor-section"><label class="control-label" for="placeholder-${id}">${placeholderLabel}</label><input class="text-control" id="placeholder-${id}" maxlength="160" value="${escapeHtml(field.placeholder)}" placeholder="e.g. Enter your answer" data-id="${id}" data-prop="placeholder" /></div>`;
    return `<div class="inspector-intro">
      <div class="selected-meta"><span>Question ${String(index + 1).padStart(2, "0")}</span><span class="type-pill">${escapeHtml(TYPE_LABELS[field.type])}</span></div>
      <h3>${escapeHtml(field.label || "Untitled question")}</h3>
      <p>Changes show in the preview straight away.</p>
    </div>
    <div class="editor-section"><label class="control-label" for="label-${id}">Question</label><input class="text-control" id="label-${id}" maxlength="100" value="${escapeHtml(field.label)}" data-id="${id}" data-prop="label" /></div>
    <div class="editor-section"><label class="control-label" for="type-${id}">Answer type</label><select class="text-control" id="type-${id}" data-id="${id}" data-prop="type">${FIELD_TYPES.map((type) => `<option value="${type}"${type === field.type ? " selected" : ""}>${TYPE_LABELS[type]}</option>`).join("")}</select></div>
    ${placeholder}
    <div class="editor-section"><label class="control-label" for="help-${id}">Help text <span>(optional)</span></label><input class="text-control" id="help-${id}" maxlength="220" value="${escapeHtml(field.helpText)}" placeholder="Add a short hint for students" data-id="${id}" data-prop="helpText" /></div>
    ${options}
    <label class="required-setting" for="required-${id}"><span><strong>Students must answer this</strong><small>Turn this on to make the question required.</small></span><input id="required-${id}" type="checkbox" data-id="${id}" data-prop="required"${field.required ? " checked" : ""} /></label>
    ${advanced ? `<details class="advanced-settings"${advancedOpen ? " open" : ""}><summary>More options <span>Answer rules and show or hide settings</span></summary><div class="advanced-content">${advanced}</div></details>` : ""}`;
  }
  function renderBuilder() {
    $("#title").value = schema.settings.title;
    $("#description").value = schema.settings.description;
    $("#count").textContent = `${schema.fields.length} ${schema.fields.length === 1 ? "question" : "questions"}`;
    $("#schemaVersion").textContent = schema.schemaVersion;
    fieldsNode.innerHTML = schema.fields.map(renderQuestionRow).join("");
    fieldsNode.hidden = schema.fields.length === 0;
    $("#empty").hidden = schema.fields.length !== 0;
    editorNode.innerHTML = renderQuestionEditor(schema.fields.find((field) => field.id === selectedFieldId));
  }

  function conditionIsVisible(field) {
    if (!field.condition?.fieldId) return true;
    const parent = schema.fields.find((candidate) => candidate.id === field.condition.fieldId);
    if (!parent) return true;
    if (!field.condition.equals) return false;
    return conditionIsVisible(parent) && String(answers[parent.id] ?? "") === field.condition.equals;
  }
  function renderPreview() {
    $("#studentTitle").textContent = schema.settings.title || "Untitled form";
    $("#studentDescription").textContent = schema.settings.description;
    $("#studentDescription").hidden = !schema.settings.description;
    $("#answers").innerHTML = schema.fields.filter(conditionIsVisible).map((field) => {
      const id = escapeHtml(field.id);
      const controlId = `answer-${id}`;
      const required = field.required ? " required" : "";
      const help = field.helpText ? `<p class="answer-help">${escapeHtml(field.helpText)}</p>` : "";
      let input = "";
      if (field.type === "select") {
        input = `<select class="answer-control" id="${controlId}" data-answer="${id}"${required}><option value="">${escapeHtml(field.placeholder || "Choose an option")}</option>${field.options.map((option) => `<option value="${escapeHtml(option)}"${answers[field.id] === option ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
      } else if (field.type === "checkbox") {
        input = `<label class="answer-check" for="${controlId}"><input id="${controlId}" type="checkbox" data-answer="${id}"${answers[field.id] ? " checked" : ""}${required} />${escapeHtml(field.placeholder || "Yes")}</label>`;
      } else {
        const value = field.type === "file" ? "" : ` value="${escapeHtml(answers[field.id] || "")}"`;
        const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : "";
        const rules = field.validation;
        input = `<input class="answer-control" id="${controlId}" type="${field.type}" data-answer="${id}"${value}${placeholder}${required}${rules.minLength !== null && rules.minLength !== undefined ? ` minlength="${rules.minLength}"` : ""}${rules.maxLength !== null && rules.maxLength !== undefined ? ` maxlength="${rules.maxLength}"` : ""}${rules.min !== null && rules.min !== undefined ? ` min="${rules.min}"` : ""}${rules.max !== null && rules.max !== undefined ? ` max="${rules.max}"` : ""} />`;
        if (field.type === "file" && answers[field.id]) input += `<small class="selected-file">Selected: ${escapeHtml(answers[field.id])}</small>`;
      }
      const label = field.type === "checkbox"
        ? `<div class="answer-label">${escapeHtml(field.label)}${field.required ? " *" : ""}</div>`
        : `<label class="answer-label" for="${controlId}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>`;
      return `<div class="answer-question">${label}${help}${input}</div>`;
    }).join("");
    $("#submitMessage").textContent = "";
  }
  function fixConditions() {
    schema.fields.forEach((field, index) => {
      if (!field.condition) return;
      const parentIndex = schema.fields.findIndex((candidate) => candidate.id === field.condition.fieldId);
      const parent = schema.fields[parentIndex];
      if (!parent || parentIndex >= index || !["select", "checkbox"].includes(parent.type)) {
        field.condition = null;
        return;
      }
      const values = optionsFor(parent);
      if (!values.includes(field.condition.equals)) field.condition.equals = values[0] ?? "";
    });
  }
  function addField(type) {
    if (schema.fields.length >= 50) return toast("A form can have up to 50 questions.", true);
    let newId = "";
    mutate(() => {
      newId = makeId();
      schema.fields.push({ id: newId, type, label: "New question", helpText: "", placeholder: type === "select" ? "Choose an option" : "", required: false, options: type === "select" ? ["Option 1", "Option 2"] : [], validation: {}, condition: null });
      selectedFieldId = newId;
    });
    $(`#label-${CSS.escape(newId)}`)?.focus();
    toast(`${TYPE_LABELS[type]} question added.`);
  }
  function renderQuestionList() { fieldsNode.innerHTML = schema.fields.map(renderQuestionRow).join(""); }
  function onEditorInput(event) {
    const element = event.target;
    const property = element.dataset.prop;
    const field = schema.fields.find((candidate) => candidate.id === element.dataset.id);
    if (!property || !field) return;
    beginEdit();
    if (["label", "helpText", "placeholder"].includes(property)) field[property] = element.value;
    else if (property === "options") {
      field.options = element.value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean).slice(0, 40);
      schema.fields.forEach((dependent) => {
        if (dependent.condition?.fieldId === field.id && !field.options.includes(dependent.condition.equals)) dependent.condition.equals = field.options[0] ?? "";
      });
    } else if (["min", "max", "minLength", "maxLength"].includes(property)) field.validation[property] = safeNumber(element.value);
    scheduleSave();
    renderPreview();
    renderQuestionList();
    const row = fieldsNode.querySelector(`[data-action="select"][data-id="${CSS.escape(field.id)}"]`);
    row?.setAttribute("aria-label", `Edit question ${schema.fields.indexOf(field) + 1}: ${field.label || TYPE_LABELS[field.type]}`);
  }
  function onEditorChange(event) {
    const element = event.target;
    const property = element.dataset.prop;
    const field = schema.fields.find((candidate) => candidate.id === element.dataset.id);
    if (!property || !field) return;
    beginEdit();
    let rebuildEditor = property === "options";
    if (property === "required") field.required = element.checked;
    else if (property === "type") {
      field.type = FIELD_TYPES.includes(element.value) ? element.value : "text";
      field.options = field.type === "select" ? (field.options.length ? field.options : ["Option 1", "Option 2"]) : [];
      field.validation = { minLength: null, maxLength: null, min: null, max: null };
      fixConditions();
      rebuildEditor = true;
    } else if (property === "parent") {
      const parent = schema.fields.find((candidate) => candidate.id === element.value);
      field.condition = parent ? { fieldId: parent.id, equals: optionsFor(parent)[0] ?? "" } : null;
      rebuildEditor = true;
    } else if (property === "equals" && field.condition) field.condition.equals = element.value;
    finishEdit();
    scheduleSave();
    if (rebuildEditor) render();
    else { renderPreview(); renderQuestionList(); }
  }
  function onQuestionAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    if (button.dataset.action === "select") {
      if (selectedFieldId === button.dataset.id) return;
      selectedFieldId = button.dataset.id;
      renderBuilder();
      return;
    }
    const index = schema.fields.findIndex((field) => field.id === button.dataset.id);
    if (index < 0) return;
    mutate(() => {
      if (button.dataset.action === "delete") {
        const removedId = schema.fields[index].id;
        schema.fields.splice(index, 1);
        delete answers[removedId];
        schema.fields.forEach((field) => { if (field.condition?.fieldId === removedId) field.condition = null; });
      } else {
        const nextIndex = index + (button.dataset.action === "up" ? -1 : 1);
        if (nextIndex >= 0 && nextIndex < schema.fields.length) {
          [schema.fields[index], schema.fields[nextIndex]] = [schema.fields[nextIndex], schema.fields[index]];
          fixConditions();
        }
      }
    });
  }
  function onAnswer(event) {
    const element = event.target;
    const id = element.dataset.answer;
    if (!id) return;
    const field = schema.fields.find((candidate) => candidate.id === id);
    if (!field) return;
    answers[id] = field.type === "checkbox" ? element.checked : field.type === "file" ? (element.files?.[0]?.name || "") : element.value;
    if (event.type === "change") renderPreview();
  }
  function exportJSON() {
    const file = new Blob([JSON.stringify(schema, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "form-studio-schema.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Form schema exported as JSON.");
  }
  async function importJSON(file) {
    try {
      const imported = normalize(JSON.parse(await file.text()));
      mutate(() => { schema = imported; answers = {}; selectedFieldId = schema.fields[0]?.id ?? null; fixConditions(); });
      toast("Form schema imported.");
    } catch (error) {
      toast(error.message || "Could not import this file.", true);
    }
  }

  fieldsNode.addEventListener("click", onQuestionAction);
  editorNode.addEventListener("focusin", beginEdit);
  editorNode.addEventListener("focusout", finishEdit);
  editorNode.addEventListener("input", onEditorInput);
  editorNode.addEventListener("change", onEditorChange);

  $("#title").addEventListener("focus", beginEdit);
  $("#description").addEventListener("focus", beginEdit);
  $("#title").addEventListener("focusout", finishEdit);
  $("#description").addEventListener("focusout", finishEdit);
  $("#title").addEventListener("input", (event) => { schema.settings.title = event.target.value; renderPreview(); scheduleSave(); });
  $("#description").addEventListener("input", (event) => { schema.settings.description = event.target.value; renderPreview(); scheduleSave(); });

  document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addField(button.dataset.add)));
  document.querySelectorAll("[data-device]").forEach((button) => button.addEventListener("click", () => {
    const mobile = button.dataset.device === "mobile";
    $("#stage").classList.toggle("is-mobile", mobile);
    document.querySelectorAll("[data-device]").forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
  }));

  studentForm.addEventListener("input", onAnswer);
  studentForm.addEventListener("change", onAnswer);
  studentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!studentForm.reportValidity()) {
      $("#submitMessage").textContent = "Please answer the required questions.";
      $("#submitMessage").classList.add("message-error");
    } else {
      $("#submitMessage").textContent = "Looks good. This preview does not send responses.";
      $("#submitMessage").classList.remove("message-error");
    }
  });
  $("#clear").addEventListener("click", () => { answers = {}; renderPreview(); toast("Preview answers cleared."); });
  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);
  $("#exportBtn").addEventListener("click", exportJSON);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (event) => {
    if (event.target.files?.[0]) importJSON(event.target.files[0]);
    event.target.value = "";
  });
  $("#reset").addEventListener("click", () => mutate(() => { schema = copy(STARTER); answers = {}; selectedFieldId = schema.fields[0]?.id ?? null; }));
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  });

  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) { schema = normalize(JSON.parse(saved)); fixConditions(); }
  } catch {
    schema = copy(STARTER);
    selectedFieldId = schema.fields[0]?.id ?? null;
    $("#save").classList.add("save-error");
    $("#saveText").textContent = "Draft could not be read";
  }
  render();
})();
