const state = {
  token: localStorage.getItem("codealpha_pm_token"),
  user: null,
  projects: [],
  currentProject: null,
  members: []
};

const $ = (id) => document.getElementById(id);
const api = async (url, options = {}) => {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Something went wrong.");
  return data;
};

function toast(message, error = false) {
  const el = document.createElement("div");
  el.className = `toast${error ? " error" : ""}`;
  el.textContent = message;
  $("toast").appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function showModal(html) {
  $("modalContent").innerHTML = html;
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); }
$("closeModal").onclick = closeModal;
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeModal(); });

document.querySelectorAll(".tab").forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const register = tab.dataset.mode === "register";
    $("nameWrap").classList.toggle("hidden", !register);
    $("authSubmit").textContent = register ? "Create Account" : "Login";
    $("authForm").dataset.mode = register ? "register" : "login";
  };
});

$("authForm").onsubmit = async e => {
  e.preventDefault();
  try {
    const register = e.currentTarget.dataset.mode === "register";
    const body = {
      name: $("name").value,
      username: $("username").value,
      password: $("password").value
    };
    const data = await api(register ? "/api/auth/register" : "/api/auth/login", {
      method: "POST", body: JSON.stringify(body)
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("codealpha_pm_token", state.token);
    await bootApp();
  } catch (err) { toast(err.message, true); }
};

$("logoutBtn").onclick = () => {
  localStorage.removeItem("codealpha_pm_token");
  state.token = null; state.user = null;
  $("appView").classList.add("hidden");
  $("authView").classList.remove("hidden");
};

function projectModal() {
  showModal(`
    <h2>Create Project</h2>
    <form id="projectForm">
      <label>Project name</label>
      <input id="projectNameInput" required placeholder="e.g. Campus App">
      <label>Description</label>
      <textarea id="projectDescInput" placeholder="Project goal and scope"></textarea>
      <div class="form-actions">
        <button type="button" class="secondary" id="cancelProject">Cancel</button>
        <button class="primary">Create Project</button>
      </div>
    </form>
  `);
  $("cancelProject").onclick = closeModal;
  $("projectForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const data = await api("/api/projects", { method:"POST", body: JSON.stringify({
        name: $("projectNameInput").value,
        description: $("projectDescInput").value
      })});
      closeModal(); await loadProjects(); await selectProject(data.projectId); toast("Project created.");
    } catch (err) { toast(err.message, true); }
  };
}

function memberModal() {
  showModal(`
    <h2>Add Team Member</h2>
    <p class="muted">Enter an existing user's username.</p>
    <form id="memberForm">
      <label>Username</label>
      <input id="memberUsername" required placeholder="username">
      <div class="form-actions">
        <button type="button" class="secondary" id="cancelMember">Cancel</button>
        <button class="primary">Add Member</button>
      </div>
    </form>
  `);
  $("cancelMember").onclick = closeModal;
  $("memberForm").onsubmit = async e => {
    e.preventDefault();
    try {
      await api(`/api/projects/${state.currentProject.id}/members`, {
        method:"POST", body: JSON.stringify({ username: $("memberUsername").value })
      });
      closeModal(); await selectProject(state.currentProject.id); toast("Member added.");
    } catch (err) { toast(err.message, true); }
  };
}

