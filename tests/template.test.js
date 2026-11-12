import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEMPLATE, normaliseTemplate, fill, getPath, setPath, moveSection, section, visibleColumns,
} from '../src/lib/template.js';

describe('normaliseTemplate', () => {
  test('nothing saved → the defaults', () => {
    const t = normaliseTemplate(null);
    assert.equal(t.title, 'Statement of Account');
    assert.deepEqual(t.sections.map((s) => s.key), DEFAULT_TEMPLATE.sections.map((s) => s.key));
    assert.notEqual(t.sections, DEFAULT_TEMPLATE.sections, 'a copy, not the frozen default');
  });

  test('carries over the footer from before templates existed', () => {
    assert.equal(normaliseTemplate(null, { statementNote: 'IBAN BH67 BMAG 0000 1299 1234 56' }).footer, 'IBAN BH67 BMAG 0000 1299 1234 56');
    assert.equal(normaliseTemplate({ footer: 'Saved' }, { statementNote: 'Old' }).footer, 'Saved');
  });

  test('keeps saved values, fills in anything missing, drops unknown keys', () => {
    const t = normaliseTemplate({
      title: 'Account Statement',
      bogus: 1,
      branding: { accent: '#123456' },
      sections: [{ key: 'activity', columns: { status: { visible: false } } }],
    });
    assert.equal(t.title, 'Account Statement');
    assert.equal(t.bogus, undefined);
    assert.equal(t.branding.accent, '#123456');
    assert.equal(t.branding.headingFont, 'serif');
    const activity = section(t, 'activity');
    assert.equal(activity.columns.status.visible, false);
    assert.equal(activity.columns.status.label, 'Status');
    assert.equal(activity.heading, 'Account activity');
  });

  test('saved section order wins; new and duplicate sections are handled', () => {
    const t = normaliseTemplate({ sections: [{ key: 'aging' }, { key: 'summary' }, { key: 'aging' }, { key: 'nope' }] });
    assert.deepEqual(t.sections.map((s) => s.key).slice(0, 2), ['aging', 'summary']);
    assert.equal(t.sections.length, DEFAULT_TEMPLATE.sections.length);
  });

  test('rejects unsafe or invalid branding', () => {
    const t = normaliseTemplate({ branding: {
      accent: 'red; background:url(evil)', headingFont: 'comic', logo: 'javascript:alert(1)', logoHeight: 9999,
    } });
    assert.equal(t.branding.accent, DEFAULT_TEMPLATE.branding.accent);
    assert.equal(t.branding.headingFont, 'serif');
    assert.equal(t.branding.logo, '');
    assert.equal(t.branding.logoHeight, 160);
  });

  test('wrong types fall back to defaults', () => {
    const t = normaliseTemplate({ title: 42, sections: [{ key: 'items', visible: 'yes' }] });
    assert.equal(t.title, 'Statement of Account');
    assert.equal(section(t, 'items').visible, true);
  });
});

describe('placeholders', () => {
  test('fills known placeholders and leaves unknown ones visible', () => {
    assert.equal(fill('Dear {customer}, you owe {balance_due}. {oops}', { customer: 'Gulf Hospitality', balance_due: 'BHD 12.500' }),
      'Dear Gulf Hospitality, you owe BHD 12.500. {oops}');
    assert.equal(fill('', {}), '');
    assert.equal(fill(undefined, {}), '');
  });
});

describe('paths and sections', () => {
  test('get/set by path, addressing sections by key', () => {
    const t = normaliseTemplate(null);
    assert.equal(getPath(t, 'sections.activity.columns.date.label'), 'Date');
    setPath(t, 'sections.activity.columns.date.label', 'Tarikh');
    assert.equal(section(t, 'activity').columns.date.label, 'Tarikh');
    setPath(t, 'branding.accent', '#000000');
    assert.equal(t.branding.accent, '#000000');
    assert.throws(() => setPath(t, 'branding.nope', 1), /Unknown template field/);
    assert.throws(() => setPath(t, 'sections.nope.visible', true), /Unknown template field/);
  });

  test('moveSection stays within bounds', () => {
    const t = normaliseTemplate(null);
    const first = t.sections[0].key;
    moveSection(t, first, -1);
    assert.equal(t.sections[0].key, first);
    moveSection(t, first, 1);
    assert.equal(t.sections[1].key, first);
  });

  test('visibleColumns keeps order and skips hidden ones', () => {
    const t = normaliseTemplate(null);
    const aging = section(t, 'aging');
    aging.columns.d60.visible = false;
    assert.deepEqual(visibleColumns(aging).map(([k]) => k), ['current', 'd30', 'd90', 'over90', 'total']);
  });
});
