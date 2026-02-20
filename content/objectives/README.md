# SY0-701 Objectives Source

- Place the official CompTIA SY0-701 objectives PDF in this folder as `SY0-701-Exam-Objectives.pdf`.
- The parser uses the `pdftotext` CLI (`poppler-utils`) to extract text.
- Regenerate normalized objectives JSON with:

```bash
npm run objectives:parse
```

- The parser writes `sy0-701.objectives.json` and validates it against `sy0-701.objectives.schema.json`.