function taskModal() {
  const memberOptions = state.members.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (@${escapeHtml(m.username)})</option>`).join("");
  showModal(`
    <h2>Create Task</h2>
    <form id="taskForm">
      <label>Task title</label>
      <input id="taskTitle" required placeholder="e.g. Design login page">
      <label>Description</label>
      <textarea id="taskDescription" placeholder="Task details"></textarea>
      <label>Assign to</label>
      <select id="taskAssignee"><option value="">Unassigned</option>${memberOptions}</select>
      <label>Due date</label>
      <input id="taskDueDate" type="date">
      <div class="form-actions">
        <button type="button" class="secondary" id="cancelTask">Cancel</button>
        <button class="primary">Create Task</button>
      </div>
    </form>
  `);
  $("cancelTask").onclick = closeModal;
  $("taskForm").onsubmit = async e => {
    e.preventDefault();
    try {
      await api(`/api/projects/${state.currentProject.id}/tasks`, {
        method:"POST", body: JSON.stringify({
          title: $("taskTitle").value,
          description: $("taskDescription").value,
          assigneeId: $("taskAssignee").value || null,
          dueDate: $("taskDueDate").value
        })
      });
      closeModal(); await selectProject(state.currentProject.id); toast("Task created.");
    } catch (err) { toast(err.message, true); }
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[ch]));
}

function renderProjects() {
  $("projectList").innerHTML = state.projects.length ? state.projects.map(p => `
    <button class="project-item ${state.currentProject?.id === p.id ? "active" : ""}" data-id="${p.id}">
      <strong>${escapeHtml(p.name)}</strong>
      <small>${p.task_count} tasks · ${p.member_count} members</small>
    </button>
  `).join("") : `<p class="muted">No projects yet.</p>`;
  document.querySelectorAll(".project-item").forEach(btn => btn.onclick = () => selectProject(Number(btn.dataset.id)));
}

async function loadProjects() {
  const data = await api("/api/projects");
  state.projects = data.projects;
  renderProjects();
}

async function selectProject(id) {
  try {
    const data = await api(`/api/projects/${id}`);
    state.currentProject = data.project;
    state.members = data.members;
    $("emptyState").classList.add("hidden");
    $("projectView").classList.remove("hidden");
    $("projectName").textContent = data.project.name;
    $("projectDescription").textContent = data.project.description || "No description.";
    $("memberSummary").textContent = `${data.members.length} team member${data.members.length === 1 ? "" : "s"}`;
    renderBoard(data.tasks);
    renderProjects();
  } catch (err) { toast(err.message, true); }
}

function renderBoard(tasks) {
  const cols = { todo: $("todoCol"), in_progress: $("progressCol"), done: $("doneCol") };
  Object.values(cols).forEach(c => c.innerHTML = "");
  const counts = { todo: 0, in_progress: 0, done: 0 };
  tasks.forEach(task => {
    counts[task.status]++;
    const card = document.createElement("article");
    card.className = "task-card";
    const assigneeOptions = state.members.map(m => `<option value="${m.id}" ${m.id === task.assignee_id ? "selected" : ""}>${escapeHtml(m.username)}</option>`).join("");
    card.innerHTML = `
      <h3>${escapeHtml(task.title)}</h3>
      ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
      <div class="task-meta">
        <span class="badge">${task.assignee_username ? "@" + escapeHtml(task.assignee_username) : "Unassigned"}</span>
        ${task.due_date ? `<span class="badge">Due ${escapeHtml(task.due_date)}</span>` : ""}
      </div>
      <select class="statusSelect">
        <option value="todo" ${task.status==="todo"?"selected":""}>To Do</option>
        <option value="in_progress" ${task.status==="in_progress"?"selected":""}>In Progress</option>
        <option value="done" ${task.status==="done"?"selected":""}>Done</option>
      </select>
      <select class="assigneeSelect">
        <option value="">Unassigned</option>${assigneeOptions}
      </select>
      <div class="comments" id="comments-${task.id}">
        <button class="secondary commentsBtn">View comments</button>
      </div>
    `;
    card.querySelector(".statusSelect").onchange = async e => {
      try { await api(`/api/tasks/${task.id}`, {method:"PATCH", body:JSON.stringify({status:e.target.value, assigneeId: task.assignee_id})}); await selectProject(state.currentProject.id); }
      catch (err) { toast(err.message, true); }
    };
    card.querySelector(".assigneeSelect").onchange = async e => {
      try { await api(`/api/tasks/${task.id}`, {method:"PATCH", body:JSON.stringify({status:task.status, assigneeId:e.target.value || null})}); await selectProject(state.currentProject.id); }
      catch (err) { toast(err.message, true); }
    };
    card.querySelector(".commentsBtn").onclick = () => showComments(card.querySelector(".comments"), task.id);
    cols[task.status].appendChild(card);
  });
  $("todoCount").textContent = counts.todo;
  $("progressCount").textContent = counts.in_progress;
  $("doneCount").textContent = counts.done;
}

async function showComments(container, taskId) {
  try {
    const data = await api(`/api/tasks/${taskId}/comments`);
    container.innerHTML = `
      <strong>Comments</strong>
      ${data.comments.length ? data.comments.map(c => `<div class="comment"><strong>${escapeHtml(c.name)}</strong>${escapeHtml(c.body)}</div>`).join("") : `<p class="muted">No comments yet.</p>`}
      <form class="comment-form">
        <input required placeholder="Write a comment...">
        <button class="primary">Post</button>
      </form>
    `;
    container.querySelector("form").onsubmit = async e => {
      e.preventDefault();
      const input = e.currentTarget.querySelector("input");
      try {
        await api(`/api/tasks/${taskId}/comments`, {method:"POST", body:JSON.stringify({body:input.value})});
        await showComments(container, taskId);
      } catch (err) { toast(err.message, true); }
    };
  } catch (err) { toast(err.message, true); }
}

async function bootApp() {
  try {
    const me = await api("/api/auth/me");
    state.user = me.user;
    $("currentUser").textContent = `${state.user.name} (@${state.user.username})`;
    $("authView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    await loadProjects();
    if (state.projects.length) await selectProject(state.projects[0].id);
    else { $("emptyState").classList.remove("hidden"); $("projectView").classList.add("hidden"); }
  } catch {
    localStorage.removeItem("codealpha_pm_token");
    state.token = null;
    $("authView").classList.remove("hidden");
    $("appView").classList.add("hidden");
  }
}

$("newProjectBtn").onclick = projectModal;
$("emptyNewProject").onclick = projectModal;
$("newTaskBtn").onclick = taskModal;
$("addMemberBtn").onclick = memberModal;

bootApp();
