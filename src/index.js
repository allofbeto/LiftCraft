const SESSION_DAYS = 14;
const PBKDF2_ITERATIONS = 100000; // Workers caps PBKDF2 at 100k

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) =>
  new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toHex(bits);
}

async function sha256(text) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function createSession(env, userId, url) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, expires)
    .run();
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

function getCookie(request, name) {
  const match = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function currentUser(request, env) {
  const token = getCookie(request, "session");
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.email, u.first_name AS firstName, u.last_name AS lastName
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), Date.now())
    .first();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A tiny blocklist of the most-guessed passwords (NIST SP 800-63B: screen against
// commonly used values). A production app would check a larger corpus / HIBP range API.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "11111111", "iloveyou", "admin123", "welcome1",
  "letmein1", "football", "baseball", "sunshine", "princess", "monkey123", "abc12345",
]);

// Collapse internal whitespace and strip control characters from a display name.
const normalizeName = (v) => String(v || "").replace(/\s+/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim();

async function signup(request, env, url) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const firstName = normalizeName(body.firstName);
  const lastName = normalizeName(body.lastName);
  const password = String(body.password || "");

  if (!firstName || !lastName) return json({ error: "First and last name are required." }, 400);
  if (firstName.length > 60 || lastName.length > 60) return json({ error: "Name is too long." }, 400);
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
  if (password.length > 200) return json({ error: "Password is too long." }, 400);
  if (COMMON_PASSWORDS.has(password.toLowerCase()))
    return json({ error: "That password is too common. Please choose a stronger one." }, 400);
  if (password.toLowerCase() === email || password.toLowerCase() === email.split("@")[0])
    return json({ error: "Your password can't be your email address." }, 400);

  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt);

  let result;
  try {
    result = await env.DB.prepare(
      "INSERT INTO users (email, first_name, last_name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(email, firstName, lastName, hash, salt)
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) return json({ error: "An account with that email already exists." }, 409);
    throw e;
  }

  const cookie = await createSession(env, result.meta.last_row_id, url);
  return json({ user: { email, firstName, lastName } }, 201, { "set-cookie": cookie });
}

async function login(request, env, url) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  // Hash even when the user is missing so response time doesn't reveal which emails exist.
  const hash = await hashPassword(password, row ? row.password_salt : "00".repeat(16));
  if (!row || !timingSafeEqual(hash, row.password_hash)) {
    return json({ error: "Incorrect email or password." }, 401);
  }

  const cookie = await createSession(env, row.id, url);
  return json(
    { user: { email: row.email, firstName: row.first_name, lastName: row.last_name } },
    200,
    { "set-cookie": cookie },
  );
}

async function logout(request, env) {
  const token = getCookie(request, "session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": "session=; HttpOnly; Path=/; Max-Age=0" });
}

const cleanName = (v) => String(v ?? "").trim().slice(0, 80);
const UNITS = ["lb", "kg"];
// Fixed label palette (kept in sync with PALETTE in public/app.js).
const COLORS = new Set([
  "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#94a3b8",
]);

async function ownedFolder(env, userId, folderId) {
  if (folderId == null) return null;
  const f = await env.DB.prepare("SELECT id FROM folders WHERE id = ? AND user_id = ?").bind(folderId, userId).first();
  return f ? f.id : undefined; // undefined = not found / not yours
}

const entryRow = (e) => ({ id: e.id, reps: e.reps, weight: e.weight, unit: e.unit, loggedAt: e.logged_at });

function parseEntry(body) {
  const reps = Number(body.reps);
  const weight = body.weight === "" || body.weight == null ? null : Number(body.weight);
  const when = body.loggedAt ? new Date(body.loggedAt) : new Date();
  if (!Number.isInteger(reps) || reps < 0 || reps > 10000) return { error: "Enter the number of reps." };
  if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 100000)) return { error: "Enter a valid weight." };
  if (!UNITS.includes(body.unit)) return { error: "Choose a unit." };
  if (Number.isNaN(when.getTime())) return { error: "Enter a valid date and time." };
  return { reps, weight, unit: body.unit, loggedAt: when.toISOString() };
}

