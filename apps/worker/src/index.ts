import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

console.log('Worker service starting...');

// Placeholder — broadcast and sync workers will be added in Phase 4
const worker = new Worker(
  'default',
  async (job) => {
    console.log(`Processing job ${job.id}: ${job.name}`);
  },
  { connection },
);

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

async function shutdown() {
  console.log('Shutting down worker...');
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
