export function isObj(v: any): v is Record<string, any> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        return a.length === (b as any[]).length && a.every((v, i) => deepEqual(v, (b as any[])[i]));
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
}

function formatValue(val: any, depth: number): string {
    if (!isObj(val) && !Array.isArray(val)) return JSON.stringify(val);
    const json = JSON.stringify(val, null, 4);
    const lines = json.split('\n');
    if (lines.length === 1) return json;
    const pad = '    '.repeat(depth);
    return lines.map((line, i) => i === 0 ? line : pad + line).join('\n');
}

export function jsonnetDiff(base: Record<string, any>, target: Record<string, any>, depth: number): string {
    const indent = '    '.repeat(depth);
    const lines: string[] = [];
    for (const [key, val] of Object.entries(target)) {
        const k = JSON.stringify(key);
        if (!(key in base)) {
            lines.push(`${indent}${k}: ${formatValue(val, depth)},`);
        } else if (isObj(base[key]) && isObj(val)) {
            if (deepEqual(base[key], val)) continue;
            const inner = jsonnetDiff(base[key], val, depth + 1);
            lines.push(`${indent}${k}+: {`);
            lines.push(inner + `${indent}},`);
        } else if (!deepEqual(base[key], val)) {
            lines.push(`${indent}${k}: ${formatValue(val, depth)},`);
        }
    }
    for (const key of Object.keys(base)) {
        if (!(key in target)) {
            lines.push(`${indent}${JSON.stringify(key)}:: null,`);
        }
    }
    return lines.length ? lines.join('\n') + '\n' : '';
}