async function handleData(request, env, url, user) {
  const [, resource, rawId, sub, arg] = url.pathname.split("/").filter(Boolean); // api/<resource>/<id>/<sub>
  const id = rawId ? Number(rawId) : null;
  if (rawId && !Number.isInteger(id)) return json({ error: "Not found." }, 404);
  const method = request.method;
  const body = ["POST", "PUT"].includes(method) ? await request.json().catch(() => ({})) : {};
  const ownsExercise = (exId) =>
    env.DB.prepare("SELECT id FROM exercises WHERE id = ? AND user_id = ?").bind(exId, user.id).first();

  if (resource === "library" && method === "GET") {
    const [f, x] = await Promise.all([
      env.DB.prepare("SELECT id, name, parent_id AS parentId, color FROM folders WHERE user_id = ? ORDER BY position, name COLLATE NOCASE").bind(user.id).all(),
      env.DB.prepare(
        `SELECT x.id, x.name, x.folder_id AS folderId, x.color,
                (SELECT COUNT(*) FROM day_notes n WHERE n.exercise_id = x.id AND trim(n.note) <> '') AS dayCount,
                (SELECT MAX(day) FROM day_notes n WHERE n.exercise_id = x.id AND trim(n.note) <> '') AS lastDay
         FROM exercises x WHERE x.user_id = ? ORDER BY x.position, x.name COLLATE NOCASE`,
      ).bind(user.id).all(),
    ]);
    return json({ folders: f.results, exercises: x.results });
  }

  if (resource === "progress" && method === "GET") {
    const [days, ex] = await Promise.all([
      env.DB.prepare(
        "SELECT DISTINCT day FROM day_notes WHERE user_id = ? AND trim(note) <> '' ORDER BY day DESC",
      ).bind(user.id).all(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM exercises WHERE user_id = ?").bind(user.id).first(),
    ]);
    return json({ days: days.results.map((r) => r.day), exerciseCount: ex.c });
  }

  if (resource === "reorder" && method === "POST") {
    const table = body.type === "folders" ? "folders" : body.type === "exercises" ? "exercises" : null;
    if (!table) return json({ error: "Bad request." }, 400);
    const order = Array.isArray(body.order) ? body.order.filter((v) => Number.isInteger(v)) : [];
    if (order.length) {
      // Fixed table name (whitelisted above), so no injection. Scoped to this user's rows.
      await env.DB.batch(
        order.map((rowId, i) =>
          env.DB.prepare(`UPDATE ${table} SET position = ? WHERE id = ? AND user_id = ?`).bind(i, rowId, user.id),
        ),
      );
    }
    return json({ ok: true });
  }

  if (resource === "color" && method === "POST") {
    const table = body.type === "folders" ? "folders" : body.type === "exercises" ? "exercises" : null;
    const rowId = Number(body.id);
    const color = String(body.color || "");
    if (!table || !Number.isInteger(rowId)) return json({ error: "Bad request." }, 400);
    if (color !== "" && !COLORS.has(color)) return json({ error: "Unknown color." }, 400);
    await env.DB.prepare(`UPDATE ${table} SET color = ? WHERE id = ? AND user_id = ?`).bind(color, rowId, user.id).run();
    return json({ ok: true });
  }

  if (resource === "move" && method === "POST") {
    const table = body.type === "folders" ? "folders" : body.type === "exercises" ? "exercises" : null;
    const rowId = Number(body.id);
    if (!table || !Number.isInteger(rowId)) return json({ error: "Bad request." }, 400);
    const dest = await ownedFolder(env, user.id, body.dest ?? null); // null ok, undefined = not found
    if (dest === undefined) return json({ error: "Folder not found." }, 404);
    const col = table === "folders" ? "parent_id" : "folder_id";

    if (table === "folders") {
      if (dest === rowId) return json({ error: "Can't move a folder into itself." }, 400);
      if (dest !== null) {
        // Reject moving a folder into one of its own descendants (would make a cycle).
        const all = (await env.DB.prepare("SELECT id, parent_id AS parentId FROM folders WHERE user_id = ?").bind(user.id).all()).results;
        const pm = Object.fromEntries(all.map((f) => [f.id, f.parentId]));
        for (let p = dest; p != null; p = pm[p]) {
          if (p === rowId) return json({ error: "Can't move a folder inside itself." }, 400);
        }
      }
    }
    const pos = (await env.DB.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ${table} WHERE user_id = ?`).bind(user.id).first()).p;
    await env.DB.prepare(`UPDATE ${table} SET ${col} = ?, position = ? WHERE id = ? AND user_id = ?`).bind(dest, pos, rowId, user.id).run();
    return json({ ok: true });
  }

  if (resource === "folders") {
    if (method === "POST" && !id) {
      const name = cleanName(body.name);
      if (!name) return json({ error: "Name is required." }, 400);
      const parentId = await ownedFolder(env, user.id, body.parentId ?? null);
      if (parentId === undefined) return json({ error: "Folder not found." }, 404);
      const pos = (await env.DB.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM folders WHERE user_id = ?").bind(user.id).first()).p;
      const r = await env.DB.prepare("INSERT INTO folders (user_id, name, parent_id, position) VALUES (?, ?, ?, ?)")
        .bind(user.id, name, parentId, pos)
        .run();
      return json({ folder: { id: r.meta.last_row_id, name, parentId } }, 201);
    }
    if (method === "PUT" && id) {
      const name = cleanName(body.name);
      if (!name) return json({ error: "Name is required." }, 400);
      await env.DB.prepare("UPDATE folders SET name = ? WHERE id = ? AND user_id = ?").bind(name, id, user.id).run();
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      // Keep everything: subfolders and exercises move up to this folder's parent.
      const f = await env.DB.prepare("SELECT parent_id AS parentId FROM folders WHERE id = ? AND user_id = ?")
        .bind(id, user.id)
        .first();
      if (!f) return json({ ok: true });
      await env.DB.batch([
        env.DB.prepare("UPDATE exercises SET folder_id = ? WHERE folder_id = ? AND user_id = ?").bind(f.parentId, id, user.id),
        env.DB.prepare("UPDATE folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?").bind(f.parentId, id, user.id),
        env.DB.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").bind(id, user.id),
      ]);
      return json({ ok: true });
    }
  }

  if (resource === "exercises") {
    if (method === "POST" && !id) {
      const name = cleanName(body.name);
      if (!name) return json({ error: "Name is required." }, 400);
      const folderId = await ownedFolder(env, user.id, body.folderId ?? null);
      if (folderId === undefined) return json({ error: "Folder not found." }, 404);
      const pos = (await env.DB.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM exercises WHERE user_id = ?").bind(user.id).first()).p;
      const r = await env.DB.prepare("INSERT INTO exercises (user_id, folder_id, name, position) VALUES (?, ?, ?, ?)")
        .bind(user.id, folderId, name, pos).run();
      return json({ exercise: { id: r.meta.last_row_id, name, folderId, dayCount: 0, lastDay: null } }, 201);
    }
    if (method === "GET" && id && !sub) {
      const x = await env.DB.prepare(
        "SELECT id, name, folder_id AS folderId, equipment, muscle, split FROM exercises WHERE id = ? AND user_id = ?",
      ).bind(id, user.id).first();
      if (!x) return json({ error: "Not found." }, 404);
      x.split = x.split === 1; // expose as a boolean
      const [e, n] = await Promise.all([
        env.DB.prepare("SELECT * FROM entries WHERE exercise_id = ? ORDER BY logged_at DESC, id DESC").bind(id).all(),
        env.DB.prepare("SELECT day, note FROM day_notes WHERE exercise_id = ?").bind(id).all(),
      ]);
      const notes = Object.fromEntries(n.results.map((r) => [r.day, r.note]));
      return json({ exercise: x, entries: e.results.map(entryRow), notes });
    }
    if (method === "PUT" && id && !sub) {
      const name = cleanName(body.name);
      if (!name) return json({ error: "Name is required." }, 400);
      const folderId = await ownedFolder(env, user.id, body.folderId ?? null);
      if (folderId === undefined) return json({ error: "Folder not found." }, 404);
      await env.DB.prepare(
        "UPDATE exercises SET name = ?, folder_id = ?, equipment = ?, muscle = ?, split = ? WHERE id = ? AND user_id = ?",
      ).bind(name, folderId, cleanName(body.equipment), cleanName(body.muscle), body.split ? 1 : 0, id, user.id).run();
      return json({ ok: true });
    }
    if (method === "DELETE" && id && !sub) {
      await env.DB.prepare("DELETE FROM exercises WHERE id = ? AND user_id = ?").bind(id, user.id).run();
      return json({ ok: true });
    }
    if (method === "PUT" && id && sub === "notes" && /^\d{4}-\d{2}-\d{2}$/.test(arg || "")) {
      if (!(await ownsExercise(id))) return json({ error: "Not found." }, 404);
      const note = String(body.note ?? "").slice(0, 5000);
      if (note.trim()) {
        await env.DB.prepare(
          `INSERT INTO day_notes (exercise_id, user_id, day, note) VALUES (?, ?, ?, ?)
           ON CONFLICT (exercise_id, day) DO UPDATE SET note = excluded.note`,
        ).bind(id, user.id, arg, note).run();
      } else {
        await env.DB.prepare("DELETE FROM day_notes WHERE exercise_id = ? AND day = ?").bind(id, arg).run();
      }
      return json({ ok: true });
    }
    if (method === "POST" && id && sub === "entries") {
      if (!(await ownsExercise(id))) return json({ error: "Not found." }, 404);
      const v = parseEntry(body);
      if (v.error) return json({ error: v.error }, 400);
      const r = await env.DB.prepare(
        "INSERT INTO entries (exercise_id, user_id, reps, weight, unit, logged_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(id, user.id, v.reps, v.weight, v.unit, v.loggedAt).run();
      return json({ entry: { id: r.meta.last_row_id, reps: v.reps, weight: v.weight, unit: v.unit, loggedAt: v.loggedAt } }, 201);
    }
  }

  if (resource === "entries" && id) {
    if (method === "PUT") {
      const v = parseEntry(body);
      if (v.error) return json({ error: v.error }, 400);
      await env.DB.prepare("UPDATE entries SET reps = ?, weight = ?, unit = ?, logged_at = ? WHERE id = ? AND user_id = ?")
        .bind(v.reps, v.weight, v.unit, v.loggedAt, id, user.id).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM entries WHERE id = ? AND user_id = ?").bind(id, user.id).run();
      return json({ ok: true });
    }
  }

  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    try {
      switch (route) {
        case "POST /api/signup":
          return await signup(request, env, url);
        case "POST /api/login":
          return await login(request, env, url);
        case "POST /api/logout":
          return await logout(request, env);
        case "GET /api/me": {
          const user = await currentUser(request, env);
          return user ? json({ user }) : json({ error: "Not signed in." }, 401);
        }
      }
      if (/^\/api\/(library|progress|reorder|color|move|folders|exercises|entries)(\/|$)/.test(url.pathname)) {
        const user = await currentUser(request, env);
        if (!user) return json({ error: "Not signed in." }, 401);
        return await handleData(request, env, url, user);
      }
    } catch (e) {
      console.error(e);
      return json({ error: "Something went wrong." }, 500);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
