import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default async function generateSQL(userQuery) {

  const schema = `
CREATE TABLE "sales" (
  "monthly_income"              INTEGER,
  "daily_internet_hours"        INTEGER,
  "smartphone_usage_years"      INTEGER,
  "social_media_hours"          REAL,
  "online_payment_trust_score"  INTEGER,
  "tech_savvy_score"            INTEGER,
  "monthly_online_orders"       INTEGER,
  "monthly_store_visits"        INTEGER,
  "avg_online_spend"            INTEGER,
  "avg_store_spend"             INTEGER,
  "discount_sensitivity"        INTEGER,
  "return_frequency"            INTEGER,
  "avg_delivery_days"           INTEGER,
  "delivery_fee_sensitivity"    INTEGER,
  "free_return_importance"      INTEGER,
  "product_availability_online" INTEGER,
  "impulse_buying_score"        INTEGER,
  "need_touch_feel_score"       INTEGER,
  "brand_loyalty_score"         INTEGER,
  "environmental_awareness"     INTEGER,
  "time_pressure_level"         INTEGER,
  "gender"                      TEXT,
  "city_tier"                   TEXT,
  "shopping_preference"         TEXT
);
`;

  const prompt = `
You are an expert SQL generator.

Convert the user question into a SQL query.

Rules:
- Return ONLY the SQL query. No explanation, no hyphens, no markdown.
- Use the schema below.
- Write queries that return data suitable for charts (aggregations, GROUP BY, ORDER BY).
- If the question cannot be answered with SQL from this schema, return exactly: give valid input

- remeber this is imp just limit the data to just some rows , only some meaning full rows within 10 or something youthink meaningfull

Schema:
${schema}

User Question:
${userQuery}
`;

  const completion = await groq.chat.completions.create({
	model: "llama-3.3-70b-versatile",
	messages: [{ role: "user", content: prompt }],
	temperature: 0
  });

  return completion.choices[0].message.content;
}
