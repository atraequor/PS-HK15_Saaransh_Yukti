require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const os = require("os");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || "farmmind_secret_key";
const DEFAULT_USER_EMAIL =
  process.env.DEFAULT_USER_EMAIL || "guest@farmmind.local";
const DEFAULT_USER_NAME = process.env.DEFAULT_USER_NAME || "Guest Farmer";
let DEFAULT_USER_ID = null;

// Paths
const BASE_DIR = path.resolve(__dirname, "..");
const DB_PATH = path.join(BASE_DIR, "database", "farm_copilot.db");
const LOGS_DIR = path.join(BASE_DIR, "logs");
const EVENT_LOG_FILE = path.join(LOGS_DIR, "farm_events.jsonl");

// Ollama Local Models
const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || "mistral:7b";
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "llava:7b";

// Copilot (Cloud)
const COPILOT_OLLAMA_URL =
  process.env.COPILOT_OLLAMA_URL || "http://localhost:11434/api/generate";
const COPILOT_OLLAMA_MODEL =
  process.env.COPILOT_OLLAMA_MODEL || "mistral:7b";

// OpenAI (Copilot)
const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_BASE = (
  process.env.OPENAI_API_BASE || "https://api.openai.com/v1"
).replace(/\/$/, "");

const TRANSLATE_MAX_TEXTS = 60;
const TRANSLATE_MAX_CHARS = 1200;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(BASE_DIR));

// DB Init
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Database opening error:", err);
  else console.log("Connected to SQLite database:", DB_PATH);
});

const SOCIAL_DB_PATH = path.join(BASE_DIR, "database", "social_farm.db");
const sdb = new sqlite3.Database(SOCIAL_DB_PATH, (err) => {
  if (err) console.error("Social DB error:", err);
  else console.log("Connected to Social database:", SOCIAL_DB_PATH);
});

// Helper
function registerEvent(type, payload) {
  const event = {
    timestamp: new Date().toISOString(),
    event_type: type,
    payload,
  };
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(EVENT_LOG_FILE, JSON.stringify(event) + "\n");
}

