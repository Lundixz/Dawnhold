Architecture & Infrastructure
# Zero-Config Railway Monorepo Pattern
This document defines the repeatable architectural pattern for fullstack applications (Node/Express + Vite/React) optimized for one-click deployment to Railway with zero custom build or run commands.

# Preferred libraries for new projects
The purpose is to standardize the frameworks we use to a limited set of reliable and well functioning frameworks. 
These are preferred frameworks for different purposes. 

> [!IMPORTANT]
> **Dependency Version Policy**: Always use and install the latest stable releases of these preferred libraries. Do not pin to old version numbers in `package.json`.

🌐 Core Web & API Framework
These are the backbone of your server, handling requests, security, and communication.

express: The standard web framework for Node.js. It handles routing, middleware, and HTTP requests.

axios: A promise-based HTTP client. Use this to make requests to external APIs (like fetching data from third-party services).

cors: Middleware that enables "Cross-Origin Resource Sharing." Essential for allowing your frontend (on a different port/domain) to talk to your backend.

cookie-parser: Parses the Cookie header and populates req.cookies. Useful for handling session IDs or small bits of persistent data.

socket.io: Enables real-time, bidirectional, and event-based communication between the browser and the server.

🔐 Security & Authentication
The "guards" of your application, ensuring users are who they say they are and that their data stays private.

jsonwebtoken (JWT): Used to create and verify digital signatures. This is likely how you’re handling stateless user sessions.

bcryptjs: A library to help you hash passwords. Never store passwords in plain text; bcrypt makes them unreadable to hackers.

mongoose-field-encryption: An add-on for Mongoose that encrypts specific fields in your database (like Social Security numbers or private keys) at rest.

🗄️ Database & Background Tasks
How your app stores information and handles heavy lifting without slowing down the user experience.

mongoose: An Object Data Modeling (ODM) library for MongoDB. It provides a schema-based solution to model your application data.

ioredis: A high-performance Redis client. Usually used for caching or as the "engine" behind your message queues. Redis is prone to swelling and stale data, it needs an explicit cleanup mechanism. 

bullmq: A powerful message queue system. It uses Redis to handle distributed jobs (like processing large uploads or sending bulk emails) in the background.
Redis is prone to swelling and stale data, it needs an explicit cleanup mechanism. 

🛠️ Utilities & Integration
Tools for environment management and third-party service integration.

dotenv: Loads environment variables from a .env file into process.env. Keeps your secret keys out of your source code.

nodemailer: The go-to library for sending emails from Node.js.

stripe: The official library for integrating Stripe payments into your application.

puppeteer: A "headless" Chrome browser. Used for scraping websites, generating PDFs, or automated testing.

🏗️ Development Tools
Tools that make your life easier during coding but aren't needed when the app is actually running for users.

concurrently: Allows you to run multiple commands at once (e.g., running your frontend and backend simultaneously with one command).

nodemon: Automatically restarts your node application when it detects file changes in the directory.

