// 짓기 모드 UI (DESIGN 6.1): 지도에서 놓기·옮기기·길 깔기·땅 넓히기를 하는 동안 뜨는 두 조각.
//  - 유령 옆 ✓/✕ (mpv-ghostctl): 유령 발자국 바로 아래 (자리가 없으면 옆·위), 매 프레임 world.buildAnchor로 따라간다.
//    한 줄 알림: 막힌 까닭 (빨강), '입구가 길에 닿아야 손님이 와요' (노랑). ✓ 단추에 값 (사서 놓기·땅).
//  - 아래 탭 위 띠 (mpv-buildbar): 무엇을 하는 중인지와 도구. 놓기 = [목록], 옮기기 = [보관하기], 길 = [길|지우개] [되돌리기] [끝], 땅 = [끝].
// 모드는 지도(VillageView)가 들고, 띠는 world.onBuildChange로 받은 BuildState를 보여 준다.
// ✓가 되면 폰을 톡 (navigator.vibrate), 안 되면 ✓/✕가 도리도리 (까닭은 지도가 onBuildFail로 토스트에).

import './build.css';
import { catalogKind, catalogName, storable, type CatalogKey } from '../data/catalog.ts';
import { DECOR, type DecorId } from '../data/defs.ts';
import { CELL } from '../data/map.ts';
import type { BuildState, Rect } from '../view/contracts.ts';
import { btn, fmt, h, setText } from './dom.ts';
import { icon } from './icons.ts';
import type { UiCtx } from './panel.ts';
import { askStore, catOf, focusJoin } from './panels/build.ts';
import { itemIcon } from './pics.ts';

/** 유령과 ✓/✕ 사이 (px). */
const GAP = 12;

/** 폰을 짧게 떨게 (안 되는 기기는 그냥 넘어간다). */
function buzz(p: number | number[]): void {
  try {
    navigator.vibrate?.(p);
  } catch {
    // 진동이 막혀 있어도 괜찮다.
  }
}

export class BuildBar {
  /** 아래 띠. */
  readonly el: HTMLDivElement;
  /** 유령 옆 ✓/✕. */
  readonly ctl: HTMLDivElement;
  private readonly ctx: UiCtx;
  private readonly root: HTMLElement;
  private readonly title: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly tools: HTMLDivElement;
  private readonly msg: HTMLDivElement;
  private readonly ok: HTMLButtonElement;
  private readonly no: HTMLButtonElement;
  private st: BuildState | null = null;
  /** 놓기 중에 [땅 넓히기]로 왔으면 그 열쇠 (땅 모드 띠에 [다시 놓기]). */
  private resume: CatalogKey | null = null;
  private toolSig = '';
  private okSig = '';
  private pos = '';
  /** ✓/✕ 글 서명 (바뀌면 크기를 다시 잰다). */
  private ctlSig = '';
  /** ✓/✕ 크기 (글이 바뀔 때만 다시 잰다: 매 프레임 레이아웃을 읽지 않게). */
  private size: { w: number; h: number } | null = null;
  /** 보이는 띠 (위 HUD 아래 ~ 아래 띠 위, CSS px): ui.ts syncInsets가 알려 준다. */
  private bandTop = 64;
  private bandBottom = 600;

  constructor(ctx: UiCtx, root: HTMLElement) {
    this.ctx = ctx;
    this.root = root;
    this.title = h('div', 'mpv-bb-title');
    this.note = h('div', 'mpv-bb-note');
    this.tools = h('div', 'mpv-bb-tools');
    this.el = h('div', 'mpv-buildbar', h('div', 'mpv-bb-head', h('div', 'mpv-grow', this.title, this.note)), this.tools);
    this.el.hidden = true;

    this.msg = h('div', 'mpv-gc-msg');
    this.no = btn('mpv-gc-no', icon('close'), () => {
      this.ctx.hooks.world.cancelBuild();
      this.ctx.markDirty();
    });
    this.no.setAttribute('aria-label', '그만');
    this.ok = btn('mpv-gc-ok', icon('check'), () => this.confirm());
    this.ok.setAttribute('aria-label', '놓기');
    this.ctl = h('div', 'mpv-ghostctl', this.msg, h('div', 'mpv-gc-btns', this.no, this.ok));
    this.ctl.hidden = true;
    root.append(this.ctl, this.el);
  }

  /** 보이는 띠 (CSS px): ✓/✕가 HUD·아래 띠에 가리지 않게. */
  setBand(top: number, bottom: number): void {
    this.bandTop = top;
    this.bandBottom = bottom;
  }