// ─── SCHEMA ─────────────────────────────────────────────────────────────────
sdb.serialize(() => {
  // Attach main DB for cross-joins (users info)
  sdb.run(`ATTACH DATABASE '${DB_PATH.replace(/'/g, "''")}' AS main_db`);

  sdb.run(`CREATE TABLE IF NOT EXISTS posts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        content     TEXT NOT NULL,
        category    TEXT DEFAULT 'general',
        mood        TEXT,
        is_private  INTEGER DEFAULT 0,
        image_url   TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  sdb.run(`CREATE TABLE IF NOT EXISTS post_seeds (
        user_id INTEGER,
        post_id INTEGER,
        PRIMARY KEY(user_id, post_id)
    )`);

  sdb.run(`CREATE TABLE IF NOT EXISTS comment_roots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id     INTEGER NOT NULL,
        user_id     INTEGER NOT NULL,
        content     TEXT NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  sdb.run(`CREATE TABLE IF NOT EXISTS follows (
        follower_id INTEGER NOT NULL,
        following_id INTEGER NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (follower_id, following_id)
    )`);

  sdb.run(`CREATE TABLE IF NOT EXISTS follow_requests (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL,
        target_id   INTEGER NOT NULL,
        status      TEXT DEFAULT 'pending',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  sdb.run(`CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id   INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        content     TEXT NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

db.serialize(() => {
  // Users table — full farmer profile
  db.run(`CREATE TABLE IF NOT EXISTS users (
        id              INTEGER  PRIMARY KEY AUTOINCREMENT,
        full_name       TEXT     NOT NULL,
        email           TEXT     NOT NULL UNIQUE,
        password_hash   TEXT     NOT NULL,
        phone           TEXT,
        state           TEXT,
        district        TEXT,
        role            TEXT     DEFAULT 'farmer',
        experience_yrs  INTEGER  DEFAULT 0,
        farm_size_acres REAL,
        primary_crop    TEXT,
        soil_type       TEXT,
        irrigation_src  TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login      DATETIME
    )`);

  // Optional: add skill_level column if missing (ignore duplicate column error)
  db.run(`ALTER TABLE users ADD COLUMN skill_level TEXT`, (err) => {
    if (
      err &&
      !String(err.message || "")
        .toLowerCase()
        .includes("duplicate")
    ) {
      console.error("Failed to add skill_level column:", err.message || err);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS farms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        location TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  db.run(
    `CREATE TABLE IF NOT EXISTS fields (id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER, name TEXT)`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS crops (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, season TEXT, water_needs TEXT)`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS farm_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, field_id INTEGER, user_id INTEGER, log_date DATE DEFAULT (date('now')), category TEXT, title TEXT, description TEXT)`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS plantings (id INTEGER PRIMARY KEY AUTOINCREMENT, field_id INTEGER, status TEXT)`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, field_id INTEGER, status TEXT, priority TEXT)`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, field_id INTEGER, is_read INTEGER DEFAULT 0)`,
  );
});

// ─── TRANSLATION (Ollama - Local) ───────────────────────────────────────────
app.post("/api/translate", async (req, res) => {
  const body = req.body || {};
  const texts = Array.isArray(body.texts) ? body.texts : null;
  if (!texts) return res.status(400).json({ error: "texts must be an array" });
  if (texts.length > TRANSLATE_MAX_TEXTS) {
    return res
      .status(400)
      .json({ error: `Too many texts. Max ${TRANSLATE_MAX_TEXTS}.` });
  }

  const sourceLang = body.source_lang || "en";
  const targetLang = body.target_lang || "hi";

  const normalized = texts.map((t) => {
    if (typeof t !== "string") return "";
    if (t.length <= TRANSLATE_MAX_CHARS) return t;
    return t.slice(0, TRANSLATE_MAX_CHARS);
  });

  try {
    const prompt = `Translate the following list of texts from ${langName(sourceLang)} to ${langName(targetLang)}.
Return ONLY a JSON array of translated strings in the same order. Do not add extra keys or commentary.
Texts: ${JSON.stringify(normalized)}`;

    const response = await axios.post(
      OLLAMA_URL,
      {
        model: OLLAMA_TEXT_MODEL,
        prompt: prompt.trim(),
        stream: false,
      },
      { timeout: 60000 },
    );

    const raw = response.data?.response || "";
    const parsed = extractJson(raw);
    if (!Array.isArray(parsed)) {
      return res.status(500).json({ error: "Translation parse failed." });
    }
    res.json({ translations: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message || "Translation failed" });
  }
});

app.get("/api/translate/languages", async (req, res) => {
  res.json({ languages: TRANSLATE_LANGS });
});

function resolveDefaultUser(cb) {
  if (DEFAULT_USER_ID) return cb(null, DEFAULT_USER_ID);
  db.get("SELECT id FROM users ORDER BY id LIMIT 1", (err, row) => {
    if (err) return cb(err);
    if (row && row.id) {
      DEFAULT_USER_ID = row.id;
      return cb(null, row.id);
    }
    const hash = bcrypt.hashSync("guest", 8);
    db.run(
      `INSERT INTO users (full_name, email, password_hash, phone, state, district, role, experience_yrs, farm_size_acres, primary_crop, soil_type, irrigation_src)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_USER_NAME,
        DEFAULT_USER_EMAIL,
        hash,
        null,
        null,
        null,
        "farmer",
        0,
        null,
        null,
        null,
        null,
      ],
      function (insertErr) {
        if (insertErr) return cb(insertErr);
        DEFAULT_USER_ID = this.lastID;
        cb(null, this.lastID);
      },
    );
  });
}

// ─── AUTH MIDDLEWARE (DISABLED) ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.user && req.user.id) return next();
  resolveDefaultUser((err, id) => {
    if (err)
      return res
        .status(500)
        .json({ error: "Failed to initialize default user." });
    req.user = {
      id,
      email: DEFAULT_USER_EMAIL,
      full_name: DEFAULT_USER_NAME,
      role: "farmer",
    };
    next();
  });
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  const {
    full_name,
    email,
    password,
    phone,
    state,
    district,
    role,
    experience_yrs,
    farm_size_acres,
    primary_crop,
    soil_type,
    irrigation_src,
  } = req.body;

  if (!full_name || !email || !password)
    return res
      .status(400)
      .json({ error: "Name, email and password are required." });

  const hash = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (full_name, email, password_hash, phone, state, district, role, experience_yrs, farm_size_acres, primary_crop, soil_type, irrigation_src)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      full_name,
      email,
      hash,
      phone || null,
      state || null,
      district || null,
      role || "farmer",
      experience_yrs || 0,
      farm_size_acres || null,
      primary_crop || null,
      soil_type || null,
      irrigation_src || null,
    ],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE"))
          return res.status(409).json({ error: "Email already registered." });
        return res.status(500).json({ error: err.message });
      }
      const token = jwt.sign(
        { id: this.lastID, email, full_name, role: role || "farmer" },
        JWT_SECRET,
        { expiresIn: "7d" },
      );
      res.json({
        token,
        user: {
          id: this.lastID,
          full_name,
          email,
          role: role || "farmer",
          state,
          district,
          primary_crop,
        },
      });
    },
  );
});

// LOGIN
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required." });

  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err || !user)
      return res.status(401).json({ error: "Invalid email or password." });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: "Invalid email or password." });

    db.run("UPDATE users SET last_login = ? WHERE id = ?", [
      new Date().toISOString(),
      user.id,
    ]);

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );
    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        state: user.state,
        district: user.district,
        primary_crop: user.primary_crop,
        farm_size_acres: user.farm_size_acres,
      },
    });
  });
});

// GET CURRENT USER (protected)
app.get("/api/auth/me", requireAuth, (req, res) => {
  db.get(
    "SELECT id, full_name, email, phone, state, district, role, experience_yrs, farm_size_acres, primary_crop, soil_type, irrigation_src, skill_level, created_at FROM users WHERE id = ?",
    [req.user.id],
    (err, user) => {
      if (err || !user)
        return res.status(404).json({ error: "User not found." });
      res.json(user);
    },
  );
});

