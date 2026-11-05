import type { Context } from "hono";
import { config } from "../config.js";
import { defaultProviderRegistry, UpstreamError, UpstreamResult } from "../providers/index.js";
import type {
  AudioSpeechRequest,
  ChatCompletionRequest,
  ImageGenerationRequest,
  VideoGenerationRequest,
} from "../providers/types.js";
import { createJob, newId, recordUpstream } from "../ledger/index.js";
import { apiError } from "../payments/gateway.js";
import { getPaymentState } from "../payments/state.js";

/**
 * Paid model handler. By the time it runs, the request is validated, quoted and
 * its payment verified (chat) or settled (image, voice, video). It only talks to
 * the upstream; ledger, receipts and refunds are handled by commerceMiddleware.
 */
export async function handleModelRequest(c: Context): Promise<Response> {
  const state = getPaymentState(c);
  if (!state?.model || !state.request) return apiError(c, 500, "internal_error", "Request was not prepared.");
  const model = state.model;
  const provider = defaultProviderRegistry.getProvider(model.provider);
  const meta = {
    request_id: state.requestId,
    price_micro_usdc: state.amountMicro,
    receipt_url: `${config.publicDomain}/v1/receipts/${state.requestId}`,
  };

  try {
    if (model.modality === "video") {
      const submission = await provider.submitVideo!(model, state.request as VideoGenerationRequest);
      const jobId = newId("job");
      await createJob({
        id: jobId,
        requestId: state.requestId,
        payer: state.payer!,
        modelSlug: model.slug,
        upstreamJobId: submission.upstreamJobId,
      });
      const upstreamProvider = config.mockProviders ? "mock" : model.provider;
      await recordUpstream(state.requestId, upstreamProvider, model.upstreamModelId);
      state.upstream = { provider: upstreamProvider, model: model.upstreamModelId };
      state.jobId = jobId;
      return c.json(
        {
          id: jobId,
          object: "video.job",
          status: "queued",
          model: model.slug,
          poll_url: `${config.publicDomain}/v1/jobs/${jobId}`,
          refund_policy: "If generation fails or does not finish within 60 minutes, the full amount is refunded on-chain.",
          moltworld: meta,
        },
        202
      );
    }

    let result: UpstreamResult<unknown>;
    switch (model.modality) {
      case "chat":
        result = await provider.chatComplete!(model, state.request as ChatCompletionRequest);
        break;
      case "image":
        result = await provider.generateImage!(model, state.request as ImageGenerationRequest);
        break;
      case "voice":
        result = await provider.generateSpeech!(model, state.request as AudioSpeechRequest);
        break;
    }
    state.upstream = {
      provider: result.upstreamProvider,
      model: result.upstreamModel,
      costUsd: result.upstreamCostUsd,
      usage: result.usage,
    };
    return c.json({ ...(result.body as object), moltworld: meta });
  } catch (err: any) {
    const message = err instanceof UpstreamError ? err.message : "Upstream request failed.";
    if (!(err instanceof UpstreamError)) console.error(`Upstream failure for ${model.slug}:`, err);
    return apiError(
      c,
      502,
      "upstream_error",
      state.paymentFlow === "upfront"
        ? `${message} Your payment settled before the call, so a full refund has been queued.`
        : `${message} Your payment was not settled; you were not charged.`
    );
  }
}
