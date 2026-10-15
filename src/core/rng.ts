// 시드가 있는 난수 (mulberry32). 결과를 다시 만들 수 있게 모든 놀이 결과는 이 난수로 정한다.
// 상태는 숫자 하나라 저장 데이터에 그대로 넣는다.

export class Rng {
  state: number;

  constructor(state: number) {
    this.state = state;
  }

  /** 0 이상 1 미만. */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** min 이상 max 이하의 정수. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick: 빈 목록');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** 가중치 [값, 무게] 목록에서 하나. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= w;
      if (r < 0) return v;
    }
    const last = entries[entries.length - 1];
    if (last === undefined) throw new Error('weighted: 빈 목록');
    return last[0];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
    return items;
  }
}