// UPDATE PROFILE (protected)
app.put("/api/auth/me", requireAuth, (req, res) => {
  const {
    full_name,
    phone,
    state,
    district,
    role,
    experience_yrs,
    farm_size_acres,
    primary_crop,
    soil_type,
    irrigation_src,
    skill_level,
  } = req.body;

  db.run(
    `UPDATE users SET 
            full_name = ?, phone = ?, state = ?, district = ?, role = ?,
            experience_yrs = ?, farm_size_acres = ?, primary_crop = ?, 
            soil_type = ?, irrigation_src = ?, skill_level = ?
         WHERE id = ?`,
    [
      full_name,
      phone,
      state,
      district,
      role,
      experience_yrs,
      farm_size_acres,
      primary_crop,
      soil_type,
      irrigation_src,
      skill_level,
      req.user.id,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        "SELECT id, full_name, email, role, state, district, primary_crop, farm_size_acres, soil_type, skill_level FROM users WHERE id = ?",
        [req.user.id],
        (err, user) => {
          res.json({ success: true, user });
        },
      );
    },
  );
});

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
function deriveSkillLevel(user) {
  if (!user) return "Beginner";
  if (user.skill_level) return user.skill_level;
  const role = String(user.role || "").toLowerCase();
  if (role.includes("tech")) return "Tech-Savvy";
  const exp = Number(user.experience_yrs || 0);
  if (exp >= 8) return "Traditional";
  return "Beginner";
}

function buildProfileFromUser(user) {
  if (!user) {
    return {
      location: "unknown",
      soil: "unknown",
      crop: "unknown",
      skills: "Beginner",
    };
  }
  const location =
    [user.district, user.state].filter(Boolean).join(", ") || "unknown";
  return {
    location,
    soil: user.soil_type || "unknown",
    crop: user.primary_crop || "unknown",
    skills: deriveSkillLevel(user),
  };
}

function buildSystemPrompt(profile, current) {
  const systemPrompt = `You are a professional Agricultural engineer in form of a copilot. The context of soil-"${profile.soil}", time-"${current.time}", date-"${current.date}", location-"${profile.location}" crop-"${profile.crop}" are given. You must provide an structured, easy to grasp suggestion based on the farmers skills as "${profile.skills}". You shall politely reply to greetings and general queries but act as an ai copilot strictly made for agricultural purposes.`;
  return systemPrompt;
}

function extractJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

const TRANSLATE_LANGS = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "te", name: "Telugu" },
  { code: "ta", name: "Tamil" },
  { code: "kn", name: "Kannada" },
  { code: "mr", name: "Marathi" },
  { code: "bn", name: "Bengali" },
  { code: "gu", name: "Gujarati" },
  { code: "pa", name: "Punjabi" },
  { code: "ur", name: "Urdu" },
];

function langName(code) {
  const found = TRANSLATE_LANGS.find((l) => l.code === code);
  return found ? found.name : code;
}

// ─── API ENDPOINTS (protected) ───────────────────────────────────────────────

