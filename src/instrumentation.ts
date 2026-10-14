export async function register() {
  // Start the background job worker with the server (Node runtime only), so queued and
  // interrupted jobs run even if nobody uploads anything after a restart.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./lib/jobs");
    startWorker();
  }
}
