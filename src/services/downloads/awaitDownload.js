// RNFS on iOS may never settle its promise after cancellation with resume data.
// Observe both outcomes immediately so cancel always releases the caller's UI lock.
export async function awaitDownload(job, signal, stopDownload) {
  if (!signal) return job.promise;
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => {
      try { stopDownload(job.jobId); } catch (_) {}
      reject(new Error('E_ABORTED 下载已取消'));
    };
    signal.addEventListener('abort', onAbort);
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([job.promise, cancelled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
