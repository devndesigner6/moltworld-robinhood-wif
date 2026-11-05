import { config } from "../config.js";
import { pollDueJobs } from "./jobs.js";
import { processPayouts, processRefunds } from "./payouts.js";

function every(ms: number, label: string, task: () => Promise<unknown>): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (err) {
      console.error(`Background task '${label}' failed:`, err);
    } finally {
      running = false;
    }
  }, ms);
  timer.unref();
  return timer;
}

export function startBackgroundWorkers(): NodeJS.Timeout[] {
  if (!config.backgroundWorkers) return [];
  const workers = [every(5_000, "video-jobs", pollDueJobs)];
  if (config.paymentChain === "algorand") {
    workers.push(every(30_000, "refunds", processRefunds));
    workers.push(every(10 * 60_000, "payouts", processPayouts));
  }
  return workers;
}
