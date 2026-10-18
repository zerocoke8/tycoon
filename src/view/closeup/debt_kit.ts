// 넷째 묶음 (DESIGN 3.7) 확대 화면 도구: 빚 걸기 판 (줄다리기·밀어내기 대결장).
// - DebtBadge: 채무자 발밑 표 (편 색 + '빚 N'). 코인 대신 건 자기 빚. 결과 때 '빚 49 → 25'처럼 새 빚까지 세어 가고 색이 바뀐다
//   (줄면 초록, 0이면 금색, 늘면 빨강).
// - debtSign: '빚 걸기 판' 표지 (판 중 패널 구석).
// - debtTone·debtCaption: 결과 글자 (이긴 편 '빚 반으로!'·'빚이 사라졌다!', 진 편 '상대 빚만큼 +49'·'상대 빚만큼 늘었다…').
// - popDebtCaption: 결과 글자를 짙은 판 위에 (표지와 같은 판: 구름·진행자·구경 손님 글자 위에서도 읽히게).

import { Container, Graphics, Text } from 'pixi.js';
import { ease } from '../../core/tween.ts';
import type { OutcomeTier } from '../../data/defs.ts';
import { type Anim, emoteNode, FONT, INK, lerp } from './fx.ts';
import { preloadGlyphs } from './ssireum_kit.ts';

preloadGlyphs('빚 걸기 판! 빚진 손님을 기다려요 오는 중 시작까지 초 곧 시작! 반으로! 이 사라졌다! 상대 빚만큼 늘었다… 다 갚았다! 홍청 +→0123456789');

/** 빚 표의 상태: 건 빚 그대로 · 줄었다 · 0이 됐다 · 늘었다. */
export type DebtTone = 'stake' | 'down' | 'zero' | 'up';

const TONE_COLOR: Record<DebtTone, number> = { stake: 0x4b4257, down: 0x4f9a4a, zero: 0xd99a1b, up: 0xb4473c };

/** 전·후 빚 → 표 색. */
export function debtTone(before: number, after: number): DebtTone {
  if (after === before) return 'stake';
  if (after < before) return after <= 0 ? 'zero' : 'down';
  return 'up';
}

/**
 * 결과 글자 (편마다 하나): 이긴 편 = 반으로·사라짐, 진 편 = 상대 빚만큼 더.
 * added = 그 편 채무자마다 늘어난 빚 (진 편, 하나면 숫자를 글자에).
 */
export function debtCaption(tier: OutcomeTier, allZero: boolean, added: readonly number[]): { text: string; color: number } {
  const won = tier === 'win' || tier === 'jackpot';
  if (won) return allZero ? { text: '빚이 사라졌다!', color: 0xffc83d } : { text: '빚 반으로!', color: 0x9ad66f };
  const one = added.length === 1 ? added[0] : undefined;
  return { text: one !== undefined && one > 0 ? `상대 빚만큼 +${one}` : '상대 빚만큼 늘었다…', color: 0xff9a8a };
}

/** 표를 어느 쪽으로 펼치나: 0 = (0, 0)이 가운데, -1 = 오른쪽 끝(왼쪽으로 펼침), 1 = 왼쪽 끝(오른쪽으로). */
export type BadgeAlign = -1 | 0 | 1;

/** 채무자 발밑 표: [편 색 '홍'][짙은 판 '빚 46']. (0, 0) = 가운데 (align). */
export class DebtBadge {
  readonly node = new Container();
  /** 이 표를 단 손님과 편 (바뀌면 장면이 새로 만든다). */
  readonly key: string;
  private readonly plate = new Graphics();
  private readonly sideText: Text;
  private readonly amount: Text;
  private readonly sideColor: number;
  private readonly fs: number;
  private readonly align: BadgeAlign;
  private shown = '';

  constructor(key: string, sideName: string, sideColor: number, fs: number, align: BadgeAlign = 0) {
    this.key = key;
    this.sideColor = sideColor;
    this.fs = fs;
    this.align = align;
    const style = { fontFamily: FONT, fontSize: fs, fill: 0xffffff, stroke: { color: INK, width: Math.max(2, fs * 0.16), join: 'round' as const } };
    this.sideText = new Text({ text: sideName, style });
    this.sideText.anchor.set(0.5);
    this.amount = new Text({ text: '', style });
    this.amount.anchor.set(0.5);
    this.node.addChild(this.plate, this.sideText, this.amount);
    this.node.eventMode = 'none';
  }

