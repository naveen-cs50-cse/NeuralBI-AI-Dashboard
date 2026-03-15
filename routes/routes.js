import express from "express";
import db from "../config/db.js";
import Groq from "groq-sdk";
import generateSQL from "./groq_ai.js";

import multer from "multer";
import csvParser from "csv-parser";
import { Readable } from "stream";
import Database from "better-sqlite3";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

let csvDb = null;
let csvTableName = null;
let csvSchema = null;

// Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});



/* ───────────── RUN RAW SQL (MAIN DATABASE) ───────────── */

router.post("/query", (req, res) => {
  const query = req.body.q;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    res.json(rows);
  });
});



/* ───────────── NL → SQL USING GROQ ───────────── */

router.post("/groq", async (req, res) => {
  try {
    const q = await generateSQL(req.body.input);
    res.json(q);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



/* ───────────── DATA → CHART CONFIG ───────────── */

router.post("/groq-chart", async (req, res) => {

  const { data, userQuestion, sqlQuery } = req.body;

  if (!data || data.length === 0) {
    return res.status(400).json({ error: "No data provided" });
  }

  const columns = Object.keys(data[0]);
  const sample = data.slice(0, 30);

  const prompt = `
You are an expert data visualization AI.

The user asked: "${userQuestion}"
SQL used: ${sqlQuery}
Columns: ${JSON.stringify(columns)}
Data (sample): ${JSON.stringify(sample)}

Return ONLY a valid JSON object. No explanation.

{
  "type": "bar | line | pie | doughnut | radar | polarArea",
  "insight": "one sentence insight",
  "data": { Chart.js data object },
  "options": { Chart.js options object }
}

Rules:
- Never use scatter or bubble
- Trend → line
- comparison → bar
- <=7 categories COUNT → doughnut
`;

  try {

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2000
    });

    const raw = completion.choices[0].message.content.trim();

    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error("AI did not return JSON");
    }

    const jsonStr = raw.slice(firstBrace, lastBrace + 1);
    const config = JSON.parse(jsonStr);

    if (!config.type || !config.data) {
      throw new Error("Invalid chart config");
    }

    res.json(config);

  } catch (err) {

    console.error("groq-chart error:", err.message);

    res.status(500).json({
      error: err.message
    });

  }

});



/* ───────────── CSV UPLOAD → SQLITE MEMORY DB ───────────── */

router.post("/upload-csv", upload.single("file"), async (req, res) => {

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {

    const rows = await new Promise((resolve, reject) => {

      const results = [];

      Readable.from(req.file.buffer.toString())
        .pipe(csvParser())
        .on("data", r => results.push(r))
        .on("end", () => resolve(results))
        .on("error", reject);

    });

    if (rows.length === 0) {
      return res.status(400).json({ error: "CSV empty" });
    }

    const columns = Object.keys(rows[0]);

    csvTableName = "uploaded_data";

    csvDb = new Database(":memory:");



    /* CREATE TABLE */

    const colDefs = columns.map(col => {

      const isNum = rows
        .slice(0, 20)
        .map(r => r[col])
        .filter(v => v !== "")
        .every(v => !isNaN(parseFloat(v)));

      return `"${col}" ${isNum ? "REAL" : "TEXT"}`;

    });

    csvSchema = `CREATE TABLE ${csvTableName} (${colDefs.join(", ")})`;

    csvDb.prepare(csvSchema).run();



    /* INSERT DATA */

    const insertSQL =
      `INSERT INTO ${csvTableName} VALUES (${columns.map(() => "?").join(",")})`;

    const stmt = csvDb.prepare(insertSQL);

    for (const row of rows) {

      const vals = columns.map(col => {

        const v = row[col];

        if (v === "" || v == null) return null;

        return isNaN(parseFloat(v)) ? v : parseFloat(v);

      });

      stmt.run(vals);

    }

    res.json({
      success: true,
      columns,
      rowCount: rows.length,
      schema: csvSchema
    });

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }

});



/* ───────────── QUERY CSV SQLITE ───────────── */

router.post("/query-csv", (req, res) => {

  if (!csvDb) {
    return res.status(400).json({ error: "No CSV loaded" });
  }

  try {

    const rows = csvDb.prepare(req.body.q).all();

    res.json(rows);

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }

});



/* ───────────── NL → SQL FOR CSV DATA ───────────── */

router.post("/groq-csv", async (req, res) => {

  if (!csvSchema) {
    return res.status(400).json({ error: "No CSV loaded" });
  }

  const prompt = `
You are an expert SQL generator.

Convert user question to SQL.

Rules:
Return ONLY SQL.

Table: uploaded_data

Schema:
${csvSchema}

Question:
${req.body.input}
`;

  try {

    const completion = await groq.chat.completions.create({

      model: "llama-3.3-70b-versatile",

      messages: [
        { role: "user", content: prompt }
      ],

      temperature: 0

    });

    res.json(
      completion.choices[0].message.content.trim()
    );

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }

});



export default router;