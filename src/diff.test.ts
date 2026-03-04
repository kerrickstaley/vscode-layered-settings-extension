import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { jsonnetDiff } from './diff';

function wrap(body: string): string {
    return '{\n' + body + '}\n';
}

function diff(base: Record<string, any>, target: Record<string, any>): string {
    return wrap(jsonnetDiff(base, target, 1));
}

describe('jsonnetDiff', () => {
    it('returns empty object when identical', () => {
        assert.equal(diff({ a: 1 }, { a: 1 }), '{\n}\n');
    });

    it('emits new keys with :', () => {
        assert.equal(diff({}, { a: 1 }), '{\n    "a": 1,\n}\n');
    });

    it('emits changed primitive with :', () => {
        assert.equal(diff({ a: 1 }, { a: 2 }), '{\n    "a": 2,\n}\n');
    });

    it('emits removed keys as hidden', () => {
        assert.equal(diff({ a: 1 }, {}), '{\n    "a":: null,\n}\n');
    });

    it('uses +: for object diffs', () => {
        const base = { obj: { x: 1, y: 2 } };
        const target = { obj: { x: 1, y: 3 } };
        assert.equal(diff(base, target), [
            '{',
            '    "obj"+: {',
            '        "y": 3,',
            '    },',
            '}',
            '',
        ].join('\n'));
    });

    it('hides removed sub-keys inside +:', () => {
        const base = { obj: { x: 1, y: 2 } };
        const target = { obj: { x: 1 } };
        assert.equal(diff(base, target), [
            '{',
            '    "obj"+: {',
            '        "y":: null,',
            '    },',
            '}',
            '',
        ].join('\n'));
    });

    it('recurses nested objects with +:', () => {
        const base = { a: { b: { c: 1 } } };
        const target = { a: { b: { c: 2 } } };
        assert.equal(diff(base, target), [
            '{',
            '    "a"+: {',
            '        "b"+: {',
            '            "c": 2,',
            '        },',
            '    },',
            '}',
            '',
        ].join('\n'));
    });

    it('uses : when base is object but target is primitive', () => {
        assert.equal(diff({ a: { x: 1 } }, { a: 'flat' }), '{\n    "a": "flat",\n}\n');
    });

    it('uses : when base is primitive but target is object', () => {
        assert.equal(diff({ a: 1 }, { a: { x: 1 } }), [
            '{',
            '    "a": {',
            '        "x": 1',
            '    },',
            '}',
            '',
        ].join('\n'));
    });

    it('skips unchanged nested objects', () => {
        const obj = { nested: { x: 1 } };
        assert.equal(diff(obj, { ...obj, b: 2 }), '{\n    "b": 2,\n}\n');
    });

    it('handles mixed adds, changes, and removes', () => {
        const base = { keep: 1, change: 'old', remove: true };
        const target = { keep: 1, change: 'new', add: 42 };
        const result = diff(base, target);
        assert.ok(result.includes('"change": "new"'));
        assert.ok(result.includes('"add": 42'));
        assert.ok(result.includes('"remove":: null'));
        assert.ok(!result.includes('"keep"'));
    });
});
