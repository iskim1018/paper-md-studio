/**
 * 변환 작업 큐 + 동시성 제어 (worker pool 패턴).
 *
 * - sidecar(외부 node 프로세스) 변환을 동시에 N개까지만 실행한다.
 * - 큐 레벨 cancel만 지원: cancelAll은 pending을 비우고, running은
 *   끝까지 수행한다. 진행 중인 sidecar 강제 kill은 미지원 (Phase 7+).
 * - 작업 식별자: items는 반드시 고유한 `id` 필드를 가져야 한다.
 */

export interface QueueItemBase {
  readonly id: string;
}

export interface QueueSnapshot {
  readonly running: number;
  readonly pending: number;
  readonly completed: number;
  readonly failed: number;
}

export interface ConvertQueueOptions<T extends QueueItemBase> {
  readonly concurrency: number;
  readonly run: (item: T) => Promise<void>;
  readonly onProgress?: (snapshot: QueueSnapshot) => void;
  readonly onIdle?: () => void;
}

export class ConvertQueue<T extends QueueItemBase> {
  private readonly concurrency: number;
  private readonly runFn: (item: T) => Promise<void>;
  private readonly onProgress?: (snapshot: QueueSnapshot) => void;
  private readonly onIdle?: () => void;

  private pending: Array<T> = [];
  private runningIds: Set<string> = new Set();
  private completed = 0;
  private failed = 0;

  constructor(options: ConvertQueueOptions<T>) {
    if (options.concurrency < 1) {
      throw new Error("concurrency는 1 이상이어야 합니다.");
    }
    this.concurrency = options.concurrency;
    this.runFn = options.run;
    this.onProgress = options.onProgress;
    this.onIdle = options.onIdle;
  }

  enqueue(item: T): void {
    this.pending.push(item);
    this.emitProgress();
    this.pump();
  }

  cancelAll(): void {
    this.pending = [];
    this.emitProgress();
    // running은 그대로 둔다 (큐 레벨 cancel만)
  }

  cancelItem(id: string): void {
    // running 중이면 무시 (이미 시작됨)
    if (this.runningIds.has(id)) return;
    this.pending = this.pending.filter((item) => item.id !== id);
    this.emitProgress();
  }

  snapshot(): QueueSnapshot {
    return {
      running: this.runningIds.size,
      pending: this.pending.length,
      completed: this.completed,
      failed: this.failed,
    };
  }

  /** 통계를 0으로 리셋한다 (이미 진행 중인 작업은 그대로). */
  resetStats(): void {
    this.completed = 0;
    this.failed = 0;
    this.emitProgress();
  }

  private pump(): void {
    while (this.runningIds.size < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift();
      if (!item) break;
      this.runningIds.add(item.id);
      this.emitProgress();
      this.execute(item);
    }
  }

  private execute(item: T): void {
    this.runFn(item)
      .then(() => {
        this.completed += 1;
      })
      .catch(() => {
        this.failed += 1;
      })
      .finally(() => {
        this.runningIds.delete(item.id);
        this.emitProgress();
        if (this.runningIds.size === 0 && this.pending.length === 0) {
          this.onIdle?.();
        } else {
          this.pump();
        }
      });
  }

  private emitProgress(): void {
    this.onProgress?.(this.snapshot());
  }
}
