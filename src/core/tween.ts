// 작은 트윈 도구 (의존성 없음). 화면 쪽 연출이 같이 쓴다. tweens.update(dt)를 매 프레임 부른다.
//   tweens.to(obj, { x: 10, alpha: 0 }, 0.4, ease.outBack).then(() => ...)
//   tweens.run(0.6, (t) => { sprite.y = base - Math.sin(t * Math.PI) * 30 })   // t: 0→1 (이미 ease가 걸린 값)

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t * t * t,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  outElastic: (t: number) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
} as const;

interface Job {
  elapsed: number;
  duration: number;
  delay: number;
  ease: Ease;
  step: (t: number) => void;
  resolve: () => void;
  owner: object | null;
  cancelled: boolean;
}

export class Tweens {
  private jobs: Job[] = [];
  /** step이 던진 오류를 받는 곳 (main.ts가 오류 상자로 잇는다). 없으면 console.error. */
  onError: ((e: unknown) => void) | null = null;

  /** duration초 동안 step(ease(t))를 부른다. owner를 주면 cancel(owner)로 한꺼번에 멈출 수 있다. */
  run(duration: number, step: (t: number) => void, opts: { ease?: Ease; delay?: number; owner?: object } = {}): Promise<void> {
    return new Promise((resolve) => {
      this.jobs.push({ elapsed: 0, duration: Math.max(1e-4, duration), delay: opts.delay ?? 0, ease: opts.ease ?? ease.outQuad, step, resolve, owner: opts.owner ?? null, cancelled: false });
    });
  }

  /** obj의 숫자 속성들을 to 값으로. */
  to<T extends object>(obj: T, to: Partial<Record<keyof T, number>>, duration: number, e: Ease = ease.outQuad, delay = 0): Promise<void> {
    const rec = obj as unknown as Record<string, number>;
    const from: Record<string, number> = {};
    let started = false;
    return this.run(
      duration,
      (t) => {
        if (!started) {
          for (const k of Object.keys(to)) from[k] = rec[k] ?? 0;
          started = true;
        }
        for (const [k, v] of Object.entries(to) as [string, number][]) rec[k] = (from[k] ?? 0) + (v - (from[k] ?? 0)) * t;
      },
      { ease: e, delay, owner: obj },
    );
  }

  /** owner의 트윈을 모두 멈춘다 (Promise는 풀린다). */
  cancel(owner: object): void {
    for (const j of this.jobs) {
      if (j.owner === owner && !j.cancelled) {
        j.cancelled = true;
        j.resolve();
      }
    }
  }

  update(dt: number): void {
    if (this.jobs.length === 0) return;
    // step이나 then 안에서 새 트윈이 더해질 수 있으니 지금 목록을 떼어 놓고 돈다.
    const current = this.jobs;
    this.jobs = [];
    const keep: Job[] = [];
    for (const j of current) {
      if (j.cancelled) continue;
      if (j.delay > 0) {
        j.delay -= dt;
        keep.push(j);
        continue;
      }
      j.elapsed += dt;
      const t = Math.min(1, j.elapsed / j.duration);
      try {
        j.step(j.ease(t));
      } catch (e) {
        // 트윈 하나의 오류가 나머지 트윈을 잃게 하지 않게: 그 트윈만 끝내고(Promise는 풀린다) 알린다.
        j.cancelled = true;
        j.resolve();
        if (this.onError !== null) this.onError(e);
        else console.error(e);
        continue;
      }
      if (t >= 1) j.resolve();
      else keep.push(j);
    }
    this.jobs = keep.concat(this.jobs);
  }
}

/** 화면 전체가 같이 쓰는 트윈 목록 (main.ts가 매 프레임 update). */
export const tweens = new Tweens();