app.get("/api/dashboard", requireAuth, (req, res) => {
  const uid = req.user.id;
  db.get(
    "SELECT COUNT(*) as c FROM plantings WHERE status = 'active'",
    (e, r1) => {
      db.get(
        "SELECT COUNT(*) as c FROM tasks WHERE status = 'pending' AND priority = 'urgent'",
        (e, r2) => {
          db.get(
            "SELECT COUNT(*) as c FROM alerts WHERE is_read = 0",
            (e, r3) => {
              db.all(
                "SELECT * FROM farm_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 5",
                [uid],
                (e, logs) => {
                  db.all(
                    "SELECT f.* FROM fields f JOIN farms fm ON f.farm_id = fm.id WHERE fm.user_id = ?",
                    [uid],
                    (e, fields) => {
                      res.json({
                        active_plantings_count: r1?.c || 0,
                        pending_urgent_tasks: r2?.c || 0,
                        unread_alerts: r3?.c || 0,
                        recent_logs: logs || [],
                        fields_overview: fields || [],
                      });
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
});

app.get("/api/farms", requireAuth, (req, res) => {
  db.all(
    "SELECT * FROM farms WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id],
    (err, rows) => res.json(rows || []),
  );
});

app.post("/api/farms", requireAuth, (req, res) => {
  const { name, location } = req.body;
  db.run(
    "INSERT INTO farms (user_id, name, location) VALUES (?, ?, ?)",
    [req.user.id, name, location],
    function (err) {
      res.json({ id: this.lastID, name, location });
    },
  );
});

app.get("/api/fields", requireAuth, (req, res) => {
  db.all(
    "SELECT f.* FROM fields f JOIN farms fm ON f.farm_id = fm.id WHERE fm.user_id = ?",
    [req.user.id],
    (err, rows) => res.json(rows || []),
  );
});

app.post("/api/fields", requireAuth, (req, res) => {
  const { farm_id, name } = req.body;
  db.run(
    "INSERT INTO fields (farm_id, name) VALUES (?, ?)",
    [farm_id, name],
    function (err) {
      res.json({ id: this.lastID, farm_id, name });
    },
  );
});

app.post("/api/crops", requireAuth, (req, res) => {
  const { name, season } = req.body;
  db.run(
    "INSERT INTO crops (name, season, water_needs) VALUES (?, ?, 'medium')",
    [name, season],
    function (err) {
      res.json({ id: this.lastID, name, season });
    },
  );
});

app.post("/api/logs", requireAuth, (req, res) => {
  const { field_id, category, title, description, device_timestamp } = req.body;
  const logDate = device_timestamp
    ? device_timestamp.split("T")[0]
    : new Date().toISOString().split("T")[0];
  db.run(
    "INSERT INTO farm_logs (field_id, user_id, log_date, category, title, description) VALUES (?, ?, ?, ?, ?, ?)",
    [field_id, req.user.id, logDate, category, title, description],
    function (err) {
      res.json({
        id: this.lastID,
        field_id,
        log_date: logDate,
        category,
        title,
        description,
      });
    },
  );
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const body = req.body || {};
  const deviceTimestamp = body.device_timestamp;
  const now = deviceTimestamp ? new Date(deviceTimestamp) : new Date();
  const current = {
    time: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(now),
    date: new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now),
  };

  const extractUserMessage = () => {
    if (typeof body.message === "string" && body.message.trim())
      return body.message.trim();
    if (typeof body.prompt === "string" && body.prompt.trim())
      return body.prompt.trim();
    if (Array.isArray(body.messages)) {
      const lastUser = [...body.messages]
        .reverse()
        .find((msg) => msg && msg.role === "user");
      if (!lastUser) return "";
      if (typeof lastUser.content === "string") return lastUser.content.trim();
      if (Array.isArray(lastUser.content)) {
        return lastUser.content
          .map((part) => part.text || "")
          .join(" ")
          .trim();
      }
    }
    return "";
  };

  const userMessage = extractUserMessage();
  if (!userMessage) {
    return res.status(400).json({ error: "message is required" });
  }

  db.get("SELECT * FROM users WHERE id = ?", [req.user.id], (err, user) => {
    db.all(
      "SELECT * FROM farm_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 5",
      [req.user.id],
      async (logErr, logs) => {
        const profile = buildProfileFromUser(user);
        const systemPrompt = buildSystemPrompt(profile, current);
        const logContext =
          Array.isArray(logs) && logs.length
            ? `\n\nRecent Farm Logs: ${JSON.stringify(logs)}`
            : "";
        const finalMessage = `${userMessage}${logContext}`;

        const messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: finalMessage },
        ];

        try {
          const errors = [];

          const callOpenAI = async () => {
            if (!OPENAI_API_KEY) {
              throw new Error("OPENAI_API_KEY is not configured");
            }
            const response = await axios.post(
              `${OPENAI_API_BASE}/chat/completions`,
              {
                model: OPENAI_MODEL,
                messages,
                temperature: 0.4,
              },
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${OPENAI_API_KEY}`,
                },
                timeout: 60000,
              },
            );
            const reply = response.data?.choices?.[0]?.message?.content?.trim();
            if (!reply) throw new Error("Empty response from OpenAI");
            return reply;
          };

          const callOllama = async () => {
            const prompt = `${systemPrompt}\n\nFarmer Query:\n${finalMessage}\n\nRespond with practical, step-by-step farm guidance.`;
            const response = await axios.post(
              COPILOT_OLLAMA_URL,
              {
                model: COPILOT_OLLAMA_MODEL,
                prompt,
                stream: false,
              },
              { timeout: 60000 },
            );
            const reply = (response.data?.response || "").trim();
            if (!reply) throw new Error("Empty response from Ollama");
            return reply;
          };

          const buildFallbackReply = () => {
            const crop = profile.crop && profile.crop !== "unknown" ? profile.crop : "your crop";
            const soil = profile.soil && profile.soil !== "unknown" ? profile.soil : "current soil";
            const location = profile.location && profile.location !== "unknown" ? profile.location : "your location";
            return [
              `I could not reach AI providers, but here is immediate guidance for ${crop} in ${location}:`,
              "1) Inspect one representative plot now for visible stress, pest activity, and moisture level.",
              "2) If topsoil is dry, do a light irrigation cycle first and avoid overwatering in one pass.",
              `3) For ${soil} soil, avoid sudden heavy fertilizer changes; split nutrient application into smaller doses.`,
              "4) Record symptoms (leaf color, spots, wilting pattern, time of day) and run disease scan for targeted action.",
              "5) If symptoms worsen in 24 hours, prioritize pest/fungal intervention based on affected area percentage.",
            ].join("\n");
          };

          let reply = "";
          try {
            reply = await callOpenAI();
          } catch (openaiErr) {
            errors.push(`OpenAI: ${openaiErr.message}`);
            try {
              reply = await callOllama();
            } catch (ollamaErr) {
              errors.push(`Ollama: ${ollamaErr.message}`);
              reply = buildFallbackReply();
            }
          }

          if (errors.length) {
            console.warn("Copilot provider fallback used:", errors.join(" | "));
          }

          res.json({ reply });
        } catch (error) {
          const errMsg =
            error?.response?.data?.error?.message ||
            error.message ||
            "Copilot Error";
          res.status(500).json({ error: errMsg });
        }
      },
    );
  });
});

app.post("/api/analyze", requireAuth, async (req, res) => {
  const { image, hint } = req.body || {};
  if (!image || typeof image !== "string") {
    return res.status(400).json({ error: "image is required" });
  }

  const base64 = image.includes(",") ? image.split(",")[1] : image;
  const prompt = `
You are an agronomy vision assistant. Analyze the image and respond in strict JSON only.
Tasks:
1) Determine if the image shows a plant/leaf/crop. Output boolean is_plant.
2) If is_plant is false, provide is_not_plant_reason.
3) If is_plant is true, provide possible_disease (or "Healthy"), confidence (0-100), and observation (1-2 sentences).
4) Avoid speculation beyond visible symptoms.
Input hint: ${hint || "none"}.
Return JSON with keys: is_plant, possible_disease, confidence, observation, is_not_plant_reason.
`;

  try {
    const response = await axios.post(
      OLLAMA_URL,
      {
        model: OLLAMA_VISION_MODEL,
        prompt: prompt.trim(),
        images: [base64],
        stream: false,
      },
      { timeout: 60000 },
    );

    const raw =
      response.data && response.data.response ? response.data.response : "";
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (_) {}
      }
    }

    if (!parsed || typeof parsed !== "object") {
      return res.status(500).json({
        is_plant: false,
        possible_disease: "Unknown",
        confidence: "0",
        observation: "Model output could not be parsed.",
        is_not_plant_reason: "Unrecognized model response.",
      });
    }

    const isPlant = parsed.is_plant === true;
    const possibleDisease =
      parsed.possible_disease || (isPlant ? "Unknown" : "Not a plant");
    const confidence =
      parsed.confidence !== undefined && parsed.confidence !== null
        ? `${parsed.confidence}`
        : "0";
    const observation = parsed.observation || "";
    const notPlantReason = parsed.is_not_plant_reason || "";

    res.json({
      is_plant: isPlant,
      disease: possibleDisease,
      confidence,
      observation,
      is_not_plant_reason: notPlantReason,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Ollama vision failed" });
  }
});

app.get("/api/news", requireAuth, async (req, res) => {
  const query = (req.query.q || "agriculture").toString();
  const country = (req.query.country || "IN").toString().toUpperCase();
  const limit = Math.min(Number(req.query.limit || 8) || 8, 20);
  const timespan = (req.query.timespan || "1week").toString();

  const gdeltQuery = `${query} sourcecountry:${country}`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(gdeltQuery)}&mode=artlist&maxrecords=${limit}&format=json&timespan=${encodeURIComponent(timespan)}`;

  try {
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data || {};
    const articles = Array.isArray(data.articles) ? data.articles : [];
    res.json({ articles });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load news" });
  }
});

app.post("/api/simulate", requireAuth, async (req, res) => {
  db.get("SELECT * FROM users WHERE id = ?", [req.user.id], (err, user) => {
    const data = req.body;
    const baseYield = data.base_yield || 2.5;
    const area = data.area || 1;
    let yieldMod = 1.0;

    // Environmental impacts
    if (data.rainfall < 15) yieldMod -= 0.2;
    if (data.water_availability === "low") yieldMod -= 0.15;
    if (data.pest_pressure === "high") yieldMod -= 0.25;
    if (data.fertilizer_strategy === "intensive") yieldMod += 0.15;

    // Soil-crop fit logic
    if (user && user.soil_type) {
      const soil = user.soil_type.toLowerCase();
      const crop = (data.crop || "").toLowerCase();
      if (soil.includes("clay") && crop.includes("rice")) yieldMod += 0.1;
      if (soil.includes("sandy") && crop.includes("wheat")) yieldMod -= 0.05;
    }

    // NPK balance impact
    const npk = data.soil || {};
    const n = Number(npk.n || 0);
    const p = Number(npk.p || 0);
    const k = Number(npk.k || 0);
    const npkScore =
      n >= 40 && n <= 100 && p >= 15 && p <= 60 && k >= 20 && k <= 80
        ? 0.08
        : -0.06;
    yieldMod += npkScore;

    const total_yield = baseYield * area * yieldMod;
    const total_revenue = total_yield * (data.market_price || 200);
    const total_profit = total_revenue * 0.7;
    const water_stress_percent =
      data.water_availability === "low"
        ? 70
        : data.water_availability === "medium"
          ? 40
          : 15;
    const risk_level =
      yieldMod < 0.7 ? "High" : yieldMod < 0.9 ? "Medium" : "Low";

    const ai_insights = [
      `Analysis for ${user?.full_name || "Farmer"}: Current scenario for ${data.crop || "Crop"} on ${user?.soil_type || "unspecified soil"}.`,
      risk_level === "High"
        ? "[CRITICAL] Potential crop failure detected due to severe stress factors."
        : "Yield outlook remains stable with current parameters.",
      data.rainfall < 20
        ? "[WARNING] Low rainfall detected; your ${user?.irrigation_src || 'current irrigation'} should be prioritized."
        : "Water levels are favorable for growth.",
      user && user.experience_yrs > 20
        ? "Note: Your extensive experience will be vital in managing this cycle's variability."
        : "Pro-tip: Watch for early signs of chlorosis under current nutrient strategy.",
    ];

    res.json({
      total_yield,
      total_revenue,
      total_profit,
      water_stress_percent,
      risk_level,
      ai_insights,
      soil_health_prediction:
        yieldMod > 1 ? "Improving due to inputs." : "Degrading slightly.",
    });
  });
});

// ─── COMMUNITY ENDPOINTS ───────────────────────────────────────────────────

app.get("/api/community/posts", requireAuth, (req, res) => {
  const query = `
        SELECT 
            p.*, 
            u.full_name, u.primary_crop, u.district,
            (SELECT COUNT(*) FROM post_seeds WHERE post_id = p.id) as like_count,
            (SELECT COUNT(*) FROM comment_roots WHERE post_id = p.id) as comment_count,
            (SELECT COUNT(*) FROM post_seeds WHERE post_id = p.id AND user_id = ?) as has_liked
        FROM posts p 
        JOIN main_db.users u ON p.user_id = u.id 
        ORDER BY p.created_at DESC
    `;
  sdb.all(query, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post("/api/community/posts", requireAuth, (req, res) => {
  const { content, category, mood, image_url, media_urls } = req.body;
  if (!content) return res.status(400).json({ error: "Content is required." });
  const normalizedMedia = Array.isArray(media_urls)
    ? media_urls.filter(Boolean).slice(0, 6)
    : image_url
      ? [image_url]
      : [];

  sdb.run(
    `INSERT INTO posts (user_id, content, category, mood, is_private, image_url) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      content,
      category || "general",
      mood || "neutral",
      0,
      normalizedMedia.length ? JSON.stringify(normalizedMedia) : null,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, success: true });
    },
  );
});

app.post("/api/community/posts/:id/like", requireAuth, (req, res) => {
  const pid = req.params.id;
  const uid = req.user.id;
  sdb.get(
    "SELECT * FROM post_seeds WHERE user_id = ? AND post_id = ?",
    [uid, pid],
    (err, row) => {
      if (row) {
        sdb.run(
          "DELETE FROM post_seeds WHERE user_id = ? AND post_id = ?",
          [uid, pid],
          () => res.json({ liked: false }),
        );
      } else {
        sdb.run(
          "INSERT INTO post_seeds (user_id, post_id) VALUES (?, ?)",
          [uid, pid],
          () => res.json({ liked: true }),
        );
      }
    },
  );
});

// Backward compatible support toggle
app.post("/api/community/posts/:id/seed", requireAuth, (req, res) => {
  const pid = req.params.id;
  const uid = req.user.id;
  sdb.get(
    "SELECT * FROM post_seeds WHERE user_id = ? AND post_id = ?",
    [uid, pid],
    (err, row) => {
      if (row) {
        sdb.run(
          "DELETE FROM post_seeds WHERE user_id = ? AND post_id = ?",
          [uid, pid],
          () => res.json({ liked: false }),
        );
      } else {
        sdb.run(
          "INSERT INTO post_seeds (user_id, post_id) VALUES (?, ?)",
          [uid, pid],
          () => res.json({ liked: true }),
        );
      }
    },
  );
});

app.get("/api/community/posts/:id/comments", requireAuth, (req, res) => {
  const pid = req.params.id;
  const query = `
        SELECT c.*, u.full_name 
        FROM comment_roots c 
        JOIN main_db.users u ON c.user_id = u.id 
        WHERE c.post_id = ? 
        ORDER BY c.created_at ASC
    `;
  sdb.all(query, [pid], (err, rows) => res.json(rows || []));
});

app.post("/api/community/posts/:id/comments", requireAuth, (req, res) => {
  const pid = req.params.id;
  const { content } = req.body;
  sdb.run(
    "INSERT INTO comment_roots (post_id, user_id, content) VALUES (?, ?, ?)",
    [pid, req.user.id, content],
    function (err) {
      res.json({ id: this.lastID, success: true });
    },
  );
});

app.put("/api/community/posts/:id", requireAuth, (req, res) => {
  const pid = req.params.id;
  const uid = req.user.id;
  const { content, category, image_url, media_urls } = req.body;
  if (!content || !content.trim())
    return res.status(400).json({ error: "Content is required." });

  const normalizedMedia = Array.isArray(media_urls)
    ? media_urls.filter(Boolean).slice(0, 6)
    : image_url
      ? [image_url]
      : [];

  sdb.run(
    `UPDATE posts SET content = ?, category = ?, is_private = ?, image_url = ? WHERE id = ? AND user_id = ?`,
    [
      content.trim(),
      category || "general",
      0,
      normalizedMedia.length ? JSON.stringify(normalizedMedia) : null,
      pid,
      uid,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(403).json({ error: "Not authorized or not found" });
      res.json({ success: true });
    },
  );
});

app.get("/api/community/stats", requireAuth, (req, res) => {
  sdb.get(
    "SELECT COUNT(*) as posts FROM posts WHERE user_id = ?",
    [req.user.id],
    (err, r1) => {
      sdb.get(
        "SELECT COUNT(*) as likes FROM post_seeds ps JOIN posts p ON ps.post_id = p.id WHERE p.user_id = ?",
        [req.user.id],
        (err, r2) => {
          res.json({ posts: r1?.posts || 0, likes_earned: r2?.likes || 0 });
        },
      );
    },
  );
});

// ─── COMMUNITY: USERS + FOLLOWS + DMS ───────────────────────────────────────

app.get("/api/community/users", requireAuth, (req, res) => {
  const q = (req.query.q || req.query.query || "").toString().trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit || 20) || 20, 50);
  if (!q) return res.json([]);
  const like = `%${q}%`;
  db.all(
    `SELECT id, full_name, email, district, primary_crop 
     FROM users 
     WHERE id != ? AND (LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)
     ORDER BY full_name
     LIMIT ?`,
    [req.user.id, like, like, limit],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    },
  );
});

app.get("/api/community/followers", requireAuth, (req, res) => {
  const query = `
        SELECT f.follower_id as id, u.full_name, u.primary_crop, u.district, f.created_at
        FROM follows f
        JOIN main_db.users u ON f.follower_id = u.id
        WHERE f.following_id = ?
        ORDER BY f.created_at DESC
    `;
  sdb.all(query, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get("/api/community/following", requireAuth, (req, res) => {
  const query = `
        SELECT f.following_id as id, u.full_name, u.primary_crop, u.district, f.created_at
        FROM follows f
        JOIN main_db.users u ON f.following_id = u.id
        WHERE f.follower_id = ?
        ORDER BY f.created_at DESC
    `;
  sdb.all(query, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post("/api/community/follow-requests", requireAuth, (req, res) => {
  const targetId = Number(req.body?.target_user_id);
  if (!targetId || targetId === req.user.id) {
    return res.status(400).json({ error: "Invalid target user." });
  }
  db.get("SELECT id FROM users WHERE id = ?", [targetId], (err, userRow) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!userRow) return res.status(404).json({ error: "User not found." });

    sdb.get(
      "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?",
      [req.user.id, targetId],
      (followErr, followRow) => {
        if (followErr)
          return res.status(500).json({ error: followErr.message });
        if (followRow) return res.json({ status: "following" });

        sdb.get(
          "SELECT id, status FROM follow_requests WHERE requester_id = ? AND target_id = ? AND status = 'pending'",
          [req.user.id, targetId],
          (reqErr, reqRow) => {
            if (reqErr)
              return res.status(500).json({ error: reqErr.message });
            if (reqRow) return res.json({ status: "pending" });

            sdb.run(
              "INSERT INTO follow_requests (requester_id, target_id, status) VALUES (?, ?, 'pending')",
              [req.user.id, targetId],
              function (insErr) {
                if (insErr)
                  return res.status(500).json({ error: insErr.message });
                res.json({ status: "pending", request_id: this.lastID });
              },
            );
          },
        );
      },
    );
  });
});

app.get("/api/community/follow-requests", requireAuth, (req, res) => {
  const incomingQuery = `
        SELECT fr.id, fr.requester_id as user_id, fr.created_at, u.full_name, u.primary_crop, u.district
        FROM follow_requests fr
        JOIN main_db.users u ON fr.requester_id = u.id
        WHERE fr.target_id = ? AND fr.status = 'pending'
        ORDER BY fr.created_at DESC
    `;
  const outgoingQuery = `
        SELECT fr.id, fr.target_id as user_id, fr.created_at, u.full_name, u.primary_crop, u.district
        FROM follow_requests fr
        JOIN main_db.users u ON fr.target_id = u.id
        WHERE fr.requester_id = ? AND fr.status = 'pending'
        ORDER BY fr.created_at DESC
    `;

  sdb.all(incomingQuery, [req.user.id], (err, incoming) => {
    if (err) return res.status(500).json({ error: err.message });
    sdb.all(outgoingQuery, [req.user.id], (outErr, outgoing) => {
      if (outErr) return res.status(500).json({ error: outErr.message });
      res.json({ incoming: incoming || [], outgoing: outgoing || [] });
    });
  });
});

app.post("/api/community/follow-requests/:id/accept", requireAuth, (req, res) => {
  const requestId = Number(req.params.id);
  sdb.get(
    "SELECT * FROM follow_requests WHERE id = ? AND target_id = ? AND status = 'pending'",
    [requestId, req.user.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Request not found." });

      sdb.run(
        "UPDATE follow_requests SET status = 'accepted' WHERE id = ?",
        [requestId],
        (upErr) => {
          if (upErr) return res.status(500).json({ error: upErr.message });
          sdb.run(
            "INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)",
            [row.requester_id, row.target_id],
            (insErr) => {
              if (insErr) return res.status(500).json({ error: insErr.message });
              res.json({ success: true });
            },
          );
        },
      );
    },
  );
});

app.post("/api/community/follow-requests/:id/reject", requireAuth, (req, res) => {
  const requestId = Number(req.params.id);
  sdb.run(
    "UPDATE follow_requests SET status = 'rejected' WHERE id = ? AND target_id = ? AND status = 'pending'",
    [requestId, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Request not found." });
      res.json({ success: true });
    },
  );
});

app.delete("/api/community/follow-requests/:id", requireAuth, (req, res) => {
  const requestId = Number(req.params.id);
  sdb.run(
    "DELETE FROM follow_requests WHERE id = ? AND requester_id = ? AND status = 'pending'",
    [requestId, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Request not found." });
      res.json({ success: true });
    },
  );
});

app.delete("/api/community/follow/:id", requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  sdb.run(
    "DELETE FROM follows WHERE follower_id = ? AND following_id = ?",
    [req.user.id, targetId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    },
  );
});

app.get("/api/community/dms", requireAuth, (req, res) => {
  const uid = req.user.id;
  const query = `
        SELECT t.other_id, u.full_name, u.primary_crop, u.district, t.last_at,
            (SELECT content FROM messages m2 
                WHERE ((m2.sender_id = ? AND m2.receiver_id = t.other_id) OR (m2.sender_id = t.other_id AND m2.receiver_id = ?))
                ORDER BY m2.created_at DESC LIMIT 1) AS last_message
        FROM (
            SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_id,
                   MAX(created_at) as last_at
            FROM messages
            WHERE sender_id = ? OR receiver_id = ?
            GROUP BY other_id
        ) t
        JOIN main_db.users u ON u.id = t.other_id
        ORDER BY t.last_at DESC
    `;
  sdb.all(query, [uid, uid, uid, uid, uid], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get("/api/community/dms/:userId", requireAuth, (req, res) => {
  const uid = req.user.id;
  const otherId = Number(req.params.userId);
  const query = `
        SELECT id, sender_id, receiver_id, content, created_at
        FROM messages
        WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
        ORDER BY created_at ASC
    `;
  sdb.all(query, [uid, otherId, otherId, uid], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post("/api/community/dms", requireAuth, (req, res) => {
  const toUserId = Number(req.body?.to_user_id);
  const content = String(req.body?.content || "").trim();
  if (!toUserId || !content) {
    return res.status(400).json({ error: "Recipient and content required." });
  }
  if (toUserId === req.user.id) {
    return res.status(400).json({ error: "Cannot message yourself." });
  }
  sdb.run(
    "INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)",
    [req.user.id, toUserId, content],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, success: true });
    },
  );
});

app.get("/api/crops-library", (req, res) => {
  const cropsPath = path.join(BASE_DIR, "database", "crops.json");
  fs.readFile(cropsPath, "utf8", (err, data) => {
    if (err)
      return res.status(500).json({ error: "Failed to read crops library" });
    res.json(JSON.parse(data));
  });
});

app.get("/api/mandi-prices", requireAuth, (req, res) => {
  const query = (req.query.q || "").toString().toLowerCase();
  const items = [
    {
      crop: "Wheat",
      market: "Azadpur",
      state: "Delhi",
      price_per_quintal: 2450,
      change: "+2.1%",
    },
    {
      crop: "Rice (Paddy)",
      market: "Navi Mumbai",
      state: "Maharashtra",
      price_per_quintal: 2250,
      change: "-0.8%",
    },
    {
      crop: "Tomato",
      market: "Kolar",
      state: "Karnataka",
      price_per_quintal: 1800,
      change: "+4.5%",
    },
    {
      crop: "Onion",
      market: "Lasalgaon",
      state: "Maharashtra",
      price_per_quintal: 1550,
      change: "+1.3%",
    },
    {
      crop: "Potato",
      market: "Agra",
      state: "Uttar Pradesh",
      price_per_quintal: 1350,
      change: "-1.2%",
    },
    {
      crop: "Cotton",
      market: "Nagpur",
      state: "Maharashtra",
      price_per_quintal: 6600,
      change: "+0.6%",
    },
    {
      crop: "Soybean",
      market: "Indore",
      state: "Madhya Pradesh",
      price_per_quintal: 4400,
      change: "+0.9%",
    },
    {
      crop: "Maize",
      market: "Davangere",
      state: "Karnataka",
      price_per_quintal: 2100,
      change: "+1.0%",
    },
  ];

  const filtered = query
    ? items.filter(
        (item) =>
          item.crop.toLowerCase().includes(query) ||
          item.market.toLowerCase().includes(query) ||
          item.state.toLowerCase().includes(query),
      )
    : items;

  res.json({
    updated_at: new Date().toISOString(),
    items: filtered,
  });
});

app.delete("/api/community/posts/:id", requireAuth, (req, res) => {
  const pid = req.params.id;
  const uid = req.user.id;
  sdb.run(
    "DELETE FROM posts WHERE id = ? AND user_id = ?",
    [pid, uid],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(403).json({ error: "Not authorized or not found" });
      res.json({ success: true });
    },
  );
});

// Copilot entrypoint
app.get("/copilot", (req, res) => {
  res.sendFile(path.join(BASE_DIR, "sites", "copilot.html"));
});

// Redirect root
app.get("/", (req, res) => res.redirect("/sites/login.html"));

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      const family = typeof iface.family === "string" ? iface.family : String(iface.family);
      if (family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

const server = app.listen(PORT, HOST, () => {
  const localIPs = getLocalIPs();
  console.log(`\n🚀 FarmMind Backend is live!`);
  console.log(`🏠 Local:   http://localhost:${PORT}`);
  if (HOST === "0.0.0.0" || HOST === "::") {
    if (localIPs.length) {
      localIPs.forEach((ip) => {
        console.log(`🌐 Network: http://${ip}:${PORT}`);
      });
    } else {
      console.log(`🌐 Network: No LAN IPv4 detected on this machine`);
    }
  } else {
    console.log(`🌐 Bound Host: http://${HOST}:${PORT}`);
  }
  console.log("");
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set a different PORT in servers/.env.`);
    return;
  }
  console.error("Server startup error:", err);
});
