import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Simulation of Job Automation Service
  let automationStatus = {
    isRunning: false,
    lastRun: null as string | null,
    nextRun: "12:00 AM",
    logs: [] as string[],
  };

  // API Routes
  app.get("/api/status", (req, res) => {
    res.json(automationStatus);
  });

  app.post("/api/toggle-automation", (req, res) => {
    automationStatus.isRunning = !automationStatus.isRunning;
    automationStatus.logs.push(`Automation ${automationStatus.isRunning ? 'started' : 'stopped'} manually at ${new Date().toLocaleTimeString()}`);
    res.json(automationStatus);
  });

  // CRON Jobs: 12 AM, 7 AM, 1 PM
  // 0 0 * * * (12 AM)
  // 0 7 * * * (7 AM)
  // 0 13 * * * (1 PM)
  const schedules = ["0 0 * * *", "0 7 * * *", "0 13 * * *"];
  
  schedules.forEach(schedule => {
    cron.schedule(schedule, () => {
      if (automationStatus.isRunning) {
        runAutomationTask();
      }
    });
  });

  async function runAutomationTask() {
    automationStatus.lastRun = new Date().toLocaleString();
    automationStatus.logs.push(`Scheduled task started at ${automationStatus.lastRun}`);
    
    try {
      // Logic for Job Search & Resume Modification would go here
      // This would involve calling Gemini API to find jobs and tailor resumes
      automationStatus.logs.push("Searching for jobs on LinkedIn, Naukri, Indeed...");
      // ... search logic ...
      automationStatus.logs.push("Found 5 relevant roles for Software Developer (Fresher).");
      automationStatus.logs.push("Tailoring resumes for each job description using Gemini AI...");
      // ... tailoring logic ...
      automationStatus.logs.push("Applying to jobs...");
      // ... application logic ...
      automationStatus.logs.push("Automation task completed successfully.");
    } catch (error) {
      automationStatus.logs.push(`Error during automation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
