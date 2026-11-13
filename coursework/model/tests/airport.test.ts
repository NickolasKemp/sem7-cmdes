import { describe, expect, test } from 'bun:test';
import { BASE, buildAirport, runAirport } from '../src/airport.ts';
import { simulate } from '../src/petri.ts';
import { createRng } from '../src/random.ts';

const DAY = 24 * 60;

describe('модель аеропорту', () => {
  test('кожен літак, що прибув, або приземлився, або відлетів, або ще в аеропорту', () => {
    const { net, places, transitions: tr } = buildAirport(BASE);
    let landed = 0;
    simulate(net, {
      time: 30 * DAY,
      rng: createRng(1),
      onEnter: (t) => {
        if (t === tr.landNow || t === tr.landAfterWait) landed++;
      },
    });
    const waiting = places.queue.count + places.arrived.count + tr.enqueue.busy;
    expect(tr.arrival.fired).toBe(landed + tr.leave.fired + waiting);
  });

  test('дозаправляються лише літаки, що чекають 60–80 хв, відлітають — ті, що чекають 140 хв', () => {
    const { net, transitions: tr } = buildAirport(BASE);
    const refuelWaits: number[] = [];
    const leaveWaits: number[] = [];
    simulate(net, {
      time: 30 * DAY,
      rng: createRng(2),
      onEnter: (t, token, now) => {
        if (!token) return;
        if (t === tr.refuel) refuelWaits.push(now - token.born);
        if (t === tr.leave) leaveWaits.push(now - token.born);
      },
    });
    expect(refuelWaits.length).toBeGreaterThan(0);
    expect(Math.min(...refuelWaits)).toBeGreaterThanOrEqual(60);
    expect(Math.max(...refuelWaits)).toBeLessThanOrEqual(80);
    expect(leaveWaits.every((w) => Math.abs(w - 140) < 1e-9)).toBe(true);
  });

  test('літак, що приземлився до кінця свого таймера, не дозаправляється і не відлітає', () => {
    const r = runAirport({ ...BASE, runways: 12 }, { time: 30 * DAY, warmup: 0, rng: createRng(3) });
    expect(r.refuelled).toBe(0);
    expect(r.left).toBe(0);
  });

  test('без черги всі літаки приносять по 2000 грн', () => {
    const r = runAirport({ ...BASE, runways: 30 }, { time: 30 * DAY, warmup: 0, rng: createRng(4) });
    expect(r.landedAfterWait).toBe(0);
    expect(r.income).toBe(r.landedNoWait * BASE.incomeNoWait);
  });
});
