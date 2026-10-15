// 타입이 있는 이벤트 버스. 시뮬레이션(sim)이 내고 화면(view)·UI가 듣는다. sim은 view를 모른다.

export class Emitter<E extends Record<string, unknown>> {
  private handlers = new Map<keyof E, Set<(payload: never) => void>>();

  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (set === undefined) this.handlers.set(type, (set = new Set()));
    set.add(fn as (payload: never) => void);
    return () => set.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (set === undefined) return;
    for (const fn of set) (fn as (p: E[K]) => void)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
