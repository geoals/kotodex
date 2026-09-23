import { useState, useEffect, useCallback } from 'preact/hooks';
import { fetchJob, pollStatus } from '../../api.js';

/** `missing` is a video nothing was submitted for — not an error. */
export function useJob(videoId) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [missing, setMissing] = useState(false);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setMissing(false);
    fetchJob(videoId)
      .then((data) => { if (!cancelled) setJob(data); })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 404) setMissing(true);
        else setError(err.message);
      });
    return () => { cancelled = true; };
  }, [videoId, generation]);

  useEffect(() => {
    if (!job || job.is_terminal) return;
    const timer = setInterval(async () => {
      try {
        const data = await pollStatus(videoId, job.sentence_count, job.status);
        if (data) setJob(data);
      } catch (_) {
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [job?.status, job?.sentence_count, videoId]);

  return { job, error, missing, reload };
}