## 1. Directory Structure
```text
/                      # Project Root
├── backend/           # Server logic (source only)
│   ├── server.js      # Entry point
│   ├── routes/
│   └── ...
├── frontend/          # Client logic
│   ├── src/
│   ├── package.json   # Frontend-specific deps (Vite, React)
│   └── ...
├── .env               # Unified environment variables
├── package.json       # Root: Backend deps + Orchestration scripts
└── .gitignore         # Includes frontend/dist, node_modules, .env, etc.
└── scripts/           # Temporary test scripts
└── docs/              # Documentation for the app
```
## 2. Root `package.json` Template
The root `package.json` is the "brain" of the deployment. It manages backend dependencies and defines the build pipeline for the frontend.
```json
{
  "name": "project-name",
  "version": "1.0.0",
  "type": "module",
  "main": "backend/server.js",
  "scripts": {
    "start": "node backend/server.js",
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\" --names \"backend,frontend\" --prefix-colors \"blue,green\"",
    "dev:backend": "nodemon backend/server.js",
    "dev:frontend": "cd frontend && npm run dev",
    "install:frontend": "cd frontend && npm install",
    "build:frontend": "cd frontend && npm run build",
    "build": "npm run install:frontend && npm run build:frontend",
    "postinstall": "npm run build"
  },
  "dependencies": {
    "express": "latest",
    "axios": "latest",
    "cors": "latest",
    "cookie-parser": "latest",
    "socket.io": "latest",
    "jsonwebtoken": "latest",
    "bcryptjs": "latest",
    "mongoose": "latest",
    "ioredis": "latest",
    "bullmq": "latest",
    "dotenv": "latest"
  },
  "devDependencies": {
    "concurrently": "latest",
    "nodemon": "latest"
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```
## 3. Backend Implementation (`backend/server.js`)
The backend must handle both API requests and serving the static frontend in production.
```javascript
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
// 1. Load Env from Root
dotenv.config(); 
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// 2. Production Static Serving
if (process.env.NODE_ENV === 'production') {
    // Serve static files from the frontend build folder
    app.use(express.static(path.join(__dirname, '../frontend/dist')));
}
// 3. API Routes
app.use('/api/example', exampleRoutes);
// 4. SPA Catch-all
if (process.env.NODE_ENV === 'production') {
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
        }
    });
}
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));
```

## 4. Key Deployment Principles
1.  **Railway Root**: Set "Root Directory" to `/` in Railway settings.
2.  **The `postinstall` Trick**: Railway runs `npm install`. By defining a `postinstall` script that builds the frontend, you ensure the `frontend/dist` folder exists before the server starts.
3.  **Unified `.env`**: Keeps secrets in one place. Ensure files in `backend/` load it correctly from the parent directory (default `dotenv.config()` works if process is started from root).
4.  **No `backend/package.json`**: For deployment simplicity, the backend does not need its own `package.json`. All backend dependencies live in the root. The frontend keeps its own `package.json` for Vite's build tools.
## 5. Local Workflow
*   **Install All**: `npm install` (Root installs backend + triggers frontend install via postinstall).
*   **Run Dev**: `npm run dev` (Concurrently runs Vite and Nodemon).

# Railway build system
Railway has deprecated nixpacks build and migrated to railpack

https://railpack.com/languages/node Node specific documentation 
https://railpack.com/config/file Configuration file for 

# AI / LLM 
Google Gemini models: Default to gemini-3-flash-preview unless prompted otherwise. 
Do not suggest a lower version than gemini 3 such as gemini 1.5 etc, those are outdated
ChatGPT: Default to chat gpt 5xx models
Claude: Default to Claude Sonnet 4.6

## Gemini Added Memories


# Environment
Dev environment is on a PC. You can only use console commands for that OS. 
Create a .gitignore file which contains a default config. 
Create a .env file for environment variables. The root .env file is also used for vite's variables, make sure they are referenced from there. 

## Known limitations in Railway
Outbound Network - Railway blocks SMTP outbound on free and hobby plan. A pro plan is needed for outbound SMTP such as password recovery through e-mail. 

# Working process
- The user will ask you for development, bug fixes changes etc, 
but don't forget to also stop and review what has been done, investigate the features for gaps, fallacies, missing logic, it's easy to get speed blind and forget about consolodating everything. 
- Maintain a project documentation with all major features and architecture in a file called App Documentation.md, consult this documentation to get a quick overview of how things are setup, if the documentation is out of date, just update it. Make sure to document what the app is about, ie. the expected user experience so I don't have to explain what the purpose of the app is every new session. 
- Dont use the browser yourself, ask the user to test any features requiring browser access unless explicitly prompted to. 

# When you are done with changes
Ask yourself. Are there any gaps in the implementation? 
This is useful for identifying related issues that might not have been in 
direct scope for the task but still is affected.

# At the end of every working session
Create a Last_Session_Summary.md file in the project root. 
This file should contain a summary of the changes made during the session, 
as well as any important notes or issues discovered. This file will be 
used to track the progress of the project and to ensure that 
everyone is on the same page.