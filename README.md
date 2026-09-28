# CodeAlpha Project Management Tool

## CodeAlpha Full Stack Development Internship — Task 3

A Trello/Asana-style project management application built with a simple full-stack architecture.

### Features
- User registration and login
- Create group projects
- Add team members
- Project boards
- Task cards
- Assign tasks to project members
- Task status: To Do, In Progress, Done
- Task due dates
- Task comments and communication
- SQLite database for users, projects, tasks, and comments

### Tech Stack
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express.js
- Database: SQLite using Node.js built-in `node:sqlite`
- Authentication: JWT + bcryptjs

### Run locally
```bash
npm install
npm start
```

Open:
`http://localhost:3000`

### CodeAlpha requirement mapping
- Authentication: registration/login
- Project boards: project dashboard with three task columns
- Task cards: create, assign, update status
- Collaboration: add project members and comment on tasks
- Database: users, projects, project members, tasks, comments
