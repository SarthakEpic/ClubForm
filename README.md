# Form Studio

Form Studio is a small, no-code form builder made with plain HTML, CSS, and JavaScript. It runs in a modern browser without a package install or build step.

## Open the app

Open `index.html` in a browser. Your form draft saves automatically in that browser. The **Reset sample** button restores the example form.

## What you can do

- Add, remove, and move questions.
- Use short answer, number, dropdown, checkbox, date, and file upload questions.
- Edit question text, help text, answer choices, and required settings.
- Set answer length or number limits.
- Show a question only when a student gives a chosen earlier answer.
- See the student form update as you build; switch between desktop and mobile previews.
- Try the form's required-question and answer checks in the preview.
- Undo or redo changes with the toolbar or Ctrl/⌘+Z and Ctrl/⌘+Shift+Z.
- Import and export a versioned JSON form. `example-schema.json` includes all six question types and a conditional question.

## How form data is managed

`app.js` stores the form in one `schema` object. That object holds the title, welcome message, and ordered question list. The question list and settings editor both update that object, and the student preview reads from it. Preview answers live separately, so they never get mixed into the form definition.

Each edit saves a previous schema snapshot for undo. Autosave writes the current schema to this browser's local storage. Import checks and normalizes the JSON before replacing the form; export saves the current schema as a JSON file. The `schemaVersion` field lets the builder accept older forms and reject versions it does not support.

## Prototype limits

This is a front-end prototype. Preview responses are not submitted or saved, and selecting a file only shows its name in the preview; it does not upload the file.