  /** 띠가 보이나 (ui.ts가 지도 카메라 아래 여백에 넣는다). */
  get visible(): boolean {
    return !this.el.hidden;
  }

  // ── ✓ ──

  private confirm(): void {
    const world = this.ctx.hooks.world;
    // 입구가 길에 닿지 않은 자리에 놓으면 곧바로 길 깔기로 (그 입구를 보여 준다).
    const s = this.st;
    const c = s?.check ?? null;
    const entry = s !== null && (s.mode.kind === 'place' || s.mode.kind === 'move') && c !== null && c.ok && !c.entryRoad ? c.entry : null;
    const r = world.confirmBuild();
    if (r.ok) {
      buzz(18);
      if (entry !== null && world.buildState().mode.kind === 'none') {
        world.setBuildMode({ kind: 'road' });
        focusJoin(this.ctx, { x: (entry.x + 0.5) * CELL, y: (entry.y + 0.5) * CELL });
      }
    } else {
      buzz([10, 40, 10]);
      this.ctl.classList.remove('shake');
      void this.ctl.offsetWidth;
      this.ctl.classList.add('shake');
    }
    this.ctx.markDirty();
  }

  // ── 매 프레임: ✓/✕를 유령 옆에 ──

  follow(): void {
    const s = this.st;
    if (s === null || s.mode.kind === 'none') return;
    const a = this.ctx.hooks.world.buildAnchor();
    const show = a !== null && (s.mode.kind !== 'land' || s.chunk >= 0);
    if (this.ctl.hidden === show) this.ctl.hidden = !show;
    if (!show || a === null) return;
    this.ctl.classList.toggle('dragging', s.dragging);
    const p = this.place(a, s.mode.kind === 'land');
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (key === this.pos) return;
    this.pos = key;
    this.ctl.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
  }

  /** ✓/✕ 자리: 유령 바로 아래 → 오른쪽 → 왼쪽 → 위, 다 안 되면 보이는 띠 안으로 밀어 넣는다. 땅은 조각 가운데 아래. */
  private place(a: Rect, land: boolean): { x: number; y: number } {
    const W = this.root.clientWidth;
    if (this.size === null) {
      const w = this.ctl.offsetWidth;
      const hh = this.ctl.offsetHeight;
      // 시트가 덮어 숨었을 때(0)는 기억하지 않는다.
      if (w > 0) this.size = { w, h: hh };
    }
    const cw = this.size?.w ?? 0;
    const ch = this.size?.h ?? 0;
    const top = this.bandTop + 4;
    const bottom = this.bandBottom - 4;
    const cx = a.x + a.w / 2;
    const fitX = (x: number): number => Math.min(Math.max(8, x), W - cw - 8);
    const fitY = (y: number): number => Math.min(Math.max(top, y), bottom - ch);
    if (land) return { x: fitX(cx - cw / 2), y: fitY(a.y + a.h / 2 + 40) };
    const below = a.y + a.h + GAP;
    if (below + ch <= bottom && below >= top) return { x: fitX(cx - cw / 2), y: below };
    const midY = fitY(a.y + a.h / 2 - ch / 2);
    // 옆 (유령이 화면 밖으로 밀려도 ✓/✕는 화면 안에).
    if (a.x + a.w + GAP + cw <= W - 8) return { x: fitX(a.x + a.w + GAP), y: midY };
    if (a.x - GAP - cw >= 8) return { x: fitX(a.x - GAP - cw), y: midY };
    const above = a.y - GAP - ch;
    if (above >= top) return { x: fitX(cx - cw / 2), y: above };
    return { x: fitX(cx - cw / 2), y: fitY(below) };
  }

  /** 4Hz: 코인이 늘고 줄면 값·까닭을 다시 (모드는 그대로). */
  refresh(): void {
    if (this.st !== null && this.st.mode.kind !== 'none') this.show(this.ctx.hooks.world.buildState());
  }

  // ── 모드가 바뀌었다 ──

