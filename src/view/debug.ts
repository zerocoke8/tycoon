// 디버그 오버레이 (지도에서 D 키): 길 그래프 노드·간선, 부스 자리·줄·항아리·진행자, 경주로·오리배 물길 레인, 단체 놀이 마당
// (씨름 모래판, 연 하늘, 줄다리기 선, 보물찾기 판 자리·상자 자리), 건물 자리, 쉬는 곳, 빈 부지, 구역 사각형.
// map.ts의 숫자를 눈으로 맞출 때 쓴다. 처음 켤 때 한 번 그린다.

import { Container, Graphics, Text } from 'pixi.js';
import { BOOTH_IDS } from '../data/defs.ts';
import { BOAT_COURSE, BOOTH_SPOTS, BUILDING_SPOTS, DIG_FIELD, DISTRICTS, EDGES, KITE_FIELD, NODES, RACE_TRACK, REST_SPOTS, SPARE_LOTS, SSIREUM_RING, TUG_FIELD, boatPoint, trackPoint, type NodeId, type Pt } from '../data/map.ts';
import { DISTRICT_IDS, RACE_START_P } from './mapUtil.ts';

const COLORS = {
  district: 0x2d6cdf,
  edge: 0x1f5fbf,
  node: 0xd94040,
  seat: 0x2e9e4f,
  queue: 0xe0a020,
  pot: 0xe07020,
  base: 0x8a3fbf,
  building: 0x8a3fbf,
  rest: 0x20a0a0,
  lot: 0x7a5a3a,
  host: 0xc0398a,
  track: 0x8a5a00,
} as const;

function label(text: string, at: Pt, color: number, size = 18): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'sans-serif', fontSize: size, fill: color, stroke: { color: 0xffffff, width: 4, join: 'round' } },
    resolution: 2,
  });
  t.anchor.set(0.5, 1.2);
  t.position.set(at.x, at.y);
  return t;
}

function cross(g: Graphics, p: Pt, r: number, color: number): void {
  g.moveTo(p.x - r, p.y - r).lineTo(p.x + r, p.y + r).moveTo(p.x + r, p.y - r).lineTo(p.x - r, p.y + r).stroke({ width: 4, color });
}

