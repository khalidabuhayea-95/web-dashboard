/**
 * Arabic diacritization with ichkil, in process, on the CPU: a 21 MB ONNX model that runs in a
 * few milliseconds. It replaced Fine-Tashkeel (2.7 GB, seconds per text, needed a GPU). In the
 * 2026-11-16 benchmark on our own texts it matched Fine-Tashkeel's accuracy: 2.9% diacritic
 * error rate on greetings / du'a / verses for both, and 0.9% vs 1.5% excluding case endings.
 */
import * as ort from "onnxruntime-node";

import config from "./ichkil-config.json";
import { ICHKIL_MODEL, ensureIchkilModel } from "./ichkilModel.js";
import {
  attachToOriginal,
  encode,
  modelCharacters,
  stripForPrediction,
} from "./ichkilPipeline.js";

const SYM2ID = config.sym2id as Record<string, number>;
const UNK_ID = SYM2ID["<unk>"] ?? 1;
const NUM_LABELS = Number(config.num_tags);
const MAX_SEQ_LEN = Number(config.max_seq_len) || 1024;

export const ICHKIL_MODEL_ID = `ichkil-${ICHKIL_MODEL.version}`;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const modelPath = await ensureIchkilModel();
      return ort.InferenceSession.create(modelPath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
        // A tiny model on a shared box: two threads leave the rest of the CPU to the app.
        intraOpNumThreads: Number(process.env.ICHKIL_THREADS) || 2,
      });
    })().catch((error) => {
      sessionPromise = null; // a failed load (network, disk) is retried on the next call
      throw error;
    });
  }
  return sessionPromise;
}

/** Diacritizes `text`. Characters other than the added marks come back exactly as given. */
export async function ichkilDiacritize(text: string): Promise<string> {
  const base = stripForPrediction(text);
  if (!base.trim()) return base;
  const chars = modelCharacters(base);
  if (chars.length > MAX_SEQ_LEN) {
    throw new Error(`text too long for the model (${chars.length} > ${MAX_SEQ_LEN} characters)`);
  }

  const session = await getSession();
  const ids = BigInt64Array.from(encode(chars, SYM2ID, UNK_ID) as number[], (id) => BigInt(id));
  const input = new ort.Tensor("int64", ids, [1, ids.length]);
  const { logits } = await session.run({ input_ids: input });
  return attachToOriginal(base, chars, logits.data as Float32Array, NUM_LABELS);
}
