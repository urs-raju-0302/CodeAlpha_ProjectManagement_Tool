const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "codealpha-project-secret-change-in-production";

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "project_management.db"));
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  owner_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done')),
  assignee_id INTEGER,
  created_by INTEGER NOT NULL,
  due_date TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const statements = {
  userById: db.prepare("SELECT id, name, username FROM users WHERE id = ?"),
  userByUsername: db.prepare("SELECT id, name, username, password_hash FROM users WHERE username = ?"),
  searchUsers: db.prepare("SELECT id, name, username FROM users WHERE username LIKE ? OR name LIKE ? ORDER BY username LIMIT 20"),
  projectById: db.prepare(`
    SELECT p.*, u.name AS owner_name, u.username AS owner_username
    FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = ?`),
  projectMember: db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?"),
  addMember: db.prepare("INSERT OR IGNORE INTO project_members(project_id, user_id) VALUES (?, ?)"),
  members: db.prepare(`
    SELECT u.id, u.name, u.username
    FROM project_members pm JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ? ORDER BY u.name`),
  tasks: db.prepare(`
    SELECT t.*, u.name AS assignee_name, u.username AS assignee_username,
           c.name AS creator_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    JOIN users c ON c.id = t.created_by
    WHERE t.project_id = ? ORDER BY t.created_at DESC`),
  taskById: db.prepare("SELECT * FROM tasks WHERE id = ?"),
  comments: db.prepare(`
    SELECT c.id, c.body, c.created_at, u.name, u.username
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ? ORDER BY c.created_at ASC`)
};

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Authentication required." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired session." });
  }
}

function isMember(projectId, userId) {
  return !!statements.projectMember.get(projectId, userId);
}

function requireProjectMember(req, res, next) {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || !isMember(projectId, req.user.id)) {
    return res.status(403).json({ message: "You are not a member of this project." });
  }
  req.projectId = projectId;
  next();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, username, password } = req.body;
    if (!name?.trim() || !username?.trim() || !password || password.length < 6) {
      return res.status(400).json({ message: "Name, username and a password of at least 6 characters are required." });
    }
    const cleanUsername = username.trim().toLowerCase();
    if (statements.userByUsername.get(cleanUsername)) {
      return res.status(409).json({ message: "Username already exists." });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare("INSERT INTO users(name, username, password_hash) VALUES (?, ?, ?)").run(name.trim(), cleanUsername, hash);
    const user = { id: Number(result.lastInsertRowid), name: name.trim(), username: cleanUsername };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ message: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const user = statements.userByUsername.get(String(username || "").trim().toLowerCase());
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).json({ message: "Invalid username or password." });
  }
  const safeUser = { id: user.id, name: user.name, username: user.username };
  const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: safeUser });
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = statements.userById.get(req.user.id);
  res.json({ user });
});

app.get("/api/users", auth, (req, res) => {
  const q = `%${String(req.query.q || "").trim()}%`;
  res.json({ users: statements.searchUsers.all(q, q).filter(u => u.id !== req.user.id) });
});

app.get("/api/projects", auth, (req, res) => {
  const projects = db.prepare(`
    SELECT p.id, p.name, p.description, p.owner_id, p.created_at, u.name AS owner_name,
           (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
    FROM projects p
    JOIN project_members me ON me.project_id = p.id AND me.user_id = ?
    JOIN users u ON u.id = p.owner_id
    ORDER BY p.created_at DESC
  `).all(req.user.id);
  res.json({ projects });
});

app.post("/api/projects", auth, (req, res) => {
  const { name, description = "" } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "Project name is required." });
  db.exec("BEGIN");
  try {
    const result = db.prepare("INSERT INTO projects(name, description, owner_id) VALUES (?, ?, ?)")
      .run(name.trim(), String(description).trim(), req.user.id);
    const projectId = Number(result.lastInsertRowid);
    statements.addMember.run(projectId, req.user.id);
    db.exec("COMMIT");
    res.status(201).json({ message: "Project created.", projectId });
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ message: "Could not create project." });
  }
});

app.get("/api/projects/:id", auth, requireProjectMember, (req, res) => {
  const project = statements.projectById.get(req.projectId);
  const members = statements.members.all(req.projectId);
  const tasks = statements.tasks.all(req.projectId);
  res.json({ project, members, tasks });
});

app.post("/api/projects/:id/members", auth, requireProjectMember, (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const user = statements.userByUsername.get(username);
  if (!user) return res.status(404).json({ message: "User not found." });
  try {
    statements.addMember.run(req.projectId, user.id);
    res.json({ message: `${user.username} added to the project.` });
  } catch {
    res.status(500).json({ message: "Could not add member." });
  }
});

app.post("/api/projects/:id/tasks", auth, requireProjectMember, (req, res) => {
  const { title, description = "", assigneeId = null, dueDate = "" } = req.body;
  if (!title?.trim()) return res.status(400).json({ message: "Task title is required." });
  const assignee = assigneeId ? Number(assigneeId) : null;
  if (assignee && !isMember(req.projectId, assignee)) {
    return res.status(400).json({ message: "Assignee must be a project member." });
  }
  const result = db.prepare(`
    INSERT INTO tasks(project_id, title, description, assignee_id, created_by, due_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.projectId, title.trim(), String(description).trim(), assignee, req.user.id, String(dueDate || ""));
  res.status(201).json({ message: "Task created.", taskId: Number(result.lastInsertRowid) });
});

app.patch("/api/tasks/:id", auth, async (req, res) => {
  const taskId = Number(req.params.id);
  const task = statements.taskById.get(taskId);
  if (!task || !isMember(task.project_id, req.user.id)) return res.status(404).json({ message: "Task not found." });

  const status = req.body.status;
  const assigneeId = req.body.assigneeId === null || req.body.assigneeId === "" ? null :
    Number(req.body.assigneeId);

  if (status && !["todo", "in_progress", "done"].includes(status)) {
    return res.status(400).json({ message: "Invalid status." });
  }
  if (assigneeId && !isMember(task.project_id, assigneeId)) {
    return res.status(400).json({ message: "Assignee must be a project member." });
  }

  db.prepare(`
    UPDATE tasks
    SET status = COALESCE(?, status),
        assignee_id = ?,
        description = COALESCE(?, description),
        due_date = COALESCE(?, due_date)
    WHERE id = ?
  `).run(status || null, assigneeId, req.body.description ?? null, req.body.dueDate ?? null, taskId);

  res.json({ message: "Task updated." });
});

app.get("/api/tasks/:id/comments", auth, (req, res) => {
  const task = statements.taskById.get(Number(req.params.id));
  if (!task || !isMember(task.project_id, req.user.id)) return res.status(404).json({ message: "Task not found." });
  res.json({ comments: statements.comments.all(task.id) });
});

app.post("/api/tasks/:id/comments", auth, (req, res) => {
  const task = statements.taskById.get(Number(req.params.id));
  if (!task || !isMember(task.project_id, req.user.id)) return res.status(404).json({ message: "Task not found." });
  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).json({ message: "Comment cannot be empty." });
  db.prepare("INSERT INTO comments(task_id, user_id, body) VALUES (?, ?, ?)").run(task.id, req.user.id, body);
  res.status(201).json({ message: "Comment added." });
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`CodeAlpha Project Management Tool running at http://localhost:${PORT}`);
});
