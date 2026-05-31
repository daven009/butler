type QueueTask<T> = {
  id: string;
  name: string;
  enqueuedAt: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export interface ScrapeQueueStats {
  concurrency: number;
  maxQueueSize: number;
  running: number;
  queued: number;
  accepted: number;
  completed: number;
  failed: number;
  rejected: number;
}

export class ScrapeQueueFullError extends Error {
  code = 'SCRAPE_QUEUE_FULL';
  statusCode = 429;
  stats: ScrapeQueueStats;

  constructor(stats: ScrapeQueueStats) {
    super(`Scrape queue is full (queued=${stats.queued}, running=${stats.running})`);
    this.name = 'ScrapeQueueFullError';
    this.stats = stats;
  }
}

class ScrapeQueue {
  private readonly concurrency: number;
  private readonly maxQueueSize: number;
  private readonly queue: Array<QueueTask<unknown>> = [];
  private running = 0;

  private accepted = 0;
  private completed = 0;
  private failed = 0;
  private rejected = 0;

  constructor(concurrency: number, maxQueueSize: number) {
    this.concurrency = Math.max(1, concurrency);
    this.maxQueueSize = Math.max(1, maxQueueSize);
  }

  enqueue<T>(name: string, run: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.maxQueueSize) {
      this.rejected += 1;
      throw new ScrapeQueueFullError(this.getStats());
    }

    this.accepted += 1;

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: `scrape-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        enqueuedAt: Date.now(),
        run,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  getStats(): ScrapeQueueStats {
    return {
      concurrency: this.concurrency,
      maxQueueSize: this.maxQueueSize,
      running: this.running,
      queued: this.queue.length,
      accepted: this.accepted,
      completed: this.completed,
      failed: this.failed,
      rejected: this.rejected,
    };
  }

  private pump() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) return;

      this.running += 1;

      Promise.resolve()
        .then(task.run)
        .then((result) => {
          this.completed += 1;
          task.resolve(result as never);
        })
        .catch((error) => {
          this.failed += 1;
          task.reject(error);
        })
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }
}

const SCRAPE_CONCURRENCY = Number(process.env.SCRAPE_WORKER_CONCURRENCY || 1);
const SCRAPE_MAX_QUEUE = Number(process.env.SCRAPE_MAX_QUEUE || 50);

const scrapeQueue = new ScrapeQueue(SCRAPE_CONCURRENCY, SCRAPE_MAX_QUEUE);

export function enqueueScrapeTask<T>(name: string, run: () => Promise<T>): Promise<T> {
  return scrapeQueue.enqueue(name, run);
}

export function getScrapeQueueStats(): ScrapeQueueStats {
  return scrapeQueue.getStats();
}
