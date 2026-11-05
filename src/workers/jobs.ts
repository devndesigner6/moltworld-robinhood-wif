import { defaultModelRegistry } from "../models/registry.js";
import { defaultProviderRegistry } from "../providers/index.js";
import { claimDueJobs, createRefund, getRequest, JobRecord, updateJob } from "../ledger/index.js";

const MAX_JOB_AGE_MS = 60 * 60 * 1000;

/**
 * Polls running video jobs. A job that fails upstream, or never finishes within
 * an hour, is refunded in full; the caller already paid up front.
 */
export async function pollJob(job: JobRecord): Promise<JobRecord["status"]> {
  const model = defaultModelRegistry.getModel(job.model_slug);
  const fail = async (error: string) => {
    await updateJob(job.id, { status: "failed", error });
    const request = await getRequest(job.request_id);
    if (request) await createRefund(request.id, request.payer, request.amount_micro, `Video job failed: ${error}`);
    return "failed" as const;
  };

  if (!model || !job.upstream_job_id) return fail("Job has no upstream model or id.");
  if (Date.now() - new Date(job.created_at).getTime() > MAX_JOB_AGE_MS) return fail("Timed out after 60 minutes.");

  let status;
  try {
    status = await defaultProviderRegistry.getProvider(model.provider).getVideoStatus!(model, job.upstream_job_id);
  } catch (err: any) {
    // Transient polling errors are retried; the age limit above bounds them.
    await updateJob(job.id, { status: job.status, nextPollSeconds: 20 });
    return job.status;
  }

  switch (status.state) {
    case "queued":
    case "processing":
      await updateJob(job.id, { status: status.state, nextPollSeconds: Math.min(5 + job.polls * 5, 30) });
      return status.state;
    case "completed":
      await updateJob(job.id, { status: "completed", videoUrl: status.videoUrl ?? null, requiresProxy: !!status.requiresProxy });
      return "completed";
    case "failed":
      return fail(status.error);
  }
}

export async function pollDueJobs(): Promise<number> {
  const jobs = await claimDueJobs(20);
  await Promise.all(jobs.map((job) => pollJob(job).catch((err) => console.error(`Job ${job.id} poll failed:`, err))));
  return jobs.length;
}
