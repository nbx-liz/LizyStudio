/**
 * Re-export of the ``useJob`` hook that already lives in
 * ``src/hooks/useJob.ts``. Surfacing it under ``api/queries`` keeps
 * the consumer import surface uniform (B-7): components only need to
 * know about ``@/api/queries``.
 */

export { useJob } from "@/hooks/useJob";