  show(s: BuildState): void {
    this.st = s;
    const m = s.mode;
    const on = m.kind !== 'none';
    this.el.hidden = !on;
    this.root.classList.toggle('build-mode', on);
    if (!on) {
      this.ctl.hidden = true;
      this.toolSig = '';
      this.pos = '';
      return;
    }
    const sim = this.ctx.sim;
    let title = '';
    let note = '';
    let msg = '';
    let state: 'ok' | 'need' | 'bad' = 'ok';
    let okOn = true;
    let okLabel: (Node | string)[] = [icon('check')];
    if (m.kind === 'place' || m.kind === 'move') {
      const key = m.kind === 'place' ? m.key : (sim.village().byId.get(m.id)?.key ?? null);
      if (key !== null) {
        const name = catalogName(key);
        const decor = catalogKind(key) === 'decor';
        const stored = sim.stored(key);
        if (m.kind === 'move') {
          title = `${name} 옮기기`;
          okLabel = [icon('check'), '옮기기'];
        } else if (decor) {
          title = stored > 0 ? `${name} 놓기 · 보관함 ${stored}개` : `${name} 놓기`;
          okLabel = stored > 0 ? [icon('check'), '놓기'] : [icon('check'), itemIcon('coin'), fmt(DECOR[key as DecorId].cost)];
        } else if (stored > 0) {
          title = `${name} 놓기 · 보관함에서`;
          okLabel = [icon('check'), '놓기'];
        } else {
          const cost = sim.buyCost(key);
          title = `${name} ${catalogKind(key) === 'booth' ? '열고 놓기' : '짓고 놓기'}`;
          const plain = cost !== null && Object.keys(cost.mats ?? {}).length === 0 && Object.keys(cost.precious ?? {}).length === 0;
          okLabel = cost === null || cost.coins <= 0 ? [icon('check'), '놓기'] : plain ? [icon('check'), itemIcon('coin'), fmt(cost.coins)] : [icon('check'), catalogKind(key) === 'booth' ? '열고 놓기' : '짓고 놓기'];
          const short = cost === null ? null : sim.missingReason(cost);
          if (short !== null) {
            okOn = false;
            // 한 줄로 (재료가 나오는 곳 안내는 토스트·목록에서): '무 잎이 1개 모자라요'.
            msg = (short.split('.')[0] ?? short).trim();
            state = 'bad';
          }
        }
        note = !s.roomy && s.check?.ok !== true ? '빈 땅이 모자라요 · 땅을 넓히면 놓을 수 있어요' : s.dragging ? '손을 떼면 그 자리에 멈춰요' : m.kind === 'move' ? '건물을 끌어 새 자리로 · 두 손가락으로 지도 이동' : decor ? '끌어서 자리를 고르고 ✓ · 이어서 더 놓을 수 있어요' : '건물을 끌어 자리를 고르고 ✓ · 두 손가락으로 지도 이동';
      }
      const c = s.check;
      if (c !== null && !c.ok) {
        msg = c.reason ?? '여기에는 놓을 수 없어요';
        state = 'bad';
        okOn = false;
      } else if (c !== null && c.entry !== null && !c.entryRoad && state !== 'bad') {
        msg = '입구가 길에 닿아야 손님이 와요';
        state = 'need';
      }
    } else if (m.kind === 'road' || m.kind === 'erase') {
      const v = sim.village();
      const cut = v.state.placed.filter((p) => catalogKind(p.key) !== 'decor' && p.key !== 'gate' && v.entryCellIndex(p) >= 0 && !v.linkedId(p.id)).length;
      title = m.kind === 'road' ? '길 깔기' : '길 지우기';
      // 마을 입구와 끊긴 길 칸 (지도에 주황 빗금).
      const loose = v.state.roads.some((i) => !v.isWalkable(i));
      note =
        cut > 0
          ? `마을 입구까지 길이 이어지지 않은 건물 ${cut}곳 (노란 칸)${loose ? ' · 주황 빗금 = 끊긴 길' : ''}`
          : loose
            ? '주황 빗금 = 마을 입구와 끊긴 길'
            : m.kind === 'road'
              ? '한 손가락으로 칸을 칠해요 · 두 손가락으로 지도 이동'
              : '지울 길을 칠해요 · 두 손가락으로 지도 이동';
      if (cut > 0) state = 'need';
    } else if (m.kind === 'land') {
      title = `땅 넓히기 · 땅 ${sim.state.village.chunks.length}조각`;
      if (s.chunk < 0) note = '값이 적힌 구름 땅을 눌러 골라요';
      else {
        const info = sim.chunk(s.chunk);
        const lock = sim.chunkLockReason(s.chunk);
        okLabel = [icon('check'), itemIcon('coin'), fmt(info.price)];
        if (lock !== null) {
          msg = lock;
          okOn = false;
          state = 'bad';
          note = '다른 땅을 골라도 돼요';
        } else if (sim.state.coins < info.price) {
          msg = `코인이 ${fmt(info.price - sim.state.coins)} 모자라요`;
          okOn = false;
          state = 'bad';
          note = '다른 땅을 골라도 돼요';
        } else note = '✓를 누르면 구름이 걷혀요';
      }
    }
    setText(this.title, title);
    setText(this.note, note);
    this.el.dataset.state = state;
    this.ctl.dataset.state = state;
    setText(this.msg, msg);
    this.msg.hidden = msg === '';
    this.ok.classList.toggle('off', !okOn);
    const okSig = okLabel.map((n) => (typeof n === 'string' ? n : n.textContent ?? '')).join('|') + (m.kind === 'land' ? s.chunk : '');
    if (okSig !== this.okSig) {
      this.okSig = okSig;
      this.ok.replaceChildren(...okLabel);
      this.ok.classList.toggle('wide', okLabel.length > 1);
    }
    this.syncTools(s);
    // 글이 바뀌었을 때만 ✓/✕ 크기·자리를 다시 잰다.
    const sig = `${msg}|${okSig}`;
    if (sig !== this.ctlSig) {
      this.ctlSig = sig;
      this.pos = '';
      this.size = null;
    }
  }