export function buildDebugOverlay(): Container {
  const root = new Container();
  root.eventMode = 'none';
  const g = new Graphics();
  root.addChild(g);

  for (const id of DISTRICT_IDS) {
    const d = DISTRICTS[id];
    g.rect(d.rect.x, d.rect.y, d.rect.w, d.rect.h).stroke({ width: 6, color: COLORS.district, alpha: 0.8 });
    root.addChild(label(`${id} (${d.name}, 회관 ${d.hall})`, { x: d.rect.x + d.rect.w / 2, y: d.rect.y + 40 }, COLORS.district, 26));
  }

  for (const [a, b] of EDGES) {
    const p = NODES[a];
    const q = NODES[b];
    g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 4, color: COLORS.edge, alpha: 0.85 });
  }
  for (const id of Object.keys(NODES) as NodeId[]) {
    const p = NODES[id];
    g.circle(p.x, p.y, 9).fill(COLORS.node).stroke({ width: 2, color: 0xffffff });
    root.addChild(label(id, p, COLORS.node, 16));
  }

  for (const b of BOOTH_IDS) {
    const s = BOOTH_SPOTS[b];
    cross(g, s.base, 14, COLORS.base);
    root.addChild(label(`부스 ${b}`, s.base, COLORS.base, 20));
    s.seats.forEach((p, i) => {
      g.circle(p.x, p.y, 12).stroke({ width: 4, color: COLORS.seat });
      root.addChild(label(`자리${i}`, p, COLORS.seat, 15));
    });
    s.queue.forEach((p, i) => {
      g.rect(p.x - 8, p.y - 8, 16, 16).stroke({ width: 3, color: COLORS.queue });
      root.addChild(label(`줄${i}`, p, COLORS.queue, 14));
    });
    g.circle(s.pot.x, s.pot.y, 10).fill(COLORS.pot);
    root.addChild(label('항아리', s.pot, COLORS.pot, 15));
    s.hosts.forEach((p, i) => {
      cross(g, p, 10, COLORS.host);
      root.addChild(label(`진행자${i}`, p, COLORS.host, 15));
    });
  }

  // 경주로: 레인 가운데 선 넷 (진행 0 → 1), 출발대·결승선 자리
  for (let lane = 0; lane < RACE_TRACK.lanes; lane++) {
    for (let i = 0; i <= 48; i++) {
      const p = trackPoint(lane, i / 48);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.stroke({ width: 3, color: COLORS.track, alpha: 0.8 });
  }
  // 지도가 그리는 출발선 (출발대 바로 앞, mapUtil RACE_START_P): 선수가 서는 점.
  for (let lane = 0; lane < RACE_TRACK.lanes; lane++) g.circle(trackPoint(lane, RACE_START_P).x, trackPoint(lane, RACE_START_P).y, 7).fill(COLORS.track);
  root.addChild(label(`출발선 p=${RACE_START_P.toFixed(3)}`, trackPoint(RACE_TRACK.lanes - 1, RACE_START_P), COLORS.track, 15));
  cross(g, RACE_TRACK.gate, 14, COLORS.track);
  root.addChild(label('출발대', RACE_TRACK.gate, COLORS.track, 18));
  cross(g, RACE_TRACK.finish, 14, COLORS.track);
  root.addChild(label('결승선', RACE_TRACK.finish, COLORS.track, 18));

  // 오리배 물길: 레인 가운데 선 넷, 출발(p 0)·결승(p 1) 점.
  for (let lane = 0; lane < BOAT_COURSE.lanes; lane++) {
    for (let i = 0; i <= 64; i++) {
      const p = boatPoint(lane, i / 64);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.stroke({ width: 3, color: COLORS.track, alpha: 0.8 });
    g.circle(boatPoint(lane, 0).x, boatPoint(lane, 0).y, 7).fill(COLORS.track);
    g.circle(boatPoint(lane, 1).x, boatPoint(lane, 1).y, 7).stroke({ width: 3, color: COLORS.track });
  }
  root.addChild(label('물길 출발', boatPoint(0, 0), COLORS.track, 15), label('물길 결승', boatPoint(BOAT_COURSE.lanes - 1, 1), COLORS.track, 15));
  // 씨름 모래판, 연 하늘·날리는 자리, 줄다리기 가운데·승리 선, 보물찾기 판 자리·상자 자리.
  const c = SSIREUM_RING.center;
  g.ellipse(c.x, c.y, SSIREUM_RING.rx, SSIREUM_RING.ry).stroke({ width: 3, color: COLORS.track });
  const sky = KITE_FIELD.sky;
  g.rect(sky.x, sky.y, sky.w, sky.h).stroke({ width: 3, color: COLORS.district, alpha: 0.7 });
  g.moveTo(sky.x, KITE_FIELD.skyLow).lineTo(sky.x + sky.w, KITE_FIELD.skyLow).moveTo(sky.x, KITE_FIELD.skyHigh).lineTo(sky.x + sky.w, KITE_FIELD.skyHigh).stroke({ width: 2, color: COLORS.district, alpha: 0.6 });
  root.addChild(label('연 하늘 (높이 0 ~ 1)', { x: sky.x + sky.w / 2, y: sky.y + 30 }, COLORS.district, 16));
  const t = TUG_FIELD.center;
  for (const dx of [-TUG_FIELD.lineHalf, 0, TUG_FIELD.lineHalf]) g.moveTo(t.x + dx, t.y - 90).lineTo(t.x + dx, t.y + 60).stroke({ width: 3, color: COLORS.track });
  root.addChild(label('줄다리기 가운데', t, COLORS.track, 15));
  DIG_FIELD.chests.forEach((p, i) => {
    g.circle(p.x, p.y, i < DIG_FIELD.spots.length ? 16 : 10).stroke({ width: 3, color: COLORS.pot });
    root.addChild(label(i < DIG_FIELD.spots.length ? `판${i}` : `상자${i}`, p, COLORS.pot, 14));
  });

  for (const [id, p] of Object.entries(BUILDING_SPOTS)) {
    cross(g, p, 16, COLORS.building);
    root.addChild(label(id, p, COLORS.building, 20));
  }
  REST_SPOTS.forEach((p, i) => {
    g.circle(p.x, p.y, 10).stroke({ width: 3, color: COLORS.rest });
    root.addChild(label(`쉼${i}`, p, COLORS.rest, 14));
  });
  for (const l of SPARE_LOTS) {
    g.rect(l.at.x - 12, l.at.y - 12, 24, 24).stroke({ width: 3, color: COLORS.lot });
    root.addChild(label(`빈 부지 (${l.district})`, l.at, COLORS.lot, 15));
  }
  return root;
}
