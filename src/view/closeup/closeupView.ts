// 부스 확대 화면 (CloseupViewApi). 화면 위쪽 rect(CSS px = 무대 좌표) 안에 둥근 테두리 패널을 띄우고
// 그 안에 부스 장면(BoothScene)을 그린다. 열기·닫기는 통통 커지고 작아지는 연출.
//   main.ts: closeup = new CloseupView(app, sim); 매 프레임 closeup.update(frameDt). root는 스스로 app.stage에 붙는다.
//   UI: 부스를 누르면 closeup.open(booth, rect), 패널을 닫으면 close(), 화면 크기가 바뀌면 layout(rect).

import { type Application, Container, Graphics, Rectangle } from 'pixi.js';
import type { BoothId } from '../../data/defs.ts';
import { ease, tweens } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import type { MonsterId } from '../../sim/types.ts';
import { closeupRadius, type CloseupViewApi, type Rect } from '../contracts.ts';
import { INK, lerp } from './fx.ts';
import { type CloseupScene, makeScene } from './registry.ts';

const BORDER = 4;

export class CloseupView implements CloseupViewApi {
  readonly root = new Container();
  onTapMonster: (id: MonsterId) => void = () => undefined;
  private readonly sim: SimApi;
  private readonly panel = new Container();
  private readonly shadow = new Graphics();
  private readonly clip = new Container();
  private readonly maskGfx = new Graphics();
  private readonly border = new Graphics();
  private scene: CloseupScene | null = null;
  private current: BoothId | null = null;
  private rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** 지금 장면을 지은 패널 크기. */
  private builtW = 0;
  private builtH = 0;
  /** 열기·닫기 트윈 주인. */
  private readonly owner = {};
  /** 열기·닫기가 겹칠 때 늦게 끝난 닫기가 장면을 지우지 않게. */
  private token = 0;

  constructor(app: Application, sim: SimApi) {
    this.sim = sim;
    this.root.label = 'closeup';
    this.root.visible = false;
    // 무대가 zIndex로 정렬되어도 지도 위에 오게.
    this.root.zIndex = 1000;
    this.clip.mask = this.maskGfx;
    this.panel.addChild(this.shadow, this.clip, this.maskGfx, this.border);
    // 패널 위 누르기가 아래 지도로 새지 않게.
    this.panel.eventMode = 'static';
    this.root.addChild(this.panel);
    app.stage.addChild(this.root);

    const bus = sim.bus;
    bus.on('roundStarted', (e) => {
      if (this.scene?.booth === e.booth) this.scene.onRoundStarted(e.seat, e.round);
    });
    bus.on('roundFinished', (e) => {
      if (this.scene?.booth === e.booth) this.scene.onRoundFinished(e.seat, e.round, e.payout);
    });
    bus.on('monsterReact', (e) => this.scene?.onReact(e.id, e.reaction));
    bus.on('monsterSpectate', (e) => this.scene?.onSpectate(e.id, e.reaction));
    bus.on('monsterCheered', (e) => this.scene?.onCheer(e.id));
    bus.on('monsterLeft', (e) => this.scene?.onLeft(e.id));
    bus.on('potFestival', (e) => {
      if (this.scene?.booth === e.booth) this.scene.onPotFestival(e.amount);
    });
  }

  get booth(): BoothId | null {
    return this.current;
  }

  open(booth: BoothId, rect: Rect): void {
    const wasOpen = this.current !== null;
    this.current = booth;
    this.token++;
    tweens.cancel(this.owner);
    const resized = rect.w !== this.builtW || rect.h !== this.builtH;
    // 닫히는 중에 다시 열면 지금 크기에서 이어서 커진다.
    const closing = !wasOpen && this.root.visible && this.scene !== null;
    this.rect = rect;
    // 지도 위 맨 앞으로.
    this.root.parent?.addChild(this.root);
    this.root.visible = true;
    if (this.scene === null || this.scene.booth !== booth || resized) this.rebuild(booth);
    this.drawFrame();
    if (wasOpen) {
      this.panel.scale.set(1);
      this.panel.alpha = 1;
      return;
    }
    const s0 = closing ? this.panel.scale.x : 0.86;
    const a0 = closing ? this.panel.alpha : 0;
    this.panel.scale.set(s0);
    this.panel.alpha = a0;
    void tweens.run(0.32, (t) => {
      this.panel.scale.set(lerp(s0, 1, t));
      this.panel.alpha = Math.min(1, lerp(a0, 1, t * 2));
    }, { ease: ease.outBack, owner: this.owner });
  }

  close(): void {
    if (this.current === null) return;
    this.current = null;
    const token = ++this.token;
    tweens.cancel(this.owner);
    const s0 = this.panel.scale.x;
    const a0 = this.panel.alpha;
    void tweens
      .run(0.18, (t) => {
        this.panel.scale.set(lerp(s0, 0.9, t));
        this.panel.alpha = lerp(a0, 0, t);
      }, { ease: ease.inQuad, owner: this.owner })
      .then(() => {
        if (token !== this.token) return;
        this.scene?.destroy();
        this.scene = null;
        this.root.visible = false;
      });
  }

  layout(rect: Rect): void {
    const changed = rect.w !== this.builtW || rect.h !== this.builtH;
    this.rect = rect;
    if (this.current === null) return;
    if (changed) this.rebuild(this.current);
    this.drawFrame();
  }

  update(dt: number): void {
    const scene = this.scene;
    if (scene === null) return;
    if (this.current !== null && scene.needsRebuild()) this.rebuild(this.current);
    this.scene?.update(Math.min(0.1, Math.max(0, dt)));
  }

  private rebuild(booth: BoothId): void {
    this.scene?.destroy();
    const w = Math.max(40, this.rect.w);
    const h = Math.max(40, this.rect.h);
    this.scene = makeScene(this.sim, booth, w, h, (id) => this.onTapMonster(id));
    this.builtW = this.rect.w;
    this.builtH = this.rect.h;
    this.clip.addChild(this.scene.root);
  }

  private drawFrame(): void {
    const w = Math.max(40, this.rect.w);
    const h = Math.max(40, this.rect.h);
    const r = closeupRadius(w, h);
    this.panel.pivot.set(w / 2, h / 2);
    this.panel.position.set(this.rect.x + w / 2, this.rect.y + h / 2);
    this.panel.hitArea = new Rectangle(0, 0, w, h);
    // 부드러운 그림자: 아래로 조금 내린 둥근 네모를 몇 겹.
    this.shadow.clear();
    for (let i = 0; i < 6; i++) {
      const e = i * 2.2;
      this.shadow.roundRect(-e, -e + 6, w + e * 2, h + e * 2, r + e).fill({ color: 0x2a1a10, alpha: 0.07 });
    }
    this.maskGfx.clear().roundRect(0, 0, w, h, r).fill({ color: 0xffffff });
    this.border
      .clear()
      .roundRect(0, 0, w, h, r)
      .stroke({ color: INK, width: BORDER })
      .roundRect(BORDER * 0.9, BORDER * 0.9, w - BORDER * 1.8, h - BORDER * 1.8, Math.max(2, r - BORDER))
      .stroke({ color: 0xfff6e6, width: 1.5, alpha: 0.7 });
  }
}
