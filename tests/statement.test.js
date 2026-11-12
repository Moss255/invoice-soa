import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildStatement, aging, summarise } from '../src/lib/statement.js';

const tx = (id, kind, date, amount, extra = {}) => ({
  id, kind, date, amount, account: 'Contoso', currency: 'USD', number: id, dueDate: '', ...extra,
});

const data = [
  tx('I1', 'invoice', '2026-06-01', 1000, { dueDate: '2026-07-01' }),
  tx('I2', 'invoice', '2026-08-01', 500, { dueDate: '2026-08-31' }),
  tx('P1', 'payment', '2026-08-15', 600),
  tx('I3', 'invoice', '2026-10-20', 300, { dueDate: '2026-11-19' }),
  tx('C1', 'credit', '2026-10-25', 50),
  tx('X1', 'invoice', '2026-10-01', 999, { account: 'Other' }),
  tx('E1', 'invoice', '2026-10-01', 70, { currency: 'EUR' }),
];

test('balance-forward statement', () => {
  const s = buildStatement(data, { account: 'contoso', currency: 'USD', from: '2026-08-01', to: '2026-11-11' });
  assert.equal(s.opening, 1000);
  assert.equal(s.invoiced, 800);
  assert.equal(s.credited, 650);
  assert.equal(s.closing, 1150);
  assert.deepEqual(s.rows.map((r) => r.tx.id), ['I2', 'P1', 'I3', 'C1']);
  assert.deepEqual(s.rows.map((r) => r.balance), [1500, 900, 1200, 1150]);
});

test('FIFO allocation and aging buckets', () => {
  const mine = data.filter((t) => t.account === 'Contoso' && t.currency === 'USD');
  const a = aging(mine, '2026-11-11');
  // 650 of credits clears 650 of I1 (oldest) → I1 open 350 (133 days late), I2 open 500 (72 days), I3 300 current
  assert.equal(a.over90, 350);
  assert.equal(a.d90, 500);
  assert.equal(a.current, 300);
  assert.equal(a.total, 1150);
});

test('statuses on statement rows', () => {
  const s = buildStatement(data, { account: 'Contoso', currency: 'USD', to: '2026-11-11' });
  const status = Object.fromEntries(s.rows.filter((r) => r.status).map((r) => [r.tx.id, r.status]));
  assert.deepEqual(status, { I1: 'overdue-part', I2: 'overdue', I3: 'open' });
});

test('overpayment shows as credit in current bucket', () => {
  const a = aging([tx('I', 'invoice', '2026-01-01', 100), tx('P', 'payment', '2026-01-05', 150)], '2026-02-01');
  assert.equal(a.current, -50);
  assert.equal(a.total, -50);
});

test('summary per account and currency', () => {
  const rows = summarise(data, '2026-11-11');
  assert.deepEqual(rows.map((r) => [r.account, r.currency, r.balance]), [
    ['Contoso', 'EUR', 70], ['Contoso', 'USD', 1150], ['Other', 'USD', 999],
  ]);
});
