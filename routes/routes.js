import express from 'express';
import db from "../config/db.js";
import Groq from "groq-sdk";
import generateSQL from './groq_ai.js';




import multer from 'multer';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import sqlite3 from 'sqlite3';

const upload = multer({ storage: multer.memoryStorage() });

let csvDb = null;
let csvTableName = null;
let csvSchema = null;




const router = express.Router();

// Groq client (used by /groq-chart — groq_ai.js keeps its own private instance)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* ── /query — run raw SQL against SQLite ── */
router.post('/query', (req, res) => {
  const query = req.body.q;
  db.all(query, [], (err, rows) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.json(rows);
  });
});

/* ── /groq — NL → SQL ── */
router.post("/groq", async (req, res) => {
  try {
    const q = await generateSQL(req.body.input);
    res.json(q);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── /groq-chart — data + question → Chart.js config ── */
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

Return ONLY a valid JSON object. No explanation, no markdown, no backticks, no text before or after.

The JSON must have this exact shape:
{
  "type": <one of: "bar", "line", "pie", "doughnut", "radar", "polarArea">,
  "insight": "<one sentence describing what this chart shows>",
  "data": { <Chart.js data object with labels array and datasets array> },
  "options": { <Chart.js options object> }
}

STRICT RULES:
1. Do NOT use "scatter" or "bubble" types. Use "bar" or "line" instead.
2. Pick the best type: time/trend → line, comparisons → bar, multi-metric → radar. For COUNT(*) GROUP BY queries with ≤7 categories → ALWAYS use doughnut, never bar.
3. Every dataset must have backgroundColor and borderColor. Use ONLY these hex colors in order: ["#3b82f6","#00ffa3","#f59e0b","#ef4444","#a78bfa","#ec4899","#2dd4bf","#f97316"]
4. For bar charts: add borderRadius: 6 and borderSkipped: "bottom" to each dataset object.
5. For line charts: add tension: 0.4, fill: false, pointRadius: 4 to each dataset object.
6. options must contain: responsive: true, maintainAspectRatio: false
options.plugins.legend.display must be true for pie, doughnut, radar, AND any bar/line chart that has MORE THAN ONE dataset. false only for single-dataset bar or line.
8. options.plugins.tooltip must be an object (can be empty: {}).
9. For bar and line: options.scales.x and options.scales.y must each have:
   - grid: { color: "rgba(255,255,255,0.06)" }
   - ticks: { color: "#5a6478" }
   - title: { display: true, text: "<meaningful label for this axis>", color: "#8892a4", font: { size: 11 } }
10. x axis title should describe what the categories represent (e.g. "City Tier", "Gender", "Shopping Preference")
11. y axis title should describe the numeric value (e.g. "Average Spend (₹)", "Count", "Score")
12. For pie/doughnut/radar: skip axis titles (no scales needed)

13. Limit to 20 data points. If the sample has more, pick the top 20 by the numeric column.
14. data.labels must be an array of strings.
15. data.datasets must be an array with at least one object containing a "data" array of numbers.
16. Return ONLY the JSON. The very first character of your response must be "{".
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2000
    });

    const raw = completion.choices[0].message.content.trim();

    // Robustly extract JSON — find the first { and last }
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error("AI did not return a JSON object");
    }

    const jsonStr = raw.slice(firstBrace, lastBrace + 1);
    const config = JSON.parse(jsonStr);

    // Validate minimum required shape
    if (!config.type || !config.data || !config.data.datasets) {
      throw new Error("AI returned incomplete chart config");
    }

    // Safety: force-remove scatter/bubble in case AI ignored the rule
    if (config.type === "scatter" || config.type === "bubble") {
      config.type = "bar";
    }

    // Safety: ensure labels exist
    if (!config.data.labels) {
      config.data.labels = config.data.datasets[0]?.data?.map((_, i) => `Item ${i + 1}`) || [];
    }

    res.json(config);

  } catch (err) {
    console.error("groq-chart error:", err.message);
    res.status(500).json({ error: err.message });
  }
});




//csv 


router.post('/upload-csv', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const rows = await new Promise((resolve, reject) => {
      const results = [];
      Readable.from(req.file.buffer.toString())
        .pipe(csvParser())
        .on('data', r => results.push(r))
        .on('end', () => resolve(results))
        .on('error', reject);
    });

    if (rows.length === 0) return res.status(400).json({ error: "CSV is empty" });

    const columns = Object.keys(rows[0]);
    csvTableName = "uploaded_data";
    csvDb = new sqlite3.Database(":memory:");

    const colDefs = columns.map(col => {
      const isNum = rows.slice(0,20).map(r => r[col]).filter(v => v !== "")
        .every(v => !isNaN(parseFloat(v)));
      return `"${col}" ${isNum ? "REAL" : "TEXT"}`;
    });

    csvSchema = `CREATE TABLE "uploaded_data" (${colDefs.join(", ")});`;

    await new Promise((res, rej) => csvDb.run(csvSchema, err => err ? rej(err) : res()));

    for (const row of rows) {
      const vals = columns.map(col => {
        const v = row[col];
        return (v === "" || v == null) ? null : isNaN(parseFloat(v)) ? v : parseFloat(v);
      });
      const sql = `INSERT INTO "uploaded_data" VALUES (${columns.map(() => "?").join(",")})`;
      await new Promise((res, rej) => csvDb.run(sql, vals, err => err ? rej(err) : res()));
    }

    res.json({ success: true, columns, rowCount: rows.length, schema: csvSchema });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/query-csv', (req, res) => {
  if (!csvDb) return res.status(400).json({ error: "No CSV loaded" });
  csvDb.all(req.body.q, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.post('/groq-csv', async (req, res) => {
  if (!csvSchema) return res.status(400).json({ error: "No CSV loaded" });
  const prompt = `You are an expert SQL generator.
Convert the user question into a SQL query.
Rules:
- Return ONLY the SQL query. No explanation, no markdown.
- Table name is "uploaded_data"
- Write queries suitable for charts (GROUP BY, aggregations, ORDER BY)
- If impossible, return: give valid input
Schema: ${csvSchema}
User Question: ${req.body.input}`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    });
    res.json(completion.choices[0].message.content.trim());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