  /** 띠 오른쪽·아래 도구 (모드가 바뀔 때만 다시 만든다, 되돌리기는 흐리게만). */
  private syncTools(s: BuildState): void {
    const m = s.mode;
    const world = this.ctx.hooks.world;
    if (m.kind !== 'land' && m.kind !== 'place') this.resume = null;
    const sig = m.kind === 'move' ? `move:${m.id}` : m.kind === 'place' ? `place:${m.key}:${s.roomy}` : m.kind === 'land' ? `land:${this.resume ?? ''}` : m.kind;
    if (sig !== this.toolSig) {
      this.toolSig = sig;
      const t = this.tools;
      t.replaceChildren();
      this.el.classList.toggle('road', m.kind === 'road' || m.kind === 'erase');
      if (m.kind === 'place') {
        const key = m.key;
        this.resume = null;
        // 둘레에 자리가 없으면 땅 넓히기로 (산 뒤 [다시 놓기]로 돌아온다).
        if (!s.roomy)
          t.append(
            btn('butter small', [icon('land'), '땅'], () => {
              world.setBuildMode({ kind: 'land' });
              this.resume = key;
              this.toolSig = '';
              this.show(world.buildState());
            }),
          );
        t.append(
          btn('sub small', [icon('list'), '목록'], () => {
            world.cancelBuild();
            this.ctx.openBuild(catOf(key));
          }),
        );
      } else if (m.kind === 'move') {
        const id = m.id;
        const mk = this.ctx.sim.village().byId.get(id)?.key;
        // 바탕 건물(마을회관·공방·사무소·창고·분수)은 옮기기만.
        if (mk !== undefined && storable(mk))
          t.append(
            btn('sub small', [icon('box'), '보관하기'], () => {
              const p = this.ctx.sim.village().byId.get(id);
              if (p === undefined) return;
              askStore(this.ctx, id, p.key, () => world.cancelBuild());
            }),
          );
      } else if (m.kind === 'road' || m.kind === 'erase') {
        const road = btn('tool', [icon('road'), '길'], () => world.setBuildMode({ kind: 'road' }));
        const erase = btn('tool', [icon('eraser'), '지우개'], () => world.setBuildMode({ kind: 'erase' }));
        road.classList.toggle('on', m.kind === 'road');
        erase.classList.toggle('on', m.kind === 'erase');
        road.setAttribute('aria-pressed', String(m.kind === 'road'));
        erase.setAttribute('aria-pressed', String(m.kind === 'erase'));
        const undo = btn('sub small mpv-bb-undo', [icon('undo'), h('span', 'lbl', '되돌리기')], () => {
          const r = world.undoBuild();
          if (!r.ok) this.ctx.toast(r.reason, 'warn');
          else buzz(10);
        });
        undo.setAttribute('aria-label', '되돌리기');
        t.append(h('div', 'mpv-bb-seg', road, erase), undo, btn('green small', [icon('check'), '끝'], () => world.cancelBuild()));
      } else if (m.kind === 'land') {
        const back = this.resume;
        if (back !== null)
          t.append(
            btn('sub small', [icon('pin'), '다시 놓기'], () => {
              this.resume = null;
              world.setBuildMode({ kind: 'place', key: back });
            }),
          );
        t.append(btn('green small', [icon('check'), '끝'], () => world.cancelBuild()));
      }
    }
    const undo = this.tools.querySelector('.mpv-bb-undo');
    if (undo !== null) undo.classList.toggle('dim', s.undo <= 0);
  }
}