  /** 보일 빚과 색 (같으면 그대로). from = 결과 때 판 전 빚 ('빚 49 → 25'), 없으면 '빚 N'. */
  set(value: number, tone: DebtTone, from?: number): void {
    const v = Math.max(0, Math.round(value));
    const text = from === undefined ? `빚 ${v}` : `빚 ${Math.round(from)} → ${v}`;
    const sig = `${text}|${tone}`;
    if (sig === this.shown) return;
    this.shown = sig;
    this.amount.text = text;
    const fs = this.fs;
    const h = fs * 1.5;
    const sw = this.sideText.width + fs * 0.7;
    const aw = this.amount.width + fs * 0.9;
    const w = sw + aw;
    const x0 = this.align === 0 ? -w / 2 : this.align === -1 ? -w : 0;
    const g = this.plate.clear();
    g.roundRect(x0, -h / 2, w, h, h / 2).fill({ color: TONE_COLOR[tone] });
    g.roundRect(x0, -h / 2, sw + h / 2, h, h / 2).fill({ color: this.sideColor });
    g.rect(x0 + sw, -h / 2 + 1, h / 2, h - 2).fill({ color: TONE_COLOR[tone] });
    g.roundRect(x0, -h / 2, w, h, h / 2).stroke({ color: INK, width: 2 });
    this.sideText.position.set(x0 + sw / 2, 0);
    this.amount.position.set(x0 + sw + aw / 2, 0);
  }

  destroy(): void {
    if (!this.node.destroyed) this.node.destroy({ children: true });
  }
}

/**
 * 결과 글자 하나 (짙은 판 위, (x, y) = 가운데): 톡 커졌다가 hold초 뒤 살짝 떠오르며 사라진다 (fx.ts popCaption처럼).
 * 글자 폭이 maxW를 넘으면 줄인다.
 */
export function popDebtCaption(layer: Container, anim: Anim, text: string, x: number, y: number, size: number, color: number, hold: number, maxW: number): Container {
  const c = new Container();
  const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fill: color, stroke: { color: INK, width: Math.max(3, size * 0.15), join: 'round' }, padding: size * 0.2 } });
  t.anchor.set(0.5);
  const padX = size * 0.6;
  const h = size * 1.55;
  const w = t.width + padX * 2;
  c.addChild(new Graphics().roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: 0x4b4257, alpha: 0.86 }).stroke({ color: INK, width: 2 }), t);
  const fit = Math.min(1, maxW / w);
  c.position.set(x, y);
  c.scale.set(0.2 * fit);
  c.eventMode = 'none';
  layer.addChild(c);
  void anim
    .run(0.4, (u) => {
      if (!c.destroyed) c.scale.set(lerp(0.2, 1, u) * fit);
    }, { ease: ease.outBack })
    .then(() => anim.run(0.35, (u) => {
      if (c.destroyed) return;
      c.y = y - size * 0.35 * u;
      c.alpha = 1 - u;
    }, { delay: hold, ease: ease.inQuad }))
    .then(() => {
      if (!c.destroyed) c.destroy({ children: true });
    });
  return c;
}

/** '빚 걸기 판' 표지 (먹구름 + 글자, 짙은 판). (0, 0) = 왼쪽 위. */
export function debtSign(fs: number): Container {
  const c = new Container();
  const t = new Text({ text: '빚 걸기 판', style: { fontFamily: FONT, fontSize: fs, fill: 0xffffff, stroke: { color: INK, width: Math.max(2, fs * 0.16), join: 'round' } } });
  const icon = emoteNode('storm', fs * 1.7);
  const pad = fs * 0.55;
  const h = fs * 1.6;
  const iw = fs * 1.4;
  const w = pad + iw + t.width + pad;
  c.addChild(new Graphics().roundRect(0, 0, w, h, h / 2).fill({ color: 0x4b4257, alpha: 0.92 }).stroke({ color: INK, width: 2 }));
  icon.position.set(pad + iw / 2, h / 2);
  t.anchor.set(0, 0.5);
  t.position.set(pad + iw, h / 2);
  c.addChild(icon, t);
  c.eventMode = 'none';
  return c;
}
